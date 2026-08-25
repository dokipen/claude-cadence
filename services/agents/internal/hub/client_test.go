package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
)

// stubDispatcher is a minimal SessionDispatcher that returns empty success
// results for all methods. It is used in tests that exercise the Client
// connection lifecycle without needing real session logic.
type stubDispatcher struct{}

func (s *stubDispatcher) CreateSession(_ json.RawMessage) (json.RawMessage, *rpcError) {
	return json.RawMessage(`{}`), nil
}
func (s *stubDispatcher) GetSession(_ json.RawMessage) (json.RawMessage, *rpcError) {
	return json.RawMessage(`{}`), nil
}
func (s *stubDispatcher) ListSessions(_ json.RawMessage) (json.RawMessage, *rpcError) {
	return json.RawMessage(`{"sessions":[]}`), nil
}
func (s *stubDispatcher) DestroySession(_ json.RawMessage) (json.RawMessage, *rpcError) {
	return json.RawMessage(`{}`), nil
}
func (s *stubDispatcher) GetTerminalEndpoint(_ json.RawMessage) (json.RawMessage, *rpcError) {
	return json.RawMessage(`{}`), nil
}
func (s *stubDispatcher) GetDiagnostics(_ context.Context, _ json.RawMessage) (json.RawMessage, *rpcError) {
	return json.RawMessage(`{}`), nil
}
func (s *stubDispatcher) SendInput(_ json.RawMessage) (json.RawMessage, *rpcError) {
	return json.RawMessage(`{}`), nil
}
func (s *stubDispatcher) IsShellSession(_ string) bool { return false }

// TestClientReconnectsAfterSilentDisconnect verifies that the Client
// reconnects when the TCP connection goes silent (no data, no close frame).
// This simulates a NAT timeout or firewall drop where the TCP connection is
// alive at the socket level but delivers no data.
//
// The keepalive loop sends a periodic ping; because the "frozen" server
// handler is not calling conn.Read(), no pong is returned. After the
// keepalive interval the ping times out, connCancel fires, readLoop returns,
// and connectLoop schedules a reconnect.
func TestClientReconnectsAfterSilentDisconnect(t *testing.T) {
	var connectionCount atomic.Int64

	// connHold is closed when the test ends so that server handlers can release
	// their connections cleanly rather than leaking goroutines.
	connHold := make(chan struct{})
	t.Cleanup(func() { close(connHold) })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			return
		}
		defer conn.CloseNow()

		connectionCount.Add(1)

		// Read the register message sent by the client.
		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}

		// Parse the request to extract the ID for the ack.
		var req struct {
			ID string `json:"id"`
		}
		if jsonErr := json.Unmarshal(data, &req); jsonErr != nil {
			return
		}

		// Send the registration acknowledgement.
		ack, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  map[string]interface{}{},
		})
		if writeErr := conn.Write(r.Context(), websocket.MessageText, ack); writeErr != nil {
			return
		}

		// Go "silent": stop calling conn.Read() to simulate a dead TCP connection
		// (NAT timeout, firewall drop). Hold the connection open so no TCP close
		// frame is sent — this is the scenario that requires a keepalive to detect.
		select {
		case <-connHold:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(srv.Close)

	hubURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	cfg := config.HubConfig{
		URL:               hubURL,
		Name:              "test-agent",
		Token:             "test-token",
		ReconnectInterval: 50 * time.Millisecond,  // very short for test speed
		KeepaliveInterval: 200 * time.Millisecond, // short enough to fire within the 2s deadline
	}

	client := NewClient(cfg, map[string]config.Profile{}, config.TtydConfig{}, &stubDispatcher{})
	client.Start()
	t.Cleanup(func() {
		client.Stop()
	})

	// Poll until the client makes a second connection (i.e. it detected the
	// silent connection and reconnected) or the deadline expires.
	//
	// With the current code (no keepalive), readLoop blocks indefinitely on
	// conn.Read(ctx), so connectionCount never reaches 2 and this test fails.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if connectionCount.Load() >= 2 {
			return // test passes: client reconnected after silent disconnect
		}
		time.Sleep(50 * time.Millisecond)
	}

	t.Fatalf(
		"expected client to reconnect after silent disconnect within 2s, "+
			"but only saw %d connection(s)",
		connectionCount.Load(),
	)
}

// TestClientNoKeepaliveWhenDisabled verifies that a Client configured with
// KeepaliveInterval == 0 does not send pings and does not reconnect when the
// server goes silent — i.e. the keepalive path is truly inert.
func TestClientNoKeepaliveWhenDisabled(t *testing.T) {
	var connectionCount atomic.Int64

	connHold := make(chan struct{})
	t.Cleanup(func() { close(connHold) })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			return
		}
		defer conn.CloseNow()

		connectionCount.Add(1)

		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}
		var req struct {
			ID string `json:"id"`
		}
		if jsonErr := json.Unmarshal(data, &req); jsonErr != nil {
			return
		}
		ack, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  map[string]interface{}{},
		})
		if writeErr := conn.Write(r.Context(), websocket.MessageText, ack); writeErr != nil {
			return
		}

		// Hold the connection open — same as the reconnect test, but keepalive is off.
		select {
		case <-connHold:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(srv.Close)

	hubURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	cfg := config.HubConfig{
		URL:               hubURL,
		Name:              "test-agent",
		Token:             "test-token",
		ReconnectInterval: 50 * time.Millisecond,
		KeepaliveInterval: 0, // explicitly disabled
	}

	client := NewClient(cfg, map[string]config.Profile{}, config.TtydConfig{}, &stubDispatcher{})
	client.Start()
	t.Cleanup(func() { client.Stop() })

	// Wait long enough that a 200ms keepalive would have fired multiple times.
	time.Sleep(500 * time.Millisecond)

	if got := connectionCount.Load(); got != 1 {
		t.Fatalf("expected exactly 1 connection with keepalive disabled, got %d", got)
	}
}

// TestClientResetsBackoffAfterStableConnection reproduces issue #692: the
// connectLoop's attempt counter is supposed to reset to 0 after a successful,
// stable connection, but connect() never returns nil (readLoop always returns
// a non-nil error once the connection ends), so the reset branch is dead code
// and attempt only ever accumulates.
//
// The fake hub scripts four connection attempts:
//  1. fails immediately (before completing registration)
//  2. fails immediately
//  3. completes registration, stays up for several multiples of
//     ReconnectInterval (a "stable" connection), then disconnects
//  4. completes registration and is held open until the test ends
//
// By connection #3, attempt has been incremented to 2 by the two prior
// failures. If the attempt counter correctly reset to 0 after connection #3's
// stable run, the delay before dialing connection #4 would be close to the
// base ReconnectInterval (± jitter). With the bug, attempt is instead 3 by
// then, producing a delay roughly 2^3 = 8x larger.
func TestClientResetsBackoffAfterStableConnection(t *testing.T) {
	const reconnectInterval = 30 * time.Millisecond
	const stableDuration = 150 * time.Millisecond // 5x reconnectInterval

	var connCount atomic.Int64
	var mu sync.Mutex
	var acceptTime1 time.Time
	var acceptTime2 time.Time
	var closeTime3 time.Time
	var acceptTime4 time.Time
	conn4Seen := make(chan struct{})

	connHold := make(chan struct{})
	t.Cleanup(func() { close(connHold) })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := connCount.Add(1)

		if n == 1 {
			mu.Lock()
			acceptTime1 = time.Now()
			mu.Unlock()
		}

		if n == 2 {
			mu.Lock()
			acceptTime2 = time.Now()
			mu.Unlock()
		}

		if n == 4 {
			mu.Lock()
			acceptTime4 = time.Now()
			mu.Unlock()
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer conn.CloseNow()

		if n == 1 || n == 2 {
			// Fail immediately, without completing registration, to build up
			// the attempt counter before the "stable" connection.
			return
		}

		// Connections 3+ complete registration normally.
		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}
		var req struct {
			ID string `json:"id"`
		}
		if jsonErr := json.Unmarshal(data, &req); jsonErr != nil {
			return
		}
		ack, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  map[string]interface{}{},
		})
		if writeErr := conn.Write(r.Context(), websocket.MessageText, ack); writeErr != nil {
			return
		}

		if n == 3 {
			// Stay up long enough to be a "stable" connection, then disconnect.
			time.Sleep(stableDuration)
			mu.Lock()
			closeTime3 = time.Now()
			mu.Unlock()
			return // conn.CloseNow() via defer tears down the connection
		}

		if n == 4 {
			close(conn4Seen)
		}

		// Hold connections beyond #4 open until the test ends.
		select {
		case <-connHold:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(srv.Close)

	hubURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	cfg := config.HubConfig{
		URL:               hubURL,
		Name:              "test-agent",
		Token:             "test-token",
		ReconnectInterval: reconnectInterval,
	}

	client := NewClient(cfg, map[string]config.Profile{}, config.TtydConfig{}, &stubDispatcher{})
	client.Start()
	t.Cleanup(client.Stop)

	// Widened from 5s: flakiness runs (~130 iterations, some with -race)
	// showed occasional stalls of ~5.3-5.4s before this point, well within
	// the old 5s bound's margin of error. The stall happens in the initial
	// dial/registration round-trip, before the timed portion below, so
	// widening this doesn't affect what the test measures.
	select {
	case <-conn4Seen:
	case <-time.After(25 * time.Second):
		t.Fatalf("timed out waiting for 4th connection attempt, saw %d connection(s)", connCount.Load())
	}

	mu.Lock()
	gap12 := acceptTime2.Sub(acceptTime1)
	gap := acceptTime4.Sub(closeTime3)
	mu.Unlock()

	// Acceptance criterion (b): rapid connect/disconnect cycles still back
	// off. Connection #1 fails immediately, so the delay before connection
	// #2 is dialed reflects backoff(attempt=1, reconnectInterval) -- roughly
	// 2x the base interval -- not backoff(attempt=0, reconnectInterval),
	// which would be roughly 1x. With ±25% jitter, attempt=0 tops out at
	// 1.25x base while attempt=1 bottoms out at 1.5x base, so a threshold of
	// 1.4x base cleanly distinguishes the two. A regression that reset
	// attempt unconditionally on every failure (rather than only after a
	// stable connection) would collapse this gap back into the attempt=0
	// range, so assert it's meaningfully larger than that.
	minWant12 := time.Duration(1.4 * float64(reconnectInterval))
	if gap12 < minWant12 {
		t.Fatalf("reconnect delay before 2nd connection attempt = %v, want >= %v (roughly 2x base reconnect interval with jitter); "+
			"this indicates a failed connection attempt is not being backed off (issue #692 acceptance criterion b)",
			gap12, minWant12)
	}

	// A correctly-reset attempt counter yields a delay close to the base
	// reconnectInterval (up to ±25% jitter, i.e. <= 1.25x). Give a generous
	// margin above that before treating the delay as "not reset". The
	// accumulated-backoff delay this test expects to observe under the bug is
	// roughly 8x the base interval, well above this bound.
	maxWant := 2 * reconnectInterval
	if gap > maxWant {
		t.Fatalf("reconnect delay after a stable connection = %v, want <= %v (base reconnect interval with jitter); "+
			"this indicates the attempt counter was not reset to 0 after a successful, stable connection (issue #692)",
			gap, maxWant)
	}
}

func TestBackoff(t *testing.T) {
	tests := []struct {
		name    string
		attempt int
		base    time.Duration
		minWant time.Duration
		maxWant time.Duration
	}{
		{
			name:    "attempt 0 with 1s base",
			attempt: 0,
			base:    time.Second,
			minWant: 750 * time.Millisecond,
			maxWant: 1250 * time.Millisecond,
		},
		{
			name:    "attempt 1 with 1s base",
			attempt: 1,
			base:    time.Second,
			minWant: 1500 * time.Millisecond,
			maxWant: 2500 * time.Millisecond,
		},
		{
			name:    "attempt 2 with 1s base",
			attempt: 2,
			base:    time.Second,
			minWant: 3 * time.Second,
			maxWant: 5 * time.Second,
		},
		{
			name:    "high attempt caps at 30s",
			attempt: 10,
			base:    time.Second,
			minWant: 22500 * time.Millisecond, // 30s * 0.75
			maxWant: 37500 * time.Millisecond, // 30s * 1.25
		},
		{
			name:    "zero base uses 1s default",
			attempt: 0,
			base:    0,
			minWant: 750 * time.Millisecond,
			maxWant: 1250 * time.Millisecond,
		},
		{
			name:    "negative base uses 1s default",
			attempt: 0,
			base:    -5 * time.Second,
			minWant: 750 * time.Millisecond,
			maxWant: 1250 * time.Millisecond,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for i := 0; i < 100; i++ {
				got := backoff(tt.attempt, tt.base)
				if got < tt.minWant || got > tt.maxWant {
					t.Fatalf("iteration %d: backoff(%d, %v) = %v, want in [%v, %v]",
						i, tt.attempt, tt.base, got, tt.minWant, tt.maxWant)
				}
			}
		})
	}
}

func TestRegisterRelaySession_NormalizesUUIDKey(t *testing.T) {
	// uppercaseID is a valid UUID in non-canonical (uppercase) form.
	// uuid.Parse accepts it, but uuid.UUID.String() returns the lowercase form.
	const uppercaseID = "550E8400-E29B-41D4-A716-446655440000"

	c := &Client{
		relayCh: make(map[string]chan []byte),
	}

	// relayCancel is a no-op; we only care about channel dispatch here.
	relayCancel := func() {}

	inputCh, cleanup := c.RegisterRelaySession(uppercaseID, relayCancel)
	defer cleanup()

	// Build a binary frame for the same session. encodeTerminalFrame accepts a
	// uuid.UUID value whose bytes are identical regardless of the string form
	// used to parse it. dispatchBinaryFrame will call sessionUUID.String() to
	// produce the canonical lowercase lookup key.
	parsed, err := uuid.Parse(uppercaseID)
	if err != nil {
		t.Fatalf("uuid.Parse(%q) unexpected error: %v", uppercaseID, err)
	}
	want := []byte("hello relay")
	frame := encodeTerminalFrame(parsed, want)

	// dispatchBinaryFrame decodes the frame and looks up the canonical lowercase
	// key. Before the fix, RegisterRelaySession stores the raw uppercase key, so
	// the lookup misses and the payload is never delivered.
	c.dispatchBinaryFrame(frame)

	select {
	case got, ok := <-inputCh:
		if !ok {
			t.Fatal("channel closed unexpectedly")
		}
		if string(got) != string(want) {
			t.Fatalf("got payload %q, want %q", got, want)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for payload: RegisterRelaySession stored uppercase key but dispatchBinaryFrame looks up lowercase canonical key")
	}
}

func TestRegisterRelaySession_StaleCleanupDoesNotClobberLiveRegistration(t *testing.T) {
	c := &Client{
		relayCh: make(map[string]chan []byte),
	}

	const sessionID = "12345678-1234-1234-1234-123456789abc"

	// First registration (stale).
	_, cleanup1 := c.RegisterRelaySession(sessionID, func() {})

	// Second registration for the same session (live replacement).
	ch2, cleanup2 := c.RegisterRelaySession(sessionID, func() {})

	// Stale cleanup must not remove the live channel.
	cleanup1()

	// Send a terminal frame for the session and assert ch2 still receives it.
	parsed, err := uuid.Parse(sessionID)
	if err != nil {
		t.Fatalf("uuid.Parse: %v", err)
	}
	want := []byte("live relay payload")
	frame := encodeTerminalFrame(parsed, want)
	c.dispatchBinaryFrame(frame)

	select {
	case got, ok := <-ch2:
		if !ok {
			t.Fatal("ch2 closed unexpectedly after stale cleanup")
		}
		if string(got) != string(want) {
			t.Fatalf("ch2 payload mismatch: got %q, want %q", got, want)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for payload on ch2: stale cleanup may have clobbered the live registration")
	}

	// cleanup2 must remove the map entries.
	cleanup2()

	c.relayChMu.Lock()
	_, chExists := c.relayCh[parsed.String()]
	c.relayChMu.Unlock()
	if chExists {
		t.Fatal("relayCh entry still present after cleanup2()")
	}
}

// startRegisterAckServer runs a fake hub that answers the register request
// with the given result object, then holds the connection open until the test
// ends. It returns the ws:// URL to dial.
func startRegisterAckServer(t *testing.T, result map[string]interface{}) string {
	t.Helper()
	connHold := make(chan struct{})
	t.Cleanup(func() { close(connHold) })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer conn.CloseNow()

		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}
		var req struct {
			ID string `json:"id"`
		}
		if jsonErr := json.Unmarshal(data, &req); jsonErr != nil {
			return
		}
		ack, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  result,
		})
		if writeErr := conn.Write(r.Context(), websocket.MessageText, ack); writeErr != nil {
			return
		}
		select {
		case <-connHold:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

// TestClientRegisterNegotiatesMaxMessageBytes verifies that the register
// acknowledgement's max_message_bytes is adopted as the client's message
// limit, and that an ack without the field (older hub) yields the default.
func TestClientRegisterNegotiatesMaxMessageBytes(t *testing.T) {
	tests := []struct {
		name   string
		result map[string]interface{}
		want   int64
	}{
		{
			name:   "hub advertises limit",
			result: map[string]interface{}{"accepted": true, "max_message_bytes": 16 << 20},
			want:   16 << 20,
		},
		{
			name:   "older hub omits field",
			result: map[string]interface{}{"accepted": true},
			want:   defaultMaxMessageBytes,
		},
		{
			name:   "empty result object",
			result: map[string]interface{}{},
			want:   defaultMaxMessageBytes,
		},
		{
			name:   "explicit zero falls back to default",
			result: map[string]interface{}{"accepted": true, "max_message_bytes": 0},
			want:   defaultMaxMessageBytes,
		},
		{
			name:   "negative value falls back to default",
			result: map[string]interface{}{"accepted": true, "max_message_bytes": -1},
			want:   defaultMaxMessageBytes,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hubURL := startRegisterAckServer(t, tt.result)
			cfg := config.HubConfig{
				URL:               hubURL,
				Name:              "test-agent",
				Token:             "test-token",
				ReconnectInterval: 50 * time.Millisecond,
			}
			client := NewClient(cfg, map[string]config.Profile{}, config.TtydConfig{}, &stubDispatcher{})

			// Before any connection the default applies.
			if got := client.MaxMessageBytes(); got != defaultMaxMessageBytes {
				t.Fatalf("pre-connect MaxMessageBytes = %d, want default %d", got, defaultMaxMessageBytes)
			}

			client.Start()
			t.Cleanup(client.Stop)

			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				if client.maxMessageBytes.Load() != 0 {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if got := client.MaxMessageBytes(); got != tt.want {
				t.Fatalf("MaxMessageBytes = %d, want %d", got, tt.want)
			}
		})
	}
}

// bigSessionsResult builds a listSessions-style result with n sessions, each
// carrying a prompt_context of ctxLen bytes.
func bigSessionsResult(t *testing.T, n, ctxLen int) json.RawMessage {
	t.Helper()
	infos := make([]sessionInfo, n)
	for i := range infos {
		infos[i] = sessionInfo{
			ID:              uuid.New().String(),
			Name:            "sess",
			AgentProfile:    "profile",
			State:           "running",
			CreatedAt:       "2026-08-23T00:00:00Z",
			WaitingForInput: true,
			PromptContext:   strings.Repeat("x", ctxLen),
			PromptType:      "question",
		}
	}
	b, err := json.Marshal(sessionsJSON{Sessions: infos})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestPrepareResponseFrame covers the sender-side size guard: responses under
// the limit pass through untouched, oversized shrinkable results are sent
// without prompt_context, and anything still too large (or not shrinkable)
// becomes a JSON-RPC error for the same id. No returned frame may exceed the
// limit.
func TestPrepareResponseFrame(t *testing.T) {
	const limit = 2 * 1024

	tests := []struct {
		name          string
		method        string
		result        json.RawMessage
		wantErr       bool
		wantErrMsg    string // substring expected in the error message (default: size-limit message)
		wantSessions  int    // sessions expected in a successful frame
		wantPromptCtx bool   // whether prompt_context must be present
	}{
		{
			name:          "small listSessions passes through",
			method:        "listSessions",
			result:        bigSessionsResult(t, 1, 64),
			wantSessions:  1,
			wantPromptCtx: true,
		},
		{
			name:         "oversized listSessions drops prompt_context",
			method:       "listSessions",
			result:       bigSessionsResult(t, 3, 4096),
			wantSessions: 3,
		},
		{
			name:    "oversized listSessions still too big after shrink becomes error",
			method:  "listSessions",
			result:  bigSessionsResult(t, 40, 1024), // ~40 × 200 B metadata > 2 KiB even shrunk
			wantErr: true,
		},
		{
			name:    "oversized non-shrinkable result becomes error",
			method:  "getDiagnostics",
			result:  json.RawMessage(`{"events":"` + strings.Repeat("y", 4096) + `"}`),
			wantErr: true,
		},
		{
			name:    "oversized result with no method context becomes error",
			method:  "",
			result:  json.RawMessage(`{"blob":"` + strings.Repeat("z", 4096) + `"}`),
			wantErr: true,
		},
		{
			// A malformed RawMessage makes the initial json.Marshal(resp) fail;
			// the frame must still be a well-formed JSON-RPC error for the
			// same id rather than an empty/garbage payload.
			name:       "malformed result becomes encode error",
			method:     "listSessions",
			result:     json.RawMessage("{not json"),
			wantErr:    true,
			wantErrMsg: "failed to encode response",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := &response{JSONRPC: "2.0", ID: "req-42", Result: tt.result}
			frame := prepareResponseFrame(tt.method, resp, limit, shrinkableFor(tt.method))

			if int64(len(frame)) > limit {
				t.Fatalf("frame size %d exceeds limit %d", len(frame), limit)
			}

			var got struct {
				JSONRPC string          `json:"jsonrpc"`
				ID      string          `json:"id"`
				Result  json.RawMessage `json:"result"`
				Error   *rpcError       `json:"error"`
			}
			if err := json.Unmarshal(frame, &got); err != nil {
				t.Fatalf("frame is not valid JSON-RPC: %v", err)
			}
			if got.ID != "req-42" || got.JSONRPC != "2.0" {
				t.Fatalf("envelope = id %q jsonrpc %q, want req-42 / 2.0", got.ID, got.JSONRPC)
			}

			if tt.wantErr {
				if got.Error == nil {
					t.Fatal("expected JSON-RPC error, got result")
				}
				if got.Error.Code != rpcErrInternal {
					t.Errorf("error code = %d, want %d", got.Error.Code, rpcErrInternal)
				}
				wantMsg := tt.wantErrMsg
				if wantMsg == "" {
					wantMsg = "exceeds hub message limit"
				}
				if !strings.Contains(got.Error.Message, wantMsg) {
					t.Errorf("error message = %q, want it to contain %q", got.Error.Message, wantMsg)
				}
				return
			}

			if got.Error != nil {
				t.Fatalf("unexpected error: %+v", got.Error)
			}
			var sessions struct {
				Sessions []map[string]json.RawMessage `json:"sessions"`
			}
			if err := json.Unmarshal(got.Result, &sessions); err != nil {
				t.Fatalf("result is not a sessions list: %v", err)
			}
			if len(sessions.Sessions) != tt.wantSessions {
				t.Fatalf("got %d sessions, want %d", len(sessions.Sessions), tt.wantSessions)
			}
			for i, s := range sessions.Sessions {
				_, hasCtx := s["prompt_context"]
				_, hasType := s["prompt_type"]
				if hasCtx != tt.wantPromptCtx || hasType != tt.wantPromptCtx {
					t.Errorf("session %d: prompt_context=%v prompt_type=%v, want both %v", i, hasCtx, hasType, tt.wantPromptCtx)
				}
				if _, ok := s["id"]; !ok {
					t.Errorf("session %d lost its metadata", i)
				}
			}
		})
	}
}

// TestPrepareResponseFrame_SingleSession verifies the getSession/createSession
// result type degrades the same way as listSessions.
func TestPrepareResponseFrame_SingleSession(t *testing.T) {
	const limit = 1024
	result, err := json.Marshal(sessionJSON{Session: sessionInfo{
		ID:            uuid.New().String(),
		Name:          "sess",
		AgentProfile:  "profile",
		State:         "running",
		CreatedAt:     "2026-08-23T00:00:00Z",
		PromptContext: strings.Repeat("x", 4096),
		PromptType:    "question",
	}})
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"getSession", "createSession"} {
		t.Run(method, func(t *testing.T) {
			resp := &response{JSONRPC: "2.0", ID: "req-7", Result: result}
			frame := prepareResponseFrame(method, resp, limit, shrinkableFor(method))
			if int64(len(frame)) > limit {
				t.Fatalf("frame size %d exceeds limit %d", len(frame), limit)
			}
			var got struct {
				ID     string `json:"id"`
				Result struct {
					Session map[string]json.RawMessage `json:"session"`
				} `json:"result"`
				Error *rpcError `json:"error"`
			}
			if err := json.Unmarshal(frame, &got); err != nil {
				t.Fatal(err)
			}
			if got.Error != nil {
				t.Fatalf("unexpected error: %+v", got.Error)
			}
			if got.ID != "req-7" {
				t.Errorf("id = %q, want req-7", got.ID)
			}
			if _, ok := got.Result.Session["prompt_context"]; ok {
				t.Error("prompt_context still present after degrade")
			}
			if _, ok := got.Result.Session["id"]; !ok {
				t.Error("session metadata lost")
			}
		})
	}
}

// TestPrepareResponseFrame_ErrorResponsePassesThrough verifies that a
// dispatcher error response is never treated as shrinkable and is forwarded
// unchanged when it fits.
func TestPrepareResponseFrame_ErrorResponsePassesThrough(t *testing.T) {
	resp := &response{JSONRPC: "2.0", ID: "req-9", Error: &rpcError{Code: rpcErrNotFound, Message: "no such session"}}
	frame := prepareResponseFrame("getSession", resp, 2048, shrinkableFor("getSession"))
	var got response
	if err := json.Unmarshal(frame, &got); err != nil {
		t.Fatal(err)
	}
	if got.Error == nil || got.Error.Code != rpcErrNotFound || got.Error.Message != "no such session" {
		t.Fatalf("error response altered: %s", frame)
	}
}

// TestShrink covers the Shrink implementations directly, including the
// "nothing to remove" signal that lets the caller skip a re-marshal.
func TestShrink(t *testing.T) {
	t.Run("sessionsJSON", func(t *testing.T) {
		r := &sessionsJSON{Sessions: []sessionInfo{
			{ID: "a", PromptContext: "ctx", PromptType: "question"},
			{ID: "b"},
		}}
		if !r.Shrink() {
			t.Fatal("Shrink() = false, want true when prompt payload present")
		}
		for _, s := range r.Sessions {
			if s.PromptContext != "" || s.PromptType != "" {
				t.Errorf("session %s still carries prompt payload", s.ID)
			}
		}
		if r.Shrink() {
			t.Error("second Shrink() = true, want false (nothing left to remove)")
		}
	})
	t.Run("sessionJSON", func(t *testing.T) {
		r := &sessionJSON{Session: sessionInfo{ID: "a", PromptType: "question"}}
		if !r.Shrink() {
			t.Fatal("Shrink() = false, want true")
		}
		if r.Session.PromptType != "" {
			t.Error("prompt_type not cleared")
		}
		if (&sessionJSON{}).Shrink() {
			t.Error("Shrink() on empty session = true, want false")
		}
	})
}
