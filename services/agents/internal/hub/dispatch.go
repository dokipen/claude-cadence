package hub

import (
	"encoding/json"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

// JSON-RPC error codes matching the hub protocol.
const (
	rpcErrNotFound           = -32001
	rpcErrAlreadyExists      = -32002
	rpcErrInvalidArgument    = -32003
	rpcErrFailedPrecondition = -32004
	rpcErrInternal           = -32000
)

// Dispatcher implements SessionDispatcher by calling the session manager directly.
type Dispatcher struct {
	manager *session.Manager
}

// NewDispatcher creates a Dispatcher backed by the given session manager.
func NewDispatcher(manager *session.Manager) *Dispatcher {
	return &Dispatcher{manager: manager}
}

// CreateSession handles the createSession JSON-RPC method.
func (d *Dispatcher) CreateSession(params json.RawMessage) (json.RawMessage, *rpcError) {
	var p createSessionParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: rpcErrInvalidArgument, Message: "invalid params: " + err.Error()}
	}

	sess, err := d.manager.Create(session.CreateRequest{
		AgentProfile: p.AgentProfile,
		SessionName:  p.SessionName,
		BaseRef:      p.BaseRef,
		Env:          p.Env,
		ExtraArgs:    p.ExtraArgs,
	})
	if err != nil {
		return nil, mapSessionError(err)
	}

	return marshalResult(sessionJSON{Session: toSessionInfo(sess)})
}

// GetSession handles the getSession JSON-RPC method.
func (d *Dispatcher) GetSession(params json.RawMessage) (json.RawMessage, *rpcError) {
	var p getSessionParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: rpcErrInvalidArgument, Message: "invalid params: " + err.Error()}
	}

	sess, err := d.manager.Get(p.SessionID)
	if err != nil {
		return nil, mapSessionError(err)
	}

	return marshalResult(sessionJSON{Session: toSessionInfo(sess)})
}

// ListSessions handles the listSessions JSON-RPC method.
func (d *Dispatcher) ListSessions(params json.RawMessage) (json.RawMessage, *rpcError) {
	var p listSessionsParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: rpcErrInvalidArgument, Message: "invalid params: " + err.Error()}
	}

	sessions, err := d.manager.List(p.AgentProfile)
	if err != nil {
		return nil, mapSessionError(err)
	}

	// Apply state filter if provided (manager.List only filters by profile).
	if p.State != "" {
		filtered := make([]*session.Session, 0, len(sessions))
		for _, s := range sessions {
			if stateString(s.State) == p.State {
				filtered = append(filtered, s)
			}
		}
		sessions = filtered
	}

	infos := make([]sessionInfo, len(sessions))
	for i, s := range sessions {
		infos[i] = toSessionInfo(s)
	}

	return marshalResult(sessionsJSON{Sessions: infos})
}

// DestroySession handles the destroySession JSON-RPC method.
func (d *Dispatcher) DestroySession(params json.RawMessage) (json.RawMessage, *rpcError) {
	var p destroySessionParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: rpcErrInvalidArgument, Message: "invalid params: " + err.Error()}
	}

	if err := d.manager.Destroy(p.SessionID, p.Force); err != nil {
		return nil, mapSessionError(err)
	}

	return marshalResult(map[string]bool{"ok": true})
}

// JSON param types for each RPC method.

type createSessionParams struct {
	AgentProfile string            `json:"agent_profile"`
	SessionName  string            `json:"session_name"`
	BaseRef      string            `json:"base_ref"`
	Env          map[string]string `json:"env"`
	ExtraArgs    []string          `json:"extra_args"`
}

type getSessionParams struct {
	SessionID string `json:"session_id"`
}

type listSessionsParams struct {
	AgentProfile string `json:"agent_profile"`
	State        string `json:"state"`
}

type destroySessionParams struct {
	SessionID string `json:"session_id"`
	Force     bool   `json:"force"`
}

// JSON response types.

type sessionInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	AgentProfile string `json:"agent_profile"`
	State        string `json:"state"`
	WorktreePath string `json:"worktree_path,omitempty"`
	RepoURL      string `json:"repo_url,omitempty"`
	BaseRef      string `json:"base_ref,omitempty"`
	TmuxSession  string `json:"tmux_session,omitempty"`
	CreatedAt    string `json:"created_at"`
	ErrorMessage string `json:"error_message,omitempty"`
	AgentPID     int    `json:"agent_pid,omitempty"`
	WebsocketURL string `json:"websocket_url,omitempty"`
}

type sessionJSON struct {
	Session sessionInfo `json:"session"`
}

type sessionsJSON struct {
	Sessions []sessionInfo `json:"sessions"`
}

func toSessionInfo(s *session.Session) sessionInfo {
	return sessionInfo{
		ID:           s.ID,
		Name:         s.Name,
		AgentProfile: s.AgentProfile,
		State:        stateString(s.State),
		WorktreePath: s.WorktreePath,
		RepoURL:      s.RepoURL,
		BaseRef:      s.BaseRef,
		TmuxSession:  s.TmuxSession,
		CreatedAt:    s.CreatedAt.Format(time.RFC3339),
		ErrorMessage: s.ErrorMessage,
		AgentPID:     s.AgentPID,
		WebsocketURL: s.WebsocketURL,
	}
}

func stateString(s session.SessionState) string {
	switch s {
	case session.StateCreating:
		return "creating"
	case session.StateRunning:
		return "running"
	case session.StateStopped:
		return "stopped"
	case session.StateError:
		return "error"
	case session.StateDestroying:
		return "destroying"
	default:
		return "unknown"
	}
}

func mapSessionError(err error) *rpcError {
	sessErr, ok := err.(*session.Error)
	if !ok {
		return &rpcError{Code: rpcErrInternal, Message: err.Error()}
	}
	switch sessErr.Code {
	case session.ErrNotFound:
		return &rpcError{Code: rpcErrNotFound, Message: sessErr.Message}
	case session.ErrAlreadyExists:
		return &rpcError{Code: rpcErrAlreadyExists, Message: sessErr.Message}
	case session.ErrInvalidArgument:
		return &rpcError{Code: rpcErrInvalidArgument, Message: sessErr.Message}
	case session.ErrFailedPrecondition:
		return &rpcError{Code: rpcErrFailedPrecondition, Message: sessErr.Message}
	default:
		return &rpcError{Code: rpcErrInternal, Message: sessErr.Message}
	}
}

func marshalResult(v any) (json.RawMessage, *rpcError) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, &rpcError{Code: rpcErrInternal, Message: "marshal result: " + err.Error()}
	}
	return b, nil
}
