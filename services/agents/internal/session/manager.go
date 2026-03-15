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
	"github.com/dokipen/claude-cadence/services/agents/internal/vault"
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
	vault    *vault.Client
	profiles map[string]config.Profile
}

// NewManager creates a new session Manager.
// gitClient may be nil if no profiles use repos.
// vaultClient may be nil if no profiles use vault secrets.
func NewManager(store *Store, tmuxClient *tmux.Client, ttydClient *ttyd.Client, gitClient *git.Client, vaultClient *vault.Client, profiles map[string]config.Profile) *Manager {
	return &Manager{
		store:    store,
		tmux:     tmuxClient,
		ttyd:     ttydClient,
		git:      gitClient,
		vault:    vaultClient,
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

	// Validate baseRef before any state changes.
	if err := git.ValidateRef(req.BaseRef); err != nil {
		return nil, &Error{Code: ErrInvalidArgument, Message: fmt.Sprintf("invalid base_ref: %v", err)}
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

	// Fetch Vault secrets if the profile has a vault_secret path.
	var gitCreds *git.Credentials
	var vaultSecrets map[string]interface{}
	if profile.VaultSecret != "" {
		if m.vault == nil {
			errMsg := "vault client not configured but profile requires vault_secret"
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
		}

		secrets, err := m.vault.GetSecret(profile.VaultSecret)
		if err != nil {
			errMsg := fmt.Sprintf("failed to fetch vault secret: %v", err)
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
		}
		vaultSecrets = secrets

		// Extract git credentials from the secret data.
		gitCreds = &git.Credentials{}
		if token, ok := secrets["token"].(string); ok {
			gitCreds.Token = token
		}
		if sshKey, ok := secrets["ssh_key"].(string); ok {
			gitCreds.SSHKey = sshKey
		}
	}

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

		cloneDir, err := m.git.EnsureClone(profile.Repo, gitCreds)
		if err != nil {
			errMsg := fmt.Sprintf("failed to clone repo: %v", err)
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
		}

		worktreeDir := m.git.WorktreeDir(sessionID)
		resolvedRef, err := m.git.AddWorktree(cloneDir, worktreeDir, req.BaseRef)
		if err != nil {
			errMsg := fmt.Sprintf("failed to create worktree: %v", err)
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			return m.mustGet(sessionID), &Error{Code: ErrInternal, Message: errMsg}
		}

		workdir = worktreeDir
		m.store.Update(sessionID, func(s *Session) {
			s.WorktreePath = worktreeDir
			s.RepoURL = profile.Repo
			s.BaseRef = resolvedRef
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

	// Inject Vault secrets as env vars into tmux session.
	if vaultSecrets != nil {
		for k, v := range vaultSecrets {
			envKey := strings.ToUpper(k)
			if !envKeyRe.MatchString(envKey) {
				slog.Warn("skipping vault secret with invalid env key", "key", k)
				continue
			}
			strVal := fmt.Sprintf("%v", v)
			if err := m.tmux.SetEnv(sessionName, envKey, strVal); err != nil {
				slog.Warn("failed to set vault env var", "key", envKey, "error", err)
			}
		}
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

// RecoverSessions rediscovers tmux sessions on the agentd socket that are not
// tracked in the in-memory store. This handles daemon restarts where the store
// was lost but tmux sessions survived. Recovered sessions are added to the
// store with correct RUNNING/STOPPED state based on process liveness.
//
// Recovered sessions have an empty AgentProfile since the original profile
// cannot be determined from tmux alone. They will not appear in
// profile-filtered List calls.
//
// This must be called before the server starts accepting connections.
func (m *Manager) RecoverSessions() (int, error) {
	tmuxSessions, err := m.tmux.ListSessions()
	if err != nil {
		return 0, fmt.Errorf("listing tmux sessions: %w", err)
	}

	// Build a set of tmux session names already tracked in the store.
	tracked := make(map[string]bool)
	for _, sess := range m.store.List() {
		tracked[sess.TmuxSession] = true
	}

	recovered := 0
	now := time.Now()
	for _, tmuxName := range tmuxSessions {
		if tracked[tmuxName] {
			continue
		}

		// Skip sessions with names that don't match agentd naming conventions.
		if !tmuxNameRe.MatchString(tmuxName) {
			slog.Debug("skipping non-agentd tmux session during recovery", "name", tmuxName)
			continue
		}

		// Determine state by checking if the pane process is alive.
		state := StateRunning
		var stoppedAt time.Time
		pid, err := m.tmux.GetPanePID(tmuxName)
		if err != nil {
			// Can't get PID — treat as stopped.
			state = StateStopped
			stoppedAt = now
			pid = 0
		} else if !isProcessAlive(pid) {
			state = StateStopped
			stoppedAt = now
		}

		sess := &Session{
			ID:          uuid.New().String(),
			Name:        tmuxName,
			State:       state,
			TmuxSession: tmuxName,
			CreatedAt:   now,
			StoppedAt:   stoppedAt,
			AgentPID:    pid,
		}
		m.store.Add(sess)
		recovered++

		slog.Info("recovered tmux session",
			"name", tmuxName,
			"id", sess.ID,
			"state", state,
		)
	}

	return recovered, nil
}

func (m *Manager) reconcile(sess *Session) {
	if sess.State != StateRunning && sess.State != StateCreating {
		return
	}

	now := time.Now()

	tmuxExists := m.tmux.HasSession(sess.TmuxSession)
	if !tmuxExists {
		m.store.Update(sess.ID, func(s *Session) {
			s.State = StateStopped
			s.StoppedAt = now
		})
		sess.State = StateStopped
		sess.StoppedAt = now
		return
	}

	if sess.AgentPID > 0 && !isProcessAlive(sess.AgentPID) {
		m.store.Update(sess.ID, func(s *Session) {
			s.State = StateStopped
			s.StoppedAt = now
		})
		sess.State = StateStopped
		sess.StoppedAt = now
		return
	}
}

func (m *Manager) cleanup(sessionID, tmuxSession, errMsg string) {
	if m.tmux.HasSession(tmuxSession) {
		_ = m.tmux.KillSession(tmuxSession)
	}

	// Clean up worktree if one was created.
	sess, ok := m.store.Get(sessionID)
	if ok && sess.WorktreePath != "" && sess.RepoURL != "" && m.git != nil {
		if cloneDir, err := m.git.CloneDir(sess.RepoURL); err == nil {
			_ = m.git.RemoveWorktree(cloneDir, sess.WorktreePath)
		}
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
		SessionID:    shellEscapeArg(sess.ID),
		SessionName:  sess.Name,
		ExtraArgs:    shellJoinArgs(extraArgs),
		WorktreePath: shellEscapeArg(sess.WorktreePath),
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
