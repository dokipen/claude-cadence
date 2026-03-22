package pty_test

import (
	"context"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	internalpty "github.com/dokipen/claude-cadence/services/agents/internal/pty"
)

// TestServeTerminal_BufferReplay verifies that a second WebSocket client
// connecting to an existing session receives the replayed ring buffer.
func TestServeTerminal_BufferReplay(t *testing.T) {
	m := internalpty.NewPTYManager(internalpty.PTYConfig{})

	// Create a session with a shell that immediately prints a known string.
	err := m.Create("replay-test", t.TempDir(),
		[]string{"sh", "-c", "echo 'REPLAY_MARKER'; sleep 30"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("replay-test") })

	// Give the shell time to print its output.
	time.Sleep(150 * time.Millisecond)

	// Verify the ring buffer already has data.
	buf, err := m.ReadBuffer("replay-test")
	if err != nil {
		t.Fatalf("ReadBuffer failed: %v", err)
	}
	if !strings.Contains(string(buf), "REPLAY_MARKER") {
		t.Fatalf("ring buffer does not yet contain REPLAY_MARKER: %q", string(buf))
	}

	// Start an HTTP server that serves the terminal WebSocket.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/terminal", func(w http.ResponseWriter, r *http.Request) {
		conn, acceptErr := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if acceptErr != nil {
			return
		}
		defer conn.CloseNow()
		_ = m.ServeTerminal(r.Context(), "replay-test", conn)
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })

	wsURL := "ws://" + ln.Addr().String() + "/ws/terminal"

	// Helper: connect a WS client and collect all received bytes.
	collectOutput := func(t *testing.T, label string) string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		conn, _, dialErr := websocket.Dial(ctx, wsURL, nil)
		if dialErr != nil {
			t.Fatalf("%s: dial failed: %v", label, dialErr)
		}
		defer conn.CloseNow()

		var received strings.Builder
		// Read frames until timeout.
		for {
			_, data, readErr := conn.Read(ctx)
			if readErr != nil {
				break
			}
			if len(data) > 1 && data[0] == '0' {
				received.Write(data[1:])
			}
			if strings.Contains(received.String(), "REPLAY_MARKER") {
				break
			}
		}
		return received.String()
	}

	// First client: connects and receives REPLAY_MARKER via live output or replay.
	out1 := collectOutput(t, "client1")
	if !strings.Contains(out1, "REPLAY_MARKER") {
		t.Errorf("client1: expected REPLAY_MARKER in output, got: %q", out1)
	}

	// Second client: connects after first has disconnected; must receive replay.
	out2 := collectOutput(t, "client2")
	if !strings.Contains(out2, "REPLAY_MARKER") {
		t.Errorf("client2 (sequential reconnect): expected REPLAY_MARKER in replay, got: %q", out2)
	}
}
