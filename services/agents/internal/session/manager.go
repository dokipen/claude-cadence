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
	killProcess   func(pid int) error // injectable for tests; defaults to sending SIGKILL
	ptyReconnect  func(id, slavePath string) error // injectable for tests; defaults to m.pty.Reattach
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
	m.killProcess = killProcessDefault
	if ptyManager != nil {
		m.ptyReconnect = func(id, slavePath string) error {
			return m.pty.Reattach(id, slavePath)
		}
	} else {
		m.ptyReconnect = func(id, slavePath string) error {
			return fmt.Errorf("pty manager not configured")
		}
	}
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
	maxExtraArgs      = 64
	maxExtraArgLen    = 4096
	maxSessionNameLen = 255
	maxEnvVarValueLen = 4096
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
	// Auto-generated names ("<profile>-<uuid>") are always URL-path-safe.
	if req.SessionName != "" && !sessionNameRe.MatchString(req.SessionName) {
		return nil, &Error{Code: ErrInvalidArgument, Message: "session name contains invalid characters: must match [a-zA-Z0-9._~-]+"}
	}

	// Auto-generate name if empty.
	sessionName := req.SessionName
	if sessionName == "" {
		sessionName = fmt.Sprintf("%s-%s", req.AgentProfile, uuid.New().String())
	}

	// Validate name length.
	if len(sessionName) > maxSessionNameLen {
		return nil, &Error{Code: ErrInvalidArgument, Message: "session name must be 255 characters or fewer"}
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
			_ = m.store.Transition(sessionID, StateError, func(s *Session) {
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
			_ = m.store.Transition(sessionID, StateError, func(s *Session) {
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
			_ = m.store.Transition(sessionID, StateError, func(s *Session) {
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
			_ = m.store.Transition(sessionID, StateError, func(s *Session) {
				s.ErrorMessage = errMsg
			})
			sess, getErr := m.mustGet(sessionID)
			if getErr != nil {
				return nil, fmt.Errorf("%s; %w", errMsg, getErr)
			}
			return sess, &Error{Code: ErrInternal, Message: errMsg}
		}

		workdir = cloneDir
		_, _ = m.store.Update(sessionID, func(s *Session) {
			s.RepoURL = profile.Repo
		})
	}

	// Render command template.
	cmdStr, err := m.renderCommand(profile.Command, sess, req.ExtraArgs, profile.PluginDir)
	if err != nil {
		errMsg := fmt.Sprintf("failed to render command: %v", err)
		_ = m.store.Transition(sessionID, StateError, func(s *Session) {
			s.ErrorMessage = errMsg
		})
		retSess, getErr := m.mustGet(sessionID)
		if getErr != nil {
			return nil, fmt.Errorf("%s; %w", errMsg, getErr)
		}
		return retSess, &Error{Code: ErrInternal, Message: errMsg}
	}

	// Build env slice for PTY (format: "KEY=VALUE").
	// Start from the daemon's own environment so PATH, HOME, etc. are
	// inherited. Vault secrets and request env vars override anything inherited.
	// TERM is defaulted to xterm-256color below if not already present.
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
			_ = m.store.Transition(sessionID, StateError, func(s *Session) {
				s.ErrorMessage = errMsg
			})
			retSess, getErr := m.mustGet(sessionID)
			if getErr != nil {
				return nil, fmt.Errorf("%s; %w", errMsg, getErr)
			}
			return retSess, &Error{Code: ErrInvalidArgument, Message: errMsg}
		}
		if len(v) > maxEnvVarValueLen {
			errMsg := fmt.Sprintf("env var value for key %q too long: %d bytes (max %d)", k, len(v), maxEnvVarValueLen)
			_ = m.store.Transition(sessionID, StateError, func(s *Session) {
				s.ErrorMessage = errMsg
			})
			retSess, getErr := m.mustGet(sessionID)
			if getErr != nil {
				return nil, fmt.Errorf("%s; %w", errMsg, getErr)
			}
			return retSess, &Error{Code: ErrInvalidArgument, Message: errMsg}
		}
		if strings.ContainsRune(v, '\x00') {
			errMsg := fmt.Sprintf("env var value for key %q contains invalid character", k)
			_ = m.store.Transition(sessionID, StateError, func(s *Session) {
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

	// Default TERM to xterm-256color if not set — agentd runs as a systemd
	// service with no TERM in its environment, and terminal programs like vim
	// require a valid TERM to function.
	hasTERM := false
	for _, e := range envSlice {
		if strings.HasPrefix(e, "TERM=") {
			hasTERM = true
			break
		}
	}
	if !hasTERM {
		envSlice = append(envSlice, "TERM=xterm-256color")
	}

	// Build PTY command: wrap the shell command string via bash -c so that
	// the rendered cmdStr (which may include shell operators) is interpreted
	// correctly. Prepend `trap '' HUP` so the child process and any exec'd
	// descendants ignore SIGHUP — this lets sessions survive agentd restarts
	// (closing the PTY master sends SIGHUP to the foreground process group;
	// SIG_IGN is inherited across exec so grandchildren are also protected).
	command := []string{"bash", "-c", "trap '' HUP; " + cmdStr}

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

	// Capture the slave PTY path so it can be persisted and used to reconnect
	// the PTY on daemon restart if the process is still alive.
	ptySlavePath := m.pty.GetSlavePath(sessionID)

	// Get PID of the child process.
	// If the command exited immediately (e.g., fast-exit profile), the PTY
	// session may already be gone. Mark as stopped in that case.
	pid, err := m.pty.PID(sessionID)
	if err != nil {
		slog.Debug("session command exited immediately after launch", "session", sessionID, "name", req.SessionName, "command", cmdStr, "cwd", workdir)
		slog.Info("session command exited immediately", "session", sessionID, "error", err)
		_ = m.pty.Destroy(sessionID)
		_ = m.store.Transition(sessionID, StateStopped, func(s *Session) {
			s.StoppedAt = time.Now()
		})
		sess, getErr := m.mustGet(sessionID)
		if getErr != nil {
			return nil, &Error{Code: ErrInternal, Message: getErr.Error()}
		}
		return sess, nil
	}

	slog.Debug("session command running", "session", sessionID, "name", req.SessionName, "pid", pid)

	_ = m.store.Transition(sessionID, StateRunning, func(s *Session) {
		s.AgentPID = pid
		s.WebsocketURL = ""
		s.PTYSlavePath = ptySlavePath
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

	_ = m.store.Transition(id, StateDestroying)

	if m.pty != nil {
		if err := m.pty.Destroy(sess.ID); err != nil {
			slog.Warn("failed to destroy PTY session", "session", sess.ID, "error", err)
		}
	}

	if sess.WorktreePath != "" && m.git != nil {
		if err := m.git.RemoveWorktree(sess.WorktreePath); err != nil {
			slog.Warn("failed to remove worktree on session destroy", "session", sess.ID, "worktree", sess.WorktreePath, "error", err)
		}
	}

	m.store.Delete(id)
	return nil
}

// SetWorktreePath sets the WorktreePath field on a session. It is used in
// tests and by external callers (e.g. the /new-work skill) that need to
// record a worktree path after the session has been created so that Destroy
// can clean it up.
func (m *Manager) SetWorktreePath(id, path string) error {
	found, err := m.store.Update(id, func(s *Session) {
		s.WorktreePath = path
	})
	if err != nil {
		return err
	}
	if !found {
		return &Error{Code: ErrNotFound, Message: fmt.Sprintf("session %q not found", id)}
	}
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
		// If the session was restored from disk after a restart and the process
		// is still alive, we have no PTY handle to reconnect but the agent is
		// still running. Keep the session as StateRunning.
		// Only transition to StateStopped if the process is also dead (or has no PID).
		// AgentPID == 0 means the process never started (create was in-flight at shutdown).
		// Fall through to the StateStopped transition below.
		if sess.restoredFromDisk && sess.AgentPID > 0 && m.processAlive(sess.AgentPID) {
			return
		}
		if err := m.store.Transition(sess.ID, StateStopped, func(s *Session) {
			s.StoppedAt = now
		}); err == nil {
			sess.State = StateStopped
			sess.StoppedAt = now
		} else {
			slog.Warn("reconcile: unexpected transition rejection", "id", sess.ID, "error", err)
		}
		return
	}

	if sess.AgentPID > 0 && !m.processAlive(sess.AgentPID) {
		if err := m.store.Transition(sess.ID, StateStopped, func(s *Session) {
			s.StoppedAt = now
		}); err == nil {
			sess.State = StateStopped
			sess.StoppedAt = now
		} else {
			slog.Warn("reconcile: unexpected transition rejection", "id", sess.ID, "error", err)
		}
		return
	}
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

func killProcessDefault(pid int) error {
	return syscall.Kill(pid, syscall.SIGKILL)
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
		needsPersist := false
		switch sess.State {
		case StateDestroying:
			// Daemon died mid-destroy. Clean up the file directly (not via the
			// queue) since RestoreFromPersister runs before the write loop has
			// received any ops — no ordering concern exists at this point.
			if sess.WorktreePath != "" && m.git != nil {
				if err := m.git.RemoveWorktree(sess.WorktreePath); err != nil {
					slog.Warn("failed to remove worktree for mid-destroy session on restore", "id", sess.ID, "worktree", sess.WorktreePath, "error", err)
				}
			}
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
			if sess.AgentPID != 0 && m.processAlive(sess.AgentPID) {
				if err := m.killProcess(sess.AgentPID); err != nil {
					slog.Warn("failed to kill orphaned process on restore", "pid", sess.AgentPID, "err", err)
				}
			}
			sess.State = StateError
			sess.ErrorMessage = "session interrupted during creation (daemon restart)"
			needsPersist = true
			slog.Info("marking mid-create session as error on restore", "id", sess.ID, "pid", sess.AgentPID)

		case StateRunning:
			if !m.processAlive(sess.AgentPID) {
				sess.State = StateStopped
				if sess.StoppedAt.IsZero() {
					sess.StoppedAt = time.Now()
				}
				needsPersist = true
			} else if sess.PTYSlavePath != "" {
				// Process is alive and we have the slave PTY path — attempt
				// to reconnect the PTY so the session is fully live again.
				if err := m.ptyReconnect(sess.ID, sess.PTYSlavePath); err == nil {
					// PTY reconnected — session is fully live, no fallback guard needed.
					needsPersist = false
				} else {
					// Reconnect failed — fall back to restoredFromDisk guard so
					// reconcile() does not incorrectly stop the session.
					slog.Warn("PTY reconnect failed on restore, falling back to restoredFromDisk guard",
						"id", sess.ID, "slavePath", sess.PTYSlavePath, "error", err)
					sess.restoredFromDisk = true
				}
			} else {
				// Legacy session with no saved slave path — use existing fallback.
				sess.restoredFromDisk = true
			}
			slog.Info("restored session", "id", sess.ID, "state", sess.State, "pid", sess.AgentPID)

		default:
			// StateStopped, StateError: add as-is.
			slog.Info("restored session", "id", sess.ID, "state", sess.State, "pid", sess.AgentPID)
		}

		if sess.Name != "" && !sessionNameRe.MatchString(sess.Name) {
			slog.Warn("skipping session with invalid name on restore",
				"id", sess.ID, "name", sess.Name)
			continue
		}
		if len(sess.Name) > maxSessionNameLen {
			truncated := sess.Name[:64] + "..."
			slog.Warn("skipping session with name exceeding length limit on restore",
				"id", sess.ID, "name", truncated)
			continue
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
		// If reconciliation changed the state (StateCreating→StateError or
		// StateRunning→StateStopped), persist the new state to disk.
		// TryAdd bypasses the persister, so we must call Update explicitly.
		if needsPersist {
			finalState := sess.State
			finalStopped := sess.StoppedAt
			finalErrMsg := sess.ErrorMessage
			// Use Update (not Transition) here: the session was added via TryAdd
			// with the already-reconciled state, so from-state == to-state.
			// This call's sole purpose is to trigger the persister so the
			// reconciled state is written to disk. TryAdd bypasses the persister.
			_, _ = m.store.Update(sess.ID, func(s *Session) {
				s.State = finalState
				s.StoppedAt = finalStopped
				s.ErrorMessage = finalErrMsg
			})
		}
	}

	slog.Info("restored persisted sessions", "count", len(sessions))
	return nil
}
