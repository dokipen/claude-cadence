package hub

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

// newFakeManager creates a session.Manager backed by an in-memory store
// with no external dependencies (no pty, no git, no vault).
func newFakeManager() *session.Manager {
	store := session.NewStore()
	return session.NewManager(store, nil, nil, nil, map[string]config.Profile{}, 0)
}

func newTestDispatcher() *Dispatcher {
	return NewDispatcher(newFakeManager(), "127.0.0.1", "ws", "", nil)
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

	_, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"550e8400-e29b-41d4-a716-446655440000"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for nonexistent session")
	}
	if rpcErr.Code != rpcErrNotFound {
		t.Errorf("expected code %d, got %d", rpcErrNotFound, rpcErr.Code)
	}
}

func TestDispatcher_GetTerminalEndpoint_RelayWhenNoAdvertiseAddress(t *testing.T) {
	// When no advertise_address is configured, the dispatcher returns {relay: true}
	// so the Client can start a relay pump over the hub WebSocket.
	store := session.NewStore()
	store.Add(&session.Session{ID: "550e8400-e29b-41d4-a716-446655440001", State: session.StateStopped})
	mgr := session.NewManager(store, nil, nil, nil, map[string]config.Profile{}, 0)
	d := NewDispatcher(mgr, "", "ws", "", nil) // empty advertise address → relay path

	result, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"550e8400-e29b-41d4-a716-446655440001"}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpcError: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}

	var out terminalEndpointResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if !out.Relay {
		t.Error("expected relay: true when no advertise_address configured")
	}
	if out.URL != "" {
		t.Errorf("expected empty URL for relay response, got: %s", out.URL)
	}
}

func TestDispatcher_GetTerminalEndpoint_Success(t *testing.T) {
	store := session.NewStore()
	store.Add(&session.Session{ID: "550e8400-e29b-41d4-a716-446655440002", State: session.StateStopped})
	mgr := session.NewManager(store, nil, nil, nil, map[string]config.Profile{}, 0)
	d := NewDispatcher(mgr, "192.168.1.10", "ws", "", nil)

	result, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"550e8400-e29b-41d4-a716-446655440002"}`))
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
	if out.URL != "ws://192.168.1.10/ws/terminal/550e8400-e29b-41d4-a716-446655440002" {
		t.Errorf("unexpected URL: %s", out.URL)
	}
}

func TestDispatcher_GetTerminalEndpoint_WSSScheme(t *testing.T) {
	store := session.NewStore()
	store.Add(&session.Session{ID: "550e8400-e29b-41d4-a716-446655440003", State: session.StateStopped})
	mgr := session.NewManager(store, nil, nil, nil, map[string]config.Profile{}, 0)
	d := NewDispatcher(mgr, "example.com", "wss", "", nil)

	result, rpcErr := d.GetTerminalEndpoint(json.RawMessage(`{"session_id":"550e8400-e29b-41d4-a716-446655440003"}`))
	if rpcErr != nil {
		t.Fatalf("unexpected error: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}

	var out terminalEndpointResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if out.URL != "wss://example.com/ws/terminal/550e8400-e29b-41d4-a716-446655440003" {
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

func TestDispatcher_GetTerminalEndpoint_InvalidSessionID(t *testing.T) {
	cases := []struct {
		name      string
		sessionID string
	}{
		{"dot_dot", "../evil"},
		{"absolute_path", "/etc/passwd"},
		{"percent_slash", "%2F"},
		{"empty", ""},
		{"whitespace", "   "},
		{"uuid_plus_path", "550e8400-e29b-41d4-a716-446655440000/../../admin"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := newTestDispatcher()
			params, _ := json.Marshal(map[string]string{"session_id": tc.sessionID})
			_, rpcErr := d.GetTerminalEndpoint(params)
			if rpcErr == nil {
				t.Fatalf("expected rpcError for session_id %q, got nil", tc.sessionID)
			}
			if rpcErr.Code != rpcErrInvalidArgument {
				t.Errorf("expected InvalidArgument (%d), got %d", rpcErrInvalidArgument, rpcErr.Code)
			}
		})
	}
}

func TestDispatcher_GetTerminalEndpoint_URNFormNormalized(t *testing.T) {
	// uuid.Parse accepts URN-prefixed UUIDs ("urn:uuid:...") — verify the URL
	// uses the normalized canonical form (no colon in path), not the raw input.
	const canonicalID = "550e8400-e29b-41d4-a716-446655440002"
	store := session.NewStore()
	store.Add(&session.Session{ID: canonicalID, State: session.StateStopped})
	mgr := session.NewManager(store, nil, nil, nil, map[string]config.Profile{}, 0)
	d := NewDispatcher(mgr, "192.168.1.10", "ws", "", nil)

	urnForm := "urn:uuid:" + canonicalID
	params, _ := json.Marshal(map[string]string{"session_id": urnForm})
	result, rpcErr := d.GetTerminalEndpoint(params)
	if rpcErr != nil {
		t.Fatalf("unexpected rpcError: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}
	var out terminalEndpointResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	want := "ws://192.168.1.10/ws/terminal/" + canonicalID
	if out.URL != want {
		t.Errorf("URL = %q, want %q", out.URL, want)
	}
}

func TestDispatcher_GetSessionOutput_UnknownSession(t *testing.T) {
	d := newTestDispatcher()

	_, rpcErr := d.GetSessionOutput(json.RawMessage(`{"session_id":"no-such-session"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for unknown session")
	}
	if rpcErr.Code != rpcErrNotFound {
		t.Errorf("expected code %d (not found), got %d", rpcErrNotFound, rpcErr.Code)
	}
}

func TestDispatcher_GetSessionOutput_ANSIStrippingAndLastNLines(t *testing.T) {
	// Create a real PTY session that writes a known multi-line string with ANSI
	// escape sequences so we can verify stripping and last-N-lines truncation.
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{})
	sessID := "output-test-session"

	// Print 5 numbered lines with ANSI color codes interspersed.
	script := `printf '\033[32mline1\033[0m\nline2\nline3\nline4\nline5\n'; sleep 30`
	err := ptyMgr.Create(sessID, t.TempDir(), []string{"sh", "-c", script}, nil, 80, 24)
	if err != nil {
		t.Fatalf("PTY Create failed: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	// Poll until at least "line5" appears in the raw buffer.
	deadline := time.Now().Add(5 * time.Second)
	for {
		buf, readErr := ptyMgr.ReadBuffer(sessID)
		if readErr != nil {
			t.Fatalf("ReadBuffer failed: %v", readErr)
		}
		if strings.Contains(string(buf), "line5") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for output in buffer; got: %q", string(buf))
		}
		time.Sleep(10 * time.Millisecond)
	}

	store := session.NewStore()
	mgr := session.NewManager(store, ptyMgr, nil, nil, map[string]config.Profile{}, 0)
	d := NewDispatcher(mgr, "", "ws", "", nil)

	// Request only the last 3 lines.
	result, rpcErr := d.GetSessionOutput(json.RawMessage(`{"session_id":"output-test-session","lines":3}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpcError: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}

	var out sessionOutputResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}

	// ANSI escape sequences must be stripped.
	if strings.Contains(out.Output, "\x1b") {
		t.Errorf("output still contains ANSI escape sequences: %q", out.Output)
	}

	// Output must contain "line5" (one of the last 3 lines).
	if !strings.Contains(out.Output, "line5") {
		t.Errorf("expected 'line5' in output, got: %q", out.Output)
	}

	// Output must NOT contain "line1" or "line2" (outside the last 3).
	if strings.Contains(out.Output, "line1") || strings.Contains(out.Output, "line2") {
		t.Errorf("output should only contain last 3 lines, got: %q", out.Output)
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

func TestDispatcher_SendInput_InvalidJSON(t *testing.T) {
	d := newTestDispatcher()

	_, rpcErr := d.SendInput(json.RawMessage(`{"invalid`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for invalid JSON")
	}
	if rpcErr.Code != rpcErrInvalidArgument {
		t.Errorf("expected code %d, got %d", rpcErrInvalidArgument, rpcErr.Code)
	}
}

func TestDispatcher_SendInput_SessionNotFound(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{})
	mgr := session.NewManager(session.NewStore(), ptyMgr, nil, nil, map[string]config.Profile{}, 0)
	d := NewDispatcher(mgr, "127.0.0.1", "ws", "", ptyMgr)

	_, rpcErr := d.SendInput(json.RawMessage(`{"session_id":"no-such","text":"y\n"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError for session not found")
	}
	if rpcErr.Code != rpcErrNotFound {
		t.Errorf("expected code %d, got %d", rpcErrNotFound, rpcErr.Code)
	}
}

func TestDispatcher_SendInput_Success(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{})
	sessID := "send-input-test-session"

	err := ptyMgr.Create(sessID, t.TempDir(), []string{"cat"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("PTY Create failed: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	mgr := session.NewManager(session.NewStore(), ptyMgr, nil, nil, map[string]config.Profile{}, 0)
	d := NewDispatcher(mgr, "127.0.0.1", "ws", "", ptyMgr)

	params, _ := json.Marshal(map[string]string{"session_id": sessID, "text": "hello\n"})
	result, rpcErr := d.SendInput(params)
	if rpcErr != nil {
		t.Fatalf("unexpected rpcError: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}

	var out map[string]bool
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if !out["ok"] {
		t.Errorf("expected ok:true in result, got: %v", out)
	}

	// Poll the ring buffer until "hello" is echoed back by cat.
	deadline := time.Now().Add(5 * time.Second)
	for {
		buf, readErr := ptyMgr.ReadBuffer(sessID)
		if readErr != nil {
			t.Fatalf("ReadBuffer failed: %v", readErr)
		}
		if strings.Contains(string(buf), "hello") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for echoed output; got: %q", string(buf))
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestDispatcher_SendInput_NilPTYManager(t *testing.T) {
	d := newTestDispatcher() // nil pty

	_, rpcErr := d.SendInput(json.RawMessage(`{"session_id":"any","text":"y\n"}`))
	if rpcErr == nil {
		t.Fatal("expected rpcError when PTY manager is nil")
	}
	if rpcErr.Code != rpcErrInternal {
		t.Errorf("expected code %d (rpcErrInternal), got %d", rpcErrInternal, rpcErr.Code)
	}
}
