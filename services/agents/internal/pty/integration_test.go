package pty_test

import (
	"bytes"
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

	// Poll until REPLAY_MARKER appears in the ring buffer.
	deadline := time.Now().Add(5 * time.Second)
	for {
		buf, err := m.ReadBuffer("replay-test")
		if err != nil {
			t.Fatalf("ReadBuffer failed: %v", err)
		}
		if strings.Contains(string(buf), "REPLAY_MARKER") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for REPLAY_MARKER in ring buffer; got: %q", string(buf))
		}
		time.Sleep(10 * time.Millisecond)
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

// TestServeTerminal_ResizeClamped verifies that sending an oversized resize frame
// does not crash or panic the session — the session must remain usable afterwards.
func TestServeTerminal_ResizeClamped(t *testing.T) {
	m := internalpty.NewPTYManager(internalpty.PTYConfig{})

	err := m.Create("resize-clamp-test", t.TempDir(),
		[]string{"sh", "-c", "sleep 30"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("resize-clamp-test") })

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
		_ = m.ServeTerminal(r.Context(), "resize-clamp-test", conn)
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })

	wsURL := "ws://" + ln.Addr().String() + "/ws/terminal"

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, dialErr := websocket.Dial(ctx, wsURL, nil)
	if dialErr != nil {
		t.Fatalf("dial failed: %v", dialErr)
	}
	defer conn.CloseNow()

	// Send an oversized resize frame: byte '1' + JSON with 9999x9999 dimensions.
	resizeFrame := []byte(`1{"columns":9999,"rows":9999}`)
	if writeErr := conn.Write(ctx, websocket.MessageBinary, resizeFrame); writeErr != nil {
		t.Fatalf("failed to send resize frame: %v", writeErr)
	}

	// Send a small input frame after the resize to verify the session is still alive.
	inputFrame := []byte("0\n")
	if writeErr := conn.Write(ctx, websocket.MessageBinary, inputFrame); writeErr != nil {
		t.Fatalf("session appears broken after oversized resize: %v", writeErr)
	}

	// The test asserts no panic/crash occurred by reaching this point.
}

// TestServeTerminal_BinaryFrameType verifies that PTY output is sent as
// WebSocket binary frames (not text frames). Sending text frames containing
// non-UTF-8 bytes causes browser WebSocket clients to disconnect.
//
// This test reproduces issue #320: the session runs a command that emits
// non-UTF-8 bytes (0x80, 0x81, 0x82) and the test asserts the data frame
// arrives as websocket.MessageBinary. It FAILS against the current code
// (which uses MessageText) and will pass once the fix lands.
func TestServeTerminal_BinaryFrameType(t *testing.T) {
	m := internalpty.NewPTYManager(internalpty.PTYConfig{})

	// Emit non-UTF-8 bytes followed by a newline so the PTY flushes promptly.
	err := m.Create("binary-frame-test", t.TempDir(),
		[]string{"sh", "-c", "printf '\\x80\\x81\\x82\\n'; sleep 30"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("binary-frame-test") })

	// Poll until the ring buffer contains the non-UTF-8 bytes.
	deadline := time.Now().Add(5 * time.Second)
	for {
		buf, readErr := m.ReadBuffer("binary-frame-test")
		if readErr != nil {
			t.Fatalf("ReadBuffer failed: %v", readErr)
		}
		if bytes.Contains(buf, []byte{0x80}) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for non-UTF-8 bytes in ring buffer; got: %q", string(buf))
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Stand up a real HTTP server serving the terminal WebSocket.
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
		_ = m.ServeTerminal(r.Context(), "binary-frame-test", conn)
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })

	wsURL := "ws://" + ln.Addr().String() + "/ws/terminal"

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	c, _, dialErr := websocket.Dial(ctx, wsURL, nil)
	if dialErr != nil {
		t.Fatalf("dial failed: %v", dialErr)
	}
	defer c.CloseNow()

	// Read frames until we find the first data frame (prefix byte '0').
	for {
		msgType, data, readErr := c.Read(ctx)
		if readErr != nil {
			t.Fatalf("read failed before finding a data frame: %v", readErr)
		}
		if len(data) == 0 {
			continue
		}
		if data[0] != '0' {
			// Not a data frame (could be a control/resize frame); keep reading.
			continue
		}
		// Found the first data frame — assert it is binary.
		if msgType != websocket.MessageBinary {
			t.Errorf("expected WebSocket MessageBinary (%d) for data frame, got MessageText (%d); "+
				"non-UTF-8 PTY output will cause browser disconnects (issue #320)",
				websocket.MessageBinary, msgType)
		}
		return
	}
}
