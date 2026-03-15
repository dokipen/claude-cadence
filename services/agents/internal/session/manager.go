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
	"github.com/dokipen/claude-cadence/services/agents/internal/tmux"
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
	profiles map[string]config.Profile
}

// NewManager creates a new session Manager.
func NewManager(store *Store, tmuxClient *tmux.Client, profiles map[string]config.Profile) *Manager {
	return &Manager{
		store:    store,
		tmux:     tmuxClient,
		profiles: profiles,
	}
}

// CreateRequest holds the parameters for creating a session.
type CreateRequest struct {
	AgentProfile string
	SessionName  string
	Env          map[string]string
	ExtraArgs    []string
}

// Create validates inputs, creates tmux session, starts command, returns Session.
func (m *Manager) Create(req CreateRequest) (*Session, error) {
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

	// Create tmux session. Use "/" as workdir for Phase 1 (no worktrees).
	if err := m.tmux.NewSession(sessionName, "/"); err != nil {
		errMsg := fmt.Sprintf("failed to create tmux session: %v", err)
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

	m.store.Update(sessionID, func(s *Session) {
		s.State = StateRunning
		s.AgentPID = pid
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

	if m.tmux.HasSession(sess.TmuxSession) {
		if err := m.tmux.KillSession(sess.TmuxSession); err != nil {
			slog.Warn("failed to kill tmux session", "session", sess.TmuxSession, "error", err)
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
	SessionID   string
	SessionName string
	ExtraArgs   string
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
		ExtraArgs:    strings.Join(extraArgs, " "),
		WorktreePath: "", // Phase 1: no worktrees
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("executing command template: %w", err)
	}
	return buf.String(), nil
}

func isProcessAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}
