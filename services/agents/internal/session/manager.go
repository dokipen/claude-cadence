package session

import (
	"bytes"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"syscall"
	"text/template"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/git"
	"github.com/dokipen/claude-cadence/services/agents/internal/tmux"
	"github.com/dokipen/claude-cadence/services/agents/internal/ttyd"
	"github.com/google/uuid"
)

var (
	tmuxNameRe = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	envKeyRe   = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
)

// Manager orchestrates session lifecycle using Store and tmux.Client.
type Manager struct {
	store    *Store
	tmux     *tmux.Client
	ttyd     *ttyd.Client
	git      *git.Client
	profiles map[string]config.Profile
}

// NewManager creates a new session Manager.
// gitClient may be nil if no profiles use repos.
func NewManager(store *Store, tmuxClient *tmux.Client, ttydClient *ttyd.Client, gitClient *git.Client, profiles map[string]config.Profile) *Manager {
	return &Manager{
		store:    store,
		tmux:     tmuxClient,
		ttyd:     ttydClient,
		git:      gitClient,
		profiles: profiles,
	}
}

// CreateRequest holds the parameters for creating a session.
type CreateRequest struct {
	AgentProfile string
	SessionName  string
	BaseRef      string
	Env          map[string]string
	ExtraArgs    []string
}

const (
	maxExtraArgs    = 64
	maxExtraArgLen  = 4096
)

// Create validates inputs, creates tmux session, starts command, returns Session.
func (m *Manager) Create(req CreateRequest) (*Session, error) {
	// Validate ExtraArgs limits and content.
	if len(req.ExtraArgs) > maxExtraArgs {
		return nil, &Error{Code: ErrInvalidArgument, Message: fmt.Sprintf("too many extra_args: %d (max %d)", len(req.ExtraArgs), maxExtraArgs)}
	}
	for i, arg := range req.ExtraArgs {
		if len(arg) > maxExtraArgLen {
			return nil, &Error{Code: ErrInvalidArgument, Message: fmt.Sprintf("extra_args[%d] too long: %d bytes (max %d)", i, len(arg), maxExtraArgLen)}
		}
		if strings.ContainsRune(arg, '\x00') {
			return nil, &Error{Code: ErrInvalidArgument, Message: fmt.Sprintf("extra_args[%d] contains null byte", i)}
		}
	}

	// Validate profile exists.
	profile, ok := m.profiles[req.AgentProfile]
	if !ok {
		return nil, &Error{Code: ErrNotFound, Message: fmt.Sprintf("profile %q not found", req.AgentProfile)}
	}

	// Auto-generate name if empty.
	sessionName := req.SessionName
	if sessionName == "" {
		sessionName = fmt.Sprintf("%s-%d", req.AgentProfile, time.Now().UnixNano())
	}

	// Validate name is tmux-safe.
	if len(sessionName) > 200 {
		return nil, &Error{Code: ErrInvalidArgument, Message: "session name must be 200 characters or fewer"}
	}
	if !tmuxNameRe.MatchString(sessionName) {
		return nil, &Error{Code: ErrInvalidArgument, Message: "session name must match [a-zA-Z0-9_-]"}
	}

	// Validate name is unique in store.
	if _, exists := m.store.GetByName(sessionName); exists {
		return nil, &Error{Code: ErrAlreadyExists, Message: fmt.Sprintf("session %q already exists", sessionName)}
	}

	// Validate name is unique in tmux.
	if m.tmux.HasSession(sessionName) {
		return nil, &Error{Code: ErrAlreadyExists, Message: fmt.Sprintf("tmux session %q already exists", sessionName)}
	}

	sessionID := uuid.New().String()
	sess := &Session{
		ID:           sessionID,
		Name:         sessionName,
		AgentProfile: req.AgentProfile,
		State:        StateCreating,
		TmuxSession:  sessionName,
		CreatedAt:    time.Now(),
	}
	m.store.Add(sess)

	// If the profile has a repo, clone/pull and create a worktree.
	workdir := "/"
	if profile.Repo != "" {
		if m.git == nil {
			errMsg := "git client not configured but profile requires a repo"
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
		}

		cloneDir, err := m.git.EnsureClone(profile.Repo)
		if err != nil {
			errMsg := fmt.Sprintf("failed to clone repo: %v", err)
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
		}

		worktreeDir := m.git.WorktreeDir(sessionID)
		baseRef := req.BaseRef
		if err := m.git.AddWorktree(cloneDir, worktreeDir, baseRef); err != nil {
			errMsg := fmt.Sprintf("failed to create worktree: %v", err)
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
		}

		// Resolve the actual base ref used.
		if baseRef == "" {
			baseRef, _ = m.git.DefaultBranch(cloneDir)
		}

		workdir = worktreeDir
		m.store.Update(sessionID, func(s *Session) {
			s.WorktreePath = worktreeDir
			s.RepoURL = profile.Repo
			s.BaseRef = baseRef
		})
	}

	// Create tmux session with the worktree as workdir.
	if err := m.tmux.NewSession(sessionName, workdir); err != nil {
		errMsg := fmt.Sprintf("failed to create tmux session: %v", err)
		// Clean up worktree if we created one.
		if profile.Repo != "" && m.git != nil {
			cloneDir, _ := m.git.CloneDir(profile.Repo)
			worktreeDir := m.git.WorktreeDir(sessionID)
			_ = m.git.RemoveWorktree(cloneDir, worktreeDir)
		}
		m.store.Update(sessionID, func(s *Session) {
			s.State = StateError
			s.ErrorMessage = errMsg
		})
		return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
	}

	// Set env vars (validate keys to prevent injection via tmux set-environment).
	for k, v := range req.Env {
		if !envKeyRe.MatchString(k) {
			m.cleanup(sessionID, sessionName, fmt.Sprintf("invalid env var key: %q", k))
			return m.mustGet(sessionID), &Error{Code: ErrInvalidArgument, Message: fmt.Sprintf("invalid env var key: %q", k)}
		}
		if err := m.tmux.SetEnv(sessionName, k, v); err != nil {
			slog.Warn("failed to set env var", "key", k, "error", err)
		}
	}

	// Render command template.
	cmdStr, err := m.renderCommand(profile.Command, sess, req.ExtraArgs)
	if err != nil {
		errMsg := fmt.Sprintf("failed to render command: %v", err)
		m.cleanup(sessionID, sessionName, errMsg)
		return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
	}

	// Send command to tmux.
	if err := m.tmux.SendKeys(sessionName, cmdStr); err != nil {
		errMsg := fmt.Sprintf("failed to send keys: %v", err)
		m.cleanup(sessionID, sessionName, errMsg)
		return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
	}

	// Get PID.
	pid, err := m.tmux.GetPanePID(sessionName)
	if err != nil {
		slog.Warn("failed to get pane PID", "error", err)
	}

	// Start ttyd if enabled.
	var websocketURL string
	if m.ttyd != nil {
		wsURL, err := m.ttyd.Start(sessionID, m.tmux.SocketName(), sessionName)
		if err != nil {
			slog.Warn("failed to start ttyd", "session", sessionName, "error", err)
		} else {
			websocketURL = wsURL
		}
	}

	m.store.Update(sessionID, func(s *Session) {
		s.State = StateRunning
		s.AgentPID = pid
		s.WebsocketURL = websocketURL
	})

	return m.mustGet(sessionID), nil
}

// Get returns a session by ID, reconciling state with tmux reality.
func (m *Manager) Get(id string) (*Session, error) {
	sess, ok := m.store.Get(id)
	if !ok {
		return nil, &Error{Code: ErrNotFound, Message: fmt.Sprintf("session %q not found", id)}
	}

	m.reconcile(sess)
	return sess, nil
}

// List returns all sessions, optionally filtered by profile. Reconciles each.
func (m *Manager) List(profileFilter string) ([]*Session, error) {
	all := m.store.List()
	var result []*Session
	for _, sess := range all {
		if profileFilter != "" && sess.AgentProfile != profileFilter {
			continue
		}
		m.reconcile(sess)
		result = append(result, sess)
	}
	return result, nil
}

// Destroy kills tmux session and removes from store.
func (m *Manager) Destroy(id string, force bool) error {
	sess, ok := m.store.Get(id)
	if !ok {
		return &Error{Code: ErrNotFound, Message: fmt.Sprintf("session %q not found", id)}
	}

	// Reconcile first.
	m.reconcile(sess)

	if sess.State == StateRunning && !force {
		return &Error{Code: ErrFailedPrecondition, Message: "session is running; use force=true to destroy"}
	}

	m.store.Update(id, func(s *Session) {
		s.State = StateDestroying
	})

	// Stop ttyd before killing tmux session.
	if m.ttyd != nil {
		m.ttyd.Stop(id)
	}

	if m.tmux.HasSession(sess.TmuxSession) {
		if err := m.tmux.KillSession(sess.TmuxSession); err != nil {
			slog.Warn("failed to kill tmux session", "session", sess.TmuxSession, "error", err)
		}
	}

	// Clean up worktree if one was created.
	if sess.WorktreePath != "" && sess.RepoURL != "" && m.git != nil {
		cloneDir, err := m.git.CloneDir(sess.RepoURL)
		if err == nil {
			if err := m.git.RemoveWorktree(cloneDir, sess.WorktreePath); err != nil {
				slog.Warn("failed to remove worktree", "path", sess.WorktreePath, "error", err)
			}
			if err := m.git.PruneWorktrees(cloneDir); err != nil {
				slog.Warn("failed to prune worktrees", "error", err)
			}
		}
	}

	m.store.Delete(id)
	return nil
}

func (m *Manager) reconcile(sess *Session) {
	if sess.State != StateRunning && sess.State != StateCreating {
		return
	}

	tmuxExists := m.tmux.HasSession(sess.TmuxSession)
	if !tmuxExists {
		m.store.Update(sess.ID, func(s *Session) {
			s.State = StateStopped
		})
		sess.State = StateStopped
		return
	}

	if sess.AgentPID > 0 && !isProcessAlive(sess.AgentPID) {
		m.store.Update(sess.ID, func(s *Session) {
			s.State = StateStopped
		})
		sess.State = StateStopped
		return
	}
}

func (m *Manager) cleanup(sessionID, tmuxSession, errMsg string) {
	if m.tmux.HasSession(tmuxSession) {
		_ = m.tmux.KillSession(tmuxSession)
	}
	m.store.Update(sessionID, func(s *Session) {
		s.State = StateError
		s.ErrorMessage = errMsg
	})
}

func (m *Manager) mustGet(id string) *Session {
	sess, _ := m.store.Get(id)
	return sess
}

type templateData struct {
	SessionID    string
	SessionName  string
	ExtraArgs    string
	WorktreePath string
}

func (m *Manager) renderCommand(cmdTemplate string, sess *Session, extraArgs []string) (string, error) {
	tmpl, err := template.New("cmd").Parse(cmdTemplate)
	if err != nil {
		return "", fmt.Errorf("parsing command template: %w", err)
	}

	data := templateData{
		SessionID:    sess.ID,
		SessionName:  sess.Name,
		ExtraArgs:    shellJoinArgs(extraArgs),
		WorktreePath: sess.WorktreePath,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("executing command template: %w", err)
	}
	return buf.String(), nil
}

// shellEscapeArg wraps a single argument in single quotes, escaping any
// embedded single quotes. This is the safest quoting method for POSIX shells:
// within single quotes, no characters are special except ' itself.
func shellEscapeArg(arg string) string {
	// Replace each ' with '\'' (end quote, escaped quote, start quote)
	return "'" + strings.ReplaceAll(arg, "'", `'\''`) + "'"
}

// shellJoinArgs escapes each argument and joins them with spaces.
// Returns empty string for empty/nil slices.
func shellJoinArgs(args []string) string {
	if len(args) == 0 {
		return ""
	}
	escaped := make([]string, len(args))
	for i, arg := range args {
		escaped[i] = shellEscapeArg(arg)
	}
	return strings.Join(escaped, " ")
}

func isProcessAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}
