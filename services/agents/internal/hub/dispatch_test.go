package hub

import (
	"encoding/json"
	"testing"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

// noopTtyd implements TerminalEndpointProvider for tests.
type noopTtyd struct {
	ports map[string]int
}

func (n *noopTtyd) Port(sessionID string) int {
	if n.ports == nil {
		return 0
	}
	return n.ports[sessionID]
}

// newFakeManager creates a session.Manager backed by an in-memory store
// with no external dependencies (no tmux, no git, no vault, no ttyd).
func newFakeManager() *session.Manager {
	store := session.NewStore()
	return session.NewManager(store, nil, nil, nil, nil, map[string]config.Profile{})
}

func newTestDispatcher() *Dispatcher {
	return NewDispatcher(newFakeManager(), &noopTtyd{}, "127.0.0.1")
}

func TestDispatcher_CreateSession_InvalidParams(t *testing.T) {
	d := newTestDispatcher()

	_, rpcErr := d.CreateSession(json.RawMessage(`{invalid`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for invalid JSON")
	}
	if rpcErr.Code != rpcErrInvalidArgument {
		t.Errorf("expected code %d, got %d", rpcErrInvalidArgument, rpcErr.Code)
	}
}

func TestDispatcher_GetSession_NotFound(t *testing.T) {
	d := newTestDispatcher()

	_, rpcErr := d.GetSession(json.RawMessage(`{"session_id":"nonexistent"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for nonexistent session")
	}
	if rpcErr.Code != rpcErrNotFound {
		t.Errorf("expected code %d, got %d", rpcErrNotFound, rpcErr.Code)
	}
}

func TestDispatcher_ListSessions_Empty(t *testing.T) {
	d := newTestDispatcher()

	result, rpcErr := d.ListSessions(json.RawMessage(`{}`))
	if rpcErr != nil {
		t.Fatalf("unexpected error: %v", rpcErr)
	}

	var out sessionsJSON
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if len(out.Sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(out.Sessions))
	}
}

func TestDispatcher_DestroySession_NotFound(t *testing.T) {
	d := newTestDispatcher()

	_, rpcErr := d.DestroySession(json.RawMessage(`{"session_id":"nonexistent"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for nonexistent session")
	}
	if rpcErr.Code != rpcErrNotFound {
		t.Errorf("expected code %d, got %d", rpcErrNotFound, rpcErr.Code)
	}
}

func TestDispatcher_GetTerminalEndpoint_InvalidParams(t *testing.T) {
	d := newTestDispatcher()

	_, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{invalid`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for invalid JSON")
	}
	if rpcErr.Code != rpcErrInvalidArgument {
		t.Errorf("expected code %d, got %d", rpcErrInvalidArgument, rpcErr.Code)
	}
}

func TestDispatcher_GetTerminalEndpoint_SessionNotFound(t *testing.T) {
	d := newTestDispatcher()

	_, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"nonexistent"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for nonexistent session")
	}
	if rpcErr.Code != rpcErrNotFound {
		t.Errorf("expected code %d, got %d", rpcErrNotFound, rpcErr.Code)
	}
}

func TestDispatcher_GetTerminalEndpoint_NoTtyd(t *testing.T) {
	// Session exists but no ttyd process running.
	store := session.NewStore()
	store.Add(&session.Session{ID: "s1", State: session.StateStopped})
	mgr := session.NewManager(store, nil, nil, nil, nil, map[string]config.Profile{})
	d := NewDispatcher(mgr, &noopTtyd{}, "192.168.1.10")

	_, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"s1"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError when no ttyd process")
	}
	if rpcErr.Code != rpcErrNotFound {
		t.Errorf("expected code %d, got %d", rpcErrNotFound, rpcErr.Code)
	}
}

func TestDispatcher_GetTerminalEndpoint_Success(t *testing.T) {
	store := session.NewStore()
	store.Add(&session.Session{ID: "s1", State: session.StateStopped})
	mgr := session.NewManager(store, nil, nil, nil, nil, map[string]config.Profile{})
	ttyd := &noopTtyd{ports: map[string]int{"s1": 7682}}
	d := NewDispatcher(mgr, ttyd, "192.168.1.10")

	result, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"s1"}`))
	if rpcErr != nil {
		t.Fatalf("unexpected error: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}

	var out terminalEndpointResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if out.Address != "192.168.1.10" {
		t.Errorf("expected address 192.168.1.10, got %s", out.Address)
	}
	if out.Port != 7682 {
		t.Errorf("expected port 7682, got %d", out.Port)
	}
}

func TestMapSessionError(t *testing.T) {
	tests := []struct {
		code     session.ErrorCode
		expected int
	}{
		{session.ErrNotFound, rpcErrNotFound},
		{session.ErrAlreadyExists, rpcErrAlreadyExists},
		{session.ErrInvalidArgument, rpcErrInvalidArgument},
		{session.ErrFailedPrecondition, rpcErrFailedPrecondition},
		{session.ErrInternal, rpcErrInternal},
	}

	for _, tt := range tests {
		err := &session.Error{Code: tt.code, Message: "test"}
		rpcErr := mapSessionError(err)
		if rpcErr.Code != tt.expected {
			t.Errorf("ErrorCode %d: expected RPC code %d, got %d", tt.code, tt.expected, rpcErr.Code)
		}
	}
}

func TestStateString(t *testing.T) {
	tests := []struct {
		state    session.SessionState
		expected string
	}{
		{session.StateCreating, "creating"},
		{session.StateRunning, "running"},
		{session.StateStopped, "stopped"},
		{session.StateError, "error"},
		{session.StateDestroying, "destroying"},
		{session.SessionState(99), "unknown"},
	}

	for _, tt := range tests {
		got := stateString(tt.state)
		if got != tt.expected {
			t.Errorf("stateString(%d): expected %q, got %q", tt.state, tt.expected, got)
		}
	}
}
