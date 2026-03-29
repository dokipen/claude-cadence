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

// TestServeTerminal_ConcurrentReconnect_WriterSurvives reproduces the race
// described in issue #523: when client A disconnects, its deferred cleanup
// sets sess.writers = nil, wiping client B's writer even though B is still
// connected. The test verifies that B continues to receive PTY output after
// A disconnects.
//
// This test FAILS against the current code because the deferred cleanup in
// ServeTerminal unconditionally sets sess.writers = nil regardless of whether
// a newer writer has been registered.
func TestServeTerminal_ConcurrentReconnect_WriterSurvives(t *testing.T) {
	m := internalpty.NewPTYManager(internalpty.PTYConfig{})

	err := m.Create("reconnect-race-test", t.TempDir(),
		[]string{"sh", "-c", "sleep 30"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("reconnect-race-test") })

	// Start the HTTP server that serves the terminal WebSocket.
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
		_ = m.ServeTerminal(r.Context(), "reconnect-race-test", conn)
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln) //nolint:errcheck
	t.Cleanup(func() { srv.Close() })

	wsURL := "ws://" + ln.Addr().String() + "/ws/terminal"

	// --- Connect client A ---
	ctxA, cancelA := context.WithCancel(context.Background())
	connA, _, dialErrA := websocket.Dial(ctxA, wsURL, nil)
	if dialErrA != nil {
		cancelA()
		t.Fatalf("client A: dial failed: %v", dialErrA)
	}
	// Drain client A in the background so it doesn't block the server write path.
	go func() {
		for {
			_, _, readErr := connA.Read(ctxA)
			if readErr != nil {
				return
			}
		}
	}()

	// Give ServeTerminal time to register client A's writer.
	time.Sleep(50 * time.Millisecond)

	// --- Connect client B ---
	ctxB, cancelB := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelB()

	connB, _, dialErrB := websocket.Dial(ctxB, wsURL, nil)
	if dialErrB != nil {
		cancelA()
		t.Fatalf("client B: dial failed: %v", dialErrB)
	}
	defer connB.CloseNow()

	// Give ServeTerminal time to register client B's writer (which, in the
	// buggy code, also overwrites A's writer slot with a fresh []io.Writer{wfB}).
	time.Sleep(50 * time.Millisecond)

	// Channel on which client B signals receipt of the marker.
	receivedCh := make(chan string, 1)
	go func() {
		var received strings.Builder
		for {
			_, data, readErr := connB.Read(ctxB)
			if readErr != nil {
				return
			}
			if len(data) > 1 && data[0] == '0' {
				received.Write(data[1:])
			}
			if strings.Contains(received.String(), "WRITER_SURVIVES") {
				select {
				case receivedCh <- received.String():
				default:
				}
				return
			}
		}
	}()

	// --- Disconnect client A ---
	// Cancel A's context so ServeTerminal(A) returns, firing its deferred
	// cleanup. The buggy cleanup sets sess.writers = nil, killing B's writer.
	cancelA()
	connA.CloseNow()

	// Give the deferred cleanup time to fire.
	time.Sleep(100 * time.Millisecond)

	// --- Write to PTY after A has disconnected ---
	// Send a shell command that will echo the marker via the PTY. The shell
	// running under "sleep 30" is a plain `sh`, so we can't send a command
	// to it directly. Instead we use WriteInput to write to the PTY master,
	// which sends the bytes to the foreground process. The easiest approach
	// is to use a shell that echos: replace the session's underlying PTY with
	// one that runs `cat` by sending input that produces visible output.
	//
	// Since "sh -c 'sleep 30'" only runs sleep and won't echo, we write
	// directly to the PTY master through WriteInput. The terminal driver will
	// echo the typed characters back when the terminal is in canonical/echo
	// mode (the default for a PTY). So typing visible ASCII will be echoed
	// back as PTY output that client B can observe.
	input := []byte("WRITER_SURVIVES\n")
	if writeErr := m.WriteInput("reconnect-race-test", input); writeErr != nil {
		t.Fatalf("WriteInput failed: %v", writeErr)
	}

	// Assert client B receives the echoed marker within a generous timeout.
	select {
	case out := <-receivedCh:
		// Pass — B's writer survived A's disconnect.
		_ = out
	case <-time.After(5 * time.Second):
		t.Errorf("client B did not receive PTY output after client A disconnected; " +
			"A's deferred cleanup likely set sess.writers = nil, wiping B's writer (issue #523)")
	}

}

// TestServeTerminal_LargeSnapshotReplay verifies that a WebSocket client can
// receive a snapshot replay larger than the default coder/websocket read limit
// of 32 KB. This exercises the scenario described in issue #531 where vim
// sessions fill the ring buffer past 32 KB and the relay's localConn read
// would fail silently.
func TestServeTerminal_LargeSnapshotReplay(t *testing.T) {
	// Use a 64 KB buffer so the snapshot exceeds the default 32 KB WS read limit.
	const bufSize = 64 * 1024
	m := internalpty.NewPTYManager(internalpty.PTYConfig{BufferSize: bufSize})

	// Create a session that writes >32 KB of data to the PTY.
	// We use printf in a loop to emit enough data to fill the ring buffer
	// well past the default WebSocket read limit.
	err := m.Create("large-snapshot-test", t.TempDir(),
		[]string{"sh", "-c", "dd if=/dev/zero bs=1024 count=40 2>/dev/null | tr '\\0' 'A'; sleep 30"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("large-snapshot-test") })

	// Poll until the ring buffer contains >32 KB of data.
	deadline := time.Now().Add(5 * time.Second)
	for {
		buf, readErr := m.ReadBuffer("large-snapshot-test")
		if readErr != nil {
			t.Fatalf("ReadBuffer failed: %v", readErr)
		}
		if len(buf) > 32*1024 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for >32KB in ring buffer; got %d bytes", len(buf))
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
		_ = m.ServeTerminal(r.Context(), "large-snapshot-test", conn)
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln) //nolint:errcheck
	t.Cleanup(func() { srv.Close() })

	wsURL := "ws://" + ln.Addr().String() + "/ws/terminal"

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, dialErr := websocket.Dial(ctx, wsURL, nil)
	if dialErr != nil {
		t.Fatalf("dial failed: %v", dialErr)
	}
	defer conn.CloseNow()

	// The client must set a read limit large enough for the snapshot frame.
	conn.SetReadLimit(int64(bufSize + 1))

	// Read frames and accumulate total data received. Track the largest
	// single frame to verify the snapshot arrived as one oversized message
	// (not many small ones that happen to sum past 32 KB).
	var totalReceived, maxFrameSize int
	for {
		_, data, readErr := conn.Read(ctx)
		if readErr != nil {
			t.Fatalf("read failed: %v (totalReceived=%d)", readErr, totalReceived)
		}
		if len(data) > 1 && data[0] == '0' {
			framePayload := len(data) - 1 // subtract the '0' prefix
			totalReceived += framePayload
			if framePayload > maxFrameSize {
				maxFrameSize = framePayload
			}
		}
		if totalReceived > 32*1024 {
			break
		}
	}

	if maxFrameSize <= 32*1024 {
		t.Errorf("largest frame was %d bytes; expected >32KB to confirm snapshot replay as a single large message", maxFrameSize)
	}
	t.Logf("received %d bytes of terminal data; largest frame %d bytes", totalReceived, maxFrameSize)
}
