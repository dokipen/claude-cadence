package hub

import (
	"encoding/json"
	"testing"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

// newFakeManager creates a session.Manager backed by an in-memory store
// with no external dependencies (no pty, no git, no vault).
func newFakeManager() *session.Manager {
	store := session.NewStore()
	return session.NewManager(store, nil, nil, nil, map[string]config.Profile{})
}

func newTestDispatcher() *Dispatcher {
	return NewDispatcher(newFakeManager(), "127.0.0.1")
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

func TestDispatcher_GetTerminalEndpoint_NoAdvertiseAddress(t *testing.T) {
	// Session exists but no advertise address configured.
	store := session.NewStore()
	store.Add(&session.Session{ID: "s1", State: session.StateStopped})
	mgr := session.NewManager(store, nil, nil, nil, map[string]config.Profile{})
	d := NewDispatcher(mgr, "") // empty advertise address

	_, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"s1"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError when no advertise address configured")
	}
	if rpcErr.Code != rpcErrInternal {
		t.Errorf("expected code %d, got %d", rpcErrInternal, rpcErr.Code)
	}
}

func TestDispatcher_GetTerminalEndpoint_Success(t *testing.T) {
	store := session.NewStore()
	store.Add(&session.Session{ID: "s1", State: session.StateStopped})
	mgr := session.NewManager(store, nil, nil, nil, map[string]config.Profile{})
	d := NewDispatcher(mgr, "192.168.1.10")

	result, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"s1"}`))
	if rpcErr != nil {
		t.Fatalf("unexpected error: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}

	var out terminalEndpointResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if out.URL == "" {
		t.Error("expected non-empty URL")
	}
	// URL should contain the advertise address and session ID.
	if out.URL != "ws://192.168.1.10/ws/terminal/s1" {
		t.Errorf("unexpected URL: %s", out.URL)
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
