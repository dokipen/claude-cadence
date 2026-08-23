package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
	sharedrelay "github.com/dokipen/claude-cadence/services/shared/relay"
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

// TestDispatcher_ListSessions_OmitsPromptContext verifies the Layer 3 contract
// from issue #685: listSessions is metadata-only (no prompt_context/prompt_type
// keys at all, but still waiting_for_input/idle_since so callers know which
// sessions to fetch), while getSession for the same id carries the prompt
// payload. Assertions are on raw JSON keys because omitempty makes an absent
// key and an empty string indistinguishable once decoded into sessionInfo.
func TestDispatcher_ListSessions_OmitsPromptContext(t *testing.T) {
	const id = "550e8400-e29b-41d4-a716-446655440010"
	idle := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	store := session.NewStore()
	store.Add(&session.Session{
		ID:              id,
		Name:            "prompt-session",
		AgentProfile:    "default",
		State:           session.StateRunning,
		WaitingForInput: true,
		IdleSince:       &idle,
		PromptContext:   "Do you want to proceed? (y/n)",
		PromptType:      "yes_no",
	})
	mgr := session.NewManager(store, nil, nil, nil, map[string]config.Profile{}, 0)
	d := NewDispatcher(mgr, "127.0.0.1", "ws", "", nil)

	decodeKeys := func(t *testing.T, raw json.RawMessage) map[string]any {
		t.Helper()
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("unmarshal into map: %v", err)
		}
		return m
	}

	// listSessions: metadata only.
	listRaw, rpcErr := d.ListSessions(json.RawMessage(`{}`))
	if rpcErr != nil {
		t.Fatalf("ListSessions: unexpected error: %v", rpcErr)
	}
	for _, key := range []string{"prompt_context", "prompt_type"} {
		if strings.Contains(string(listRaw), `"`+key+`"`) {
			t.Errorf("ListSessions JSON must not contain key %q, got: %s", key, listRaw)
		}
	}
	listSessions, ok := decodeKeys(t, listRaw)["sessions"].([]any)
	if !ok || len(listSessions) != 1 {
		t.Fatalf("expected 1 session in list, got: %s", listRaw)
	}
	listEntry := listSessions[0].(map[string]any)
	if v, ok := listEntry["waiting_for_input"].(bool); !ok || !v {
		t.Errorf("ListSessions entry must carry waiting_for_input=true, got: %v", listEntry["waiting_for_input"])
	}
	if _, ok := listEntry["idle_since"].(string); !ok {
		t.Errorf("ListSessions entry must carry idle_since, got: %v", listEntry["idle_since"])
	}
	if _, present := listEntry["prompt_context"]; present {
		t.Error("ListSessions entry must not have prompt_context key")
	}
	if _, present := listEntry["prompt_type"]; present {
		t.Error("ListSessions entry must not have prompt_type key")
	}

	// getSession: full per-session payload.
	getRaw, rpcErr := d.GetSession(json.RawMessage(fmt.Sprintf(`{"session_id":%q}`, id)))
	if rpcErr != nil {
		t.Fatalf("GetSession: unexpected error: %v", rpcErr)
	}
	getEntry, ok := decodeKeys(t, getRaw)["session"].(map[string]any)
	if !ok {
		t.Fatalf("expected session object, got: %s", getRaw)
	}
	if got, _ := getEntry["prompt_context"].(string); got != "Do you want to proceed? (y/n)" {
		t.Errorf("GetSession prompt_context = %q, want stored value", got)
	}
	if got, _ := getEntry["prompt_type"].(string); got != "yes_no" {
		t.Errorf("GetSession prompt_type = %q, want stored value", got)
	}
	if v, ok := getEntry["waiting_for_input"].(bool); !ok || !v {
		t.Errorf("GetSession must carry waiting_for_input=true, got: %v", getEntry["waiting_for_input"])
	}
}

// Worst-case sizing for the bounded listSessions payload test. These are
// deliberately generous upper bounds on each metadata field so the test fails
// loudly if a future field addition (or an unbounded field leaking back into
// the list) blows the budget. Real values are far smaller: IDs are 36-char
// UUIDs, names/profiles are short slugs, paths and URLs are a few hundred
// bytes at most.
const (
	// listSessionsWorstCaseSessions is the number of sessions in the
	// synthetic list. pty.max_sessions is configurable (0 = unlimited), so
	// this is a realistic operational ceiling rather than a hard cap.
	listSessionsWorstCaseSessions = 200
	// listSessionsWorstCaseShortField bounds short identifiers: id, name,
	// agent_profile, state, base_ref, created_at, idle_since.
	listSessionsWorstCaseShortField = 256
	// listSessionsWorstCaseLongField bounds the longer free-form strings:
	// worktree_path, repo_url, websocket_url, error_message.
	listSessionsWorstCaseLongField = 1024
	// listSessionsWorstCasePerSession is the budget for one serialized
	// session: 7 short fields + 4 long fields + JSON framing (keys, quotes,
	// commas, the agent_pid int and waiting_for_input bool). Keep this in
	// sync with sessionInfo; adding a field to the list response must be
	// accounted for here.
	listSessionsWorstCasePerSession = 7*listSessionsWorstCaseShortField + 4*listSessionsWorstCaseLongField + 512
)

// TestListSessions_WorstCasePayloadBounded asserts that a listSessions
// response at a realistic upper bound (many sessions, every metadata field at
// a generous worst-case length) stays comfortably under the hub's agent
// message limit. This is the bound that makes listSessions "bounded by
// construction" per issue #685: the only unbounded field (prompt_context) is
// never present in the list, so the size is N * (small constant).
func TestListSessions_WorstCasePayloadBounded(t *testing.T) {
	short := strings.Repeat("s", listSessionsWorstCaseShortField)
	long := strings.Repeat("L", listSessionsWorstCaseLongField)

	infos := make([]sessionInfo, listSessionsWorstCaseSessions)
	for i := range infos {
		idle := short
		infos[i] = sessionInfo{
			ID:              short,
			Name:            short,
			AgentProfile:    short,
			State:           short,
			WorktreePath:    long,
			RepoURL:         long,
			BaseRef:         short,
			CreatedAt:       short,
			ErrorMessage:    long,
			AgentPID:        2147483647,
			WebsocketURL:    long,
			WaitingForInput: true,
			IdleSince:       &idle,
			// PromptContext/PromptType intentionally absent: ListSessions
			// never populates them (see toSessionInfo includePrompt=false).
		}
	}

	b, err := json.Marshal(sessionsJSON{Sessions: infos})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	size := len(b)
	budget := listSessionsWorstCaseSessions * listSessionsWorstCasePerSession
	limit := sharedrelay.AgentMaxMessageSize / 4
	t.Logf("worst-case listSessions payload: sessions=%d size=%d bytes (per-session budget=%d, total budget=%d, hub limit/4=%d)",
		listSessionsWorstCaseSessions, size, listSessionsWorstCasePerSession, budget, limit)

	if size > budget {
		t.Errorf("serialized size %d exceeds per-session budget total %d; a field was added to sessionInfo without updating listSessionsWorstCasePerSession", size, budget)
	}
	if size >= limit {
		t.Errorf("serialized size %d must be < AgentMaxMessageSize/4 (%d)", size, limit)
	}

	// The per-session budget must itself be meaningful: a sessionsJSON made
	// of these sessions must not be able to carry the unbounded field.
	if strings.Contains(string(b), `"prompt_context"`) {
		t.Error("worst-case list payload must not contain prompt_context")
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
		code            session.ErrorCode
		expectedCode    int
		expectedMessage string
	}{
		{session.ErrNotFound, rpcErrNotFound, "test"},
		{session.ErrAlreadyExists, rpcErrAlreadyExists, "test"},
		{session.ErrInvalidArgument, rpcErrInvalidArgument, "test"},
		{session.ErrFailedPrecondition, rpcErrFailedPrecondition, "test"},
		{session.ErrResourceExhausted, rpcErrResourceExhausted, "test"},
		{session.ErrInternal, rpcErrInternal, "internal error"},
	}

	for _, tt := range tests {
		err := &session.Error{Code: tt.code, Message: "test"}
		rpcErr := mapSessionError(err)
		if rpcErr.Code != tt.expectedCode {
			t.Errorf("ErrorCode %d: expected RPC code %d, got %d", tt.code, tt.expectedCode, rpcErr.Code)
		}
		if rpcErr.Message != tt.expectedMessage {
			t.Errorf("ErrorCode %d: expected message %q, got %q", tt.code, tt.expectedMessage, rpcErr.Message)
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

func TestMapPTYError(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		wantCode    int
		wantMessage string
	}{
		{
			name:        "sentinel wrapped error maps to not found",
			err:         fmt.Errorf("pty: session %q not found: %w", "abc", pty.ErrSessionNotFound),
			wantCode:    rpcErrNotFound,
			wantMessage: "pty session not found",
		},
		{
			name:        "unwrapped sentinel maps to not found",
			err:         pty.ErrSessionNotFound,
			wantCode:    rpcErrNotFound,
			wantMessage: "pty session not found",
		},
		{
			name:        "unrelated error maps to internal",
			err:         errors.New("some other error"),
			wantCode:    rpcErrInternal,
			wantMessage: "internal error",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mapPTYError(tt.err)
			if got.Code != tt.wantCode {
				t.Errorf("mapPTYError(%v).Code = %v, want %v", tt.err, got.Code, tt.wantCode)
			}
			if got.Message != tt.wantMessage {
				t.Errorf("mapPTYError(%v).Message = %q, want %q", tt.err, got.Message, tt.wantMessage)
			}
		})
	}
}

func TestDispatcher_JSONErrorLeakage(t *testing.T) {
	d := newTestDispatcher()

	// Provide params that are valid JSON but have a type mismatch for a field.
	// env should be map[string]string, not a number.
	params := json.RawMessage(`{"env": 123}`)
	_, rpcErr := d.CreateSession(params)

	if rpcErr == nil {
		t.Fatal("expected rpcError for type mismatch")
	}

	// Verify that the error message is sanitized and does not contain Go-isms.
	if rpcErr.Message != "invalid parameters" {
		t.Errorf("expected message %q, got %q", "invalid parameters", rpcErr.Message)
	}
}
