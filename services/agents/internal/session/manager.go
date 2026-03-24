package session

import (
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"syscall"
	"text/template"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/git"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/vault"
	"github.com/google/uuid"
)

var (
	envKeyRe      = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
	sessionNameRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._~-]*$`)
)

// Manager orchestrates session lifecycle using Store and pty.PTYManager.
type Manager struct {
	store        *Store
	pty          *pty.PTYManager
	git          *git.Client
	vault        *vault.Client
	profiles     map[string]config.Profile
	maxSessions  int
	ptyHasSession func(id string) bool // injectable for tests; defaults to checking pty.PID
	processAlive  func(pid int) bool
}

// NewManager creates a new session Manager.
// gitClient may be nil if no profiles use repos.
// vaultClient may be nil if no profiles use vault secrets.
// maxSessions is the maximum number of concurrent sessions; 0 means unlimited.
func NewManager(store *Store, ptyManager *pty.PTYManager, gitClient *git.Client, vaultClient *vault.Client, profiles map[string]config.Profile, maxSessions int) *Manager {
	m := &Manager{
		store:       store,
		pty:         ptyManager,
		git:         gitClient,
		vault:       vaultClient,
		profiles:    profiles,
		maxSessions: maxSessions,
	}
	if ptyManager != nil {
		m.ptyHasSession = func(id string) bool {
			_, err := ptyManager.PID(id)
			return err == nil
		}
	} else {
		m.ptyHasSession = func(id string) bool { return false }
	}
	m.processAlive = isProcessAlive
	return m
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
	maxExtraArgs   = 64
	maxExtraArgLen = 4096
)

// Create validates inputs, creates PTY session, starts command, returns Session.
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

	// Validate name characters (URL path-safe) for caller-supplied names.
	// Auto-generated names ("<profile>-<nanoseconds>") are always URL-path-safe.
	if req.SessionName != "" && !sessionNameRe.MatchString(req.SessionName) {
		return nil, &Error{Code: ErrInvalidArgument, Message: "session name contains invalid characters: must match [a-zA-Z0-9._~-]+"}
	}

	// Auto-generate name if empty.
	sessionName := req.SessionName
	if sessionName == "" {
		sessionName = fmt.Sprintf("%s-%d", req.AgentProfile, time.Now().UnixNano())
	}

	// Validate name length.
	if len(sessionName) > 200 {
		return nil, &Error{Code: ErrInvalidArgument, Message: "session name must be 200 characters or fewer"}
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
		CreatedAt:    time.Now(),
	}
	if err := m.store.TryAdd(sess, m.maxSessions); err != nil {
		return nil, err
	}

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
			sess, getErr := m.mustGet(sessionID)
			if getErr != nil {
				return nil, fmt.Errorf("%s; %w", errMsg, getErr)
			}
			return sess, &Error{Code: ErrInternal, Message: errMsg}
		}

		secrets, err := m.vault.GetSecret(profile.VaultSecret)
		if err != nil {
			errMsg := fmt.Sprintf("failed to fetch vault secret: %v", err)
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			sess, getErr := m.mustGet(sessionID)
			if getErr != nil {
				return nil, fmt.Errorf("%s; %w", errMsg, getErr)
			}
			return sess, &Error{Code: ErrInternal, Message: errMsg}
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

	// If the profile has a repo, clone/pull and start the session in the clone root.
	// Agents create their own worktrees via /new-work.
	workdir := "/"
	if profile.Repo != "" {
		if m.git == nil {
			errMsg := "git client not configured but profile requires a repo"
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			sess, getErr := m.mustGet(sessionID)
			if getErr != nil {
				return nil, fmt.Errorf("%s; %w", errMsg, getErr)
			}
			return sess, &Error{Code: ErrInternal, Message: errMsg}
		}

		cloneDir, err := m.git.EnsureClone(profile.Repo, gitCreds)
		if err != nil {
			errMsg := fmt.Sprintf("failed to clone repo: %v", err)
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			sess, getErr := m.mustGet(sessionID)
			if getErr != nil {
				return nil, fmt.Errorf("%s; %w", errMsg, getErr)
			}
			return sess, &Error{Code: ErrInternal, Message: errMsg}
		}

		workdir = cloneDir
		m.store.Update(sessionID, func(s *Session) {
			s.RepoURL = profile.Repo
		})
	}

	// Render command template.
	cmdStr, err := m.renderCommand(profile.Command, sess, req.ExtraArgs, profile.PluginDir)
	if err != nil {
		errMsg := fmt.Sprintf("failed to render command: %v", err)
		m.store.Update(sessionID, func(s *Session) {
			s.State = StateError
			s.ErrorMessage = errMsg
		})
		retSess, getErr := m.mustGet(sessionID)
		if getErr != nil {
			return nil, fmt.Errorf("%s; %w", errMsg, getErr)
		}
		return retSess, &Error{Code: ErrInternal, Message: errMsg}
	}

	// Build env slice for PTY (format: "KEY=VALUE").
	// Start from the daemon's own environment so PATH, HOME, TERM, etc. are
	// inherited. Vault secrets and request env vars override anything inherited.
	envSlice := os.Environ()

	// Vault secrets as env vars.
	if vaultSecrets != nil {
		for k, v := range vaultSecrets {
			envKey := strings.ToUpper(k)
			if !envKeyRe.MatchString(envKey) {
				slog.Warn("skipping vault secret with invalid env key", "key", k)
				continue
			}
			strVal := fmt.Sprintf("%v", v)
			envSlice = append(envSlice, fmt.Sprintf("%s=%s", envKey, strVal))
		}
	}

	// Request env vars (validate keys before creating session).
	for k, v := range req.Env {
		if !envKeyRe.MatchString(k) {
			errMsg := fmt.Sprintf("invalid env var key: %q", k)
			m.store.Update(sessionID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			retSess, getErr := m.mustGet(sessionID)
			if getErr != nil {
				return nil, fmt.Errorf("%s; %w", errMsg, getErr)
			}
			return retSess, &Error{Code: ErrInvalidArgument, Message: errMsg}
		}
		envSlice = append(envSlice, fmt.Sprintf("%s=%s", k, v))
	}

	// Build PTY command: wrap the shell command string via bash -c so that
	// the rendered cmdStr (which may include shell operators) is interpreted
	// correctly.
	command := []string{"bash", "-c", cmdStr}

	slog.Debug("launching session command", "session", sessionID, "name", req.SessionName, "command", cmdStr, "cwd", workdir)

	// Create PTY session. Use sessionID (UUID) as the PTY key so all
	// subsequent lookups (Destroy, PID, Has) resolve to the same entry.
	if err := m.pty.Create(sessionID, workdir, command, envSlice, 0, 0); err != nil {
		// Remove the session from the store immediately so the cap slot is
		// freed. The session was never fully created, so leaving it as
		// StateError would permanently occupy a cap slot (TTL=0 means no
		// cleanup) and reintroduce the DoS surface.
		m.store.Delete(sessionID)
		return nil, &Error{Code: ErrInternal, Message: fmt.Sprintf("failed to create PTY session: %v", err)}
	}

	// Get PID of the child process.
	// If the command exited immediately (e.g., fast-exit profile), the PTY
	// session may already be gone. Mark as stopped in that case.
	pid, err := m.pty.PID(sessionID)
	if err != nil {
		slog.Debug("session command exited immediately after launch", "session", sessionID, "name", req.SessionName, "command", cmdStr, "cwd", workdir)
		slog.Info("session command exited immediately", "session", sessionID, "error", err)
		_ = m.pty.Destroy(sessionID)
		m.store.Update(sessionID, func(s *Session) {
			s.State = StateStopped
			s.StoppedAt = time.Now()
		})
		sess, getErr := m.mustGet(sessionID)
		if getErr != nil {
			return nil, &Error{Code: ErrInternal, Message: getErr.Error()}
		}
		return sess, nil
	}

	slog.Debug("session command running", "session", sessionID, "name", req.SessionName, "pid", pid)

	m.store.Update(sessionID, func(s *Session) {
		s.State = StateRunning
		s.AgentPID = pid
		s.WebsocketURL = ""
	})

	sess, getErr := m.mustGet(sessionID)
	if getErr != nil {
		return nil, &Error{Code: ErrInternal, Message: getErr.Error()}
	}
	return sess, nil
}

// Get returns a session by ID, reconciling state with PTY reality.
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

// Destroy kills the PTY session and removes from store.
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

	if m.pty != nil {
		if err := m.pty.Destroy(sess.ID); err != nil {
			slog.Warn("failed to destroy PTY session", "session", sess.ID, "error", err)
		}
	}

	m.store.Delete(id)
	return nil
}

func (m *Manager) reconcile(sess *Session) {
	if sess.State != StateRunning && sess.State != StateCreating {
		return
	}

	now := time.Now()

	// Check if PTY session still exists.
	ptyExists := m.ptyHasSession(sess.ID)
	if !ptyExists {
		m.store.Update(sess.ID, func(s *Session) {
			s.State = StateStopped
			s.StoppedAt = now
		})
		sess.State = StateStopped
		sess.StoppedAt = now
		return
	}

	if sess.AgentPID > 0 && !m.processAlive(sess.AgentPID) {
		m.store.Update(sess.ID, func(s *Session) {
			s.State = StateStopped
			s.StoppedAt = now
		})
		sess.State = StateStopped
		sess.StoppedAt = now
		return
	}
}

func (m *Manager) cleanup(sessionID, errMsg string) {
	_ = m.pty.Destroy(sessionID)

	m.store.Update(sessionID, func(s *Session) {
		s.State = StateError
		s.ErrorMessage = errMsg
	})
}

func (m *Manager) mustGet(id string) (*Session, error) {
	sess, ok := m.store.Get(id)
	if !ok {
		return nil, fmt.Errorf("session not found after create: internal error")
	}
	return sess, nil
}

type templateData struct {
	SessionID    string // Shell-escaped in renderCommand.
	SessionName  string // Safe without escaping: validated to [a-zA-Z0-9][a-zA-Z0-9._~-]* by sessionNameRe.
	ExtraArgs    string // Shell-escaped via shellJoinArgs in renderCommand.
	WorktreePath string // Shell-escaped in renderCommand when non-empty; empty string when unset.
	PluginDir    string // Shell-escaped in renderCommand when non-empty; empty string when unset.
}

func (m *Manager) renderCommand(cmdTemplate string, sess *Session, extraArgs []string, pluginDir string) (string, error) {
	tmpl, err := template.New("cmd").Parse(cmdTemplate)
	if err != nil {
		return "", fmt.Errorf("parsing command template: %w", err)
	}

	// Leave WorktreePath and PluginDir as empty string (not shell-escaped '')
	// when unset, so template conditionals like {{if .WorktreePath}} work
	// correctly and commands don't receive a spurious empty-string argument.
	worktreePath := ""
	if sess.WorktreePath != "" {
		worktreePath = shellEscapeArg(sess.WorktreePath)
	}

	escapedPluginDir := ""
	if pluginDir != "" {
		escapedPluginDir = shellEscapeArg(pluginDir)
	}

	data := templateData{
		SessionID:    shellEscapeArg(sess.ID),
		SessionName:  sess.Name,
		ExtraArgs:    shellJoinArgs(extraArgs),
		WorktreePath: worktreePath,
		PluginDir:    escapedPluginDir,
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

// RestoreFromPersister loads persisted sessions from disk into the store and
// reconciles them against live process state. Call once at startup before
// starting the Cleaner and Monitor.
func (m *Manager) RestoreFromPersister(p *Persister) error {
	if p == nil {
		return nil
	}

	sessions, err := p.LoadAll()
	if err != nil {
		return err
	}

	for _, sess := range sessions {
		switch sess.State {
		case StateDestroying:
			// Daemon died mid-destroy. Clean up the file directly (not via the
			// queue) since RestoreFromPersister runs before the write loop has
			// received any ops — no ordering concern exists at this point.
			p.deleteFile(sess.ID)
			slog.Info("cleaned up mid-destroy session on restore", "id", sess.ID)
			continue

		case StateCreating:
			// Daemon died during Create(). Two sub-cases:
			//   AgentPID == 0: crashed before pty.Create — no process exists.
			//   AgentPID != 0: crashed between pty.Create and the Running update.
			//                  The process may or may not still be running, but
			//                  we have no PTY handle to reconnect to it, so treat
			//                  it as an error in both cases.
			sess.State = StateError
			sess.ErrorMessage = "session interrupted during creation (daemon restart)"
			slog.Info("marking mid-create session as error on restore", "id", sess.ID, "pid", sess.AgentPID)

		case StateRunning:
			if !m.processAlive(sess.AgentPID) {
				sess.State = StateStopped
				if sess.StoppedAt.IsZero() {
					sess.StoppedAt = time.Now()
				}
			}
			slog.Info("restored session", "id", sess.ID, "state", sess.State, "pid", sess.AgentPID)

		default:
			// StateStopped, StateError: add as-is.
			slog.Info("restored session", "id", sess.ID, "state", sess.State, "pid", sess.AgentPID)
		}

		if err := m.store.TryAdd(sess, 0); err != nil {
			var sessErr *Error
			if errors.As(err, &sessErr) && sessErr.Code == ErrAlreadyExists {
				slog.Warn("skipping duplicate session name on restore",
					"id", sess.ID, "name", sess.Name)
				continue
			}
			return fmt.Errorf("restore session %s: %w", sess.ID, err)
		}
	}

	slog.Info("restored persisted sessions", "count", len(sessions))
	return nil
}
