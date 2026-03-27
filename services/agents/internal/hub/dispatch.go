package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/dokipen/claude-cadence/services/agents/internal/logparse"
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
	manager          *session.Manager
	advertiseAddress string
	webSocketScheme  string
	logPath          string
}

// NewDispatcher creates a Dispatcher backed by the given session manager.
// advertiseAddress enables the getTerminalEndpoint RPC method.
// logPath is the path to agentd's stderr log file; empty means journald on Linux.
func NewDispatcher(manager *session.Manager, advertiseAddress string, webSocketScheme string, logPath string) *Dispatcher {
	return &Dispatcher{manager: manager, advertiseAddress: advertiseAddress, webSocketScheme: webSocketScheme, logPath: logPath}
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

	// Apply waiting_for_input filter if provided.
	if p.WaitingForInput != nil {
		filtered := make([]*session.Session, 0, len(sessions))
		for _, s := range sessions {
			if s.WaitingForInput == *p.WaitingForInput {
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

// GetTerminalEndpoint handles the getTerminalEndpoint JSON-RPC method.
//
// If relay is available (no advertise_address configured), it returns
// {relay: true} and the Client will start a terminal relay pump over the hub
// WebSocket. If advertise_address is configured, it falls back to the direct
// URL-based response for backward compatibility.
func (d *Dispatcher) GetTerminalEndpoint(params json.RawMessage) (json.RawMessage, *rpcError) {
	var p getTerminalEndpointParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: rpcErrInvalidArgument, Message: "invalid params: " + err.Error()}
	}

	sessionID, err := uuid.Parse(p.SessionID)
	if err != nil {
		return nil, &rpcError{Code: rpcErrInvalidArgument, Message: "invalid session_id: must be a UUID"}
	}

	// Verify session exists. Use the normalized form so URN/brace UUIDs resolve
	// to the same key as the canonical hyphenated form used at creation time.
	if _, err := d.manager.Get(sessionID.String()); err != nil {
		return nil, mapSessionError(err)
	}

	// Prefer relay path when no advertise_address is configured.
	if d.advertiseAddress == "" {
		return marshalResult(terminalEndpointResult{Relay: true})
	}

	// Backward compat: return a direct URL when advertise_address is set.
	// Use sessionID.String() (normalized canonical form) rather than the raw
	// p.SessionID to prevent non-standard UUID forms (URN prefix, braces) from
	// reaching the URL.
	return marshalResult(terminalEndpointResult{
		URL: d.webSocketScheme + "://" + d.advertiseAddress + "/ws/terminal/" + sessionID.String(),
	})
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
	AgentProfile    string `json:"agent_profile"`
	State           string `json:"state"`
	WaitingForInput *bool  `json:"waiting_for_input,omitempty"`
}

type destroySessionParams struct {
	SessionID string `json:"session_id"`
	Force     bool   `json:"force"`
}

type getTerminalEndpointParams struct {
	SessionID string `json:"session_id"`
}

type terminalEndpointResult struct {
	URL   string `json:"url,omitempty"`
	Relay bool   `json:"relay,omitempty"`
}

// JSON response types.

type sessionInfo struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	AgentProfile    string  `json:"agent_profile"`
	State           string  `json:"state"`
	WorktreePath    string  `json:"worktree_path,omitempty"`
	RepoURL         string  `json:"repo_url,omitempty"`
	BaseRef         string  `json:"base_ref,omitempty"`
	CreatedAt       string  `json:"created_at"`
	ErrorMessage    string  `json:"error_message,omitempty"`
	AgentPID        int     `json:"agent_pid,omitempty"`
	WebsocketURL    string  `json:"websocket_url,omitempty"`
	WaitingForInput bool    `json:"waiting_for_input"`
	IdleSince       *string `json:"idle_since,omitempty"`
}

type sessionJSON struct {
	Session sessionInfo `json:"session"`
}

type sessionsJSON struct {
	Sessions []sessionInfo `json:"sessions"`
}

func toSessionInfo(s *session.Session) sessionInfo {
	if s == nil {
		return sessionInfo{}
	}
	info := sessionInfo{
		ID:              s.ID,
		Name:            s.Name,
		AgentProfile:    s.AgentProfile,
		State:           stateString(s.State),
		WorktreePath:    s.WorktreePath,
		RepoURL:         s.RepoURL,
		BaseRef:         s.BaseRef,
		CreatedAt:       s.CreatedAt.Format(time.RFC3339),
		ErrorMessage:    s.ErrorMessage,
		AgentPID:        s.AgentPID,
		WebsocketURL:    s.WebsocketURL,
		WaitingForInput: s.WaitingForInput,
	}
	if s.IdleSince != nil {
		t := s.IdleSince.Format(time.RFC3339)
		info.IdleSince = &t
	}
	return info
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
		slog.Error("unexpected session error", "error", err)
		return &rpcError{Code: rpcErrInternal, Message: "internal error"}
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

// GetDiagnostics handles the getDiagnostics JSON-RPC method.
// It reads log events since the requested window and returns them alongside current session state.
func (d *Dispatcher) GetDiagnostics(params json.RawMessage) (json.RawMessage, *rpcError) {
	var p getDiagnosticsParams
	if len(params) > 0 {
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, &rpcError{Code: rpcErrInvalidArgument, Message: "invalid params: " + err.Error()}
		}
	}
	if p.SinceMinutes <= 0 {
		p.SinceMinutes = 10080 // default: 7 days
	}

	since := time.Now().Add(-time.Duration(p.SinceMinutes) * time.Minute)

	events, err := logparse.ParseLogs(context.Background(), d.logPath, since)
	if err != nil {
		slog.Warn("getDiagnostics: failed to parse logs", "error", err)
	}
	if events == nil {
		events = []logparse.DiagnosticEvent{}
	}

	sessions, err := d.manager.List("")
	if err != nil {
		return nil, mapSessionError(err)
	}

	var byState sessionsByState
	byState.Running = []sessionInfo{}
	byState.Stopped = []sessionInfo{}
	byState.Error = []sessionInfo{}
	byState.Creating = []sessionInfo{}

	for _, s := range sessions {
		info := toSessionInfo(s)
		switch s.State {
		case session.StateRunning:
			byState.Running = append(byState.Running, info)
		case session.StateStopped:
			byState.Stopped = append(byState.Stopped, info)
		case session.StateError:
			byState.Error = append(byState.Error, info)
		case session.StateCreating:
			byState.Creating = append(byState.Creating, info)
		}
	}

	summary := diagnosticsSummary{
		SinceMinutes:  p.SinceMinutes,
		TotalSessions: len(sessions),
	}
	for _, ev := range events {
		switch ev.Type {
		case logparse.EventSessionDeath:
			summary.DeathCount++
		case logparse.EventFastExit:
			summary.FastExitCount++
		case logparse.EventStuckCreating:
			summary.StuckCreatingCount++
		case logparse.EventStaleTTL:
			summary.StaleTTLCount++
		case logparse.EventHubDisconnect:
			summary.HubDisconnectCount++
		}
	}
	for _, s := range sessions {
		switch s.State {
		case session.StateRunning:
			summary.RunningCount++
		case session.StateError:
			summary.ErrorCount++
		}
	}

	return marshalResult(diagnosticsResult{
		Events:   events,
		Sessions: byState,
		Summary:  summary,
	})
}

type getDiagnosticsParams struct {
	SinceMinutes int `json:"since_minutes"`
}

type diagnosticsResult struct {
	Events   []logparse.DiagnosticEvent `json:"events"`
	Sessions sessionsByState            `json:"sessions"`
	Summary  diagnosticsSummary         `json:"summary"`
}

type sessionsByState struct {
	Running  []sessionInfo `json:"running"`
	Stopped  []sessionInfo `json:"stopped"`
	Error    []sessionInfo `json:"error"`
	Creating []sessionInfo `json:"creating"`
}

type diagnosticsSummary struct {
	SinceMinutes       int `json:"since_minutes"`
	DeathCount         int `json:"death_count"`
	FastExitCount      int `json:"fast_exit_count"`
	StuckCreatingCount int `json:"stuck_creating_count"`
	StaleTTLCount      int `json:"stale_ttl_count"`
	HubDisconnectCount int `json:"hub_disconnect_count"`
	TotalSessions      int `json:"total_sessions"`
	RunningCount       int `json:"running_count"`
	ErrorCount         int `json:"error_count"`
}

func marshalResult(v any) (json.RawMessage, *rpcError) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, &rpcError{Code: rpcErrInternal, Message: "marshal result: " + err.Error()}
	}
	return b, nil
}
