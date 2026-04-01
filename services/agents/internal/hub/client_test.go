package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
