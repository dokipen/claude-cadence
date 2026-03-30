package hub

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	sharedrelay "github.com/dokipen/claude-cadence/services/shared/relay"
)

// TestRunTerminalRelay_LargeSnapshotReplay verifies that runTerminalRelay
// delivers a snapshot replay larger than the default coder/websocket read limit
// of 32 KB through the full relay code path (relay.go). This test covers the
// regression scenario from issue #531: SetReadLimit was missing on localConn,
// causing localConn.Read to fail silently when the snapshot exceeded 32 KB.
//
// Unlike TestServeTerminal_LargeSnapshotReplay (which calls ServeTerminal
// directly with the client managing its own read limit), this test exercises
// runTerminalRelay end-to-end, including the loopback WebSocket pair
// (localConn/serverConn) and binary relay frame encoding.
func TestRunTerminalRelay_LargeSnapshotReplay(t *testing.T) {
	const bufSize = 64 * 1024

	m := pty.NewPTYManager(pty.PTYConfig{BufferSize: bufSize})

	// Use a UUID string as the session ID. runTerminalRelay calls uuid.Parse on
	// ptySessID and also passes it verbatim to ptyMgr.ServeTerminal, so the PTY
	// session must be registered under the same UUID key.
	sessID := uuid.New().String()

	err := m.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", "dd if=/dev/zero bs=1024 count=40 2>/dev/null | tr '\\0' 'A'; sleep 30"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy(sessID) })

	// Poll until the ring buffer contains >32 KB of data.
	deadline := time.Now().Add(5 * time.Second)
	for {
		buf, readErr := m.ReadBuffer(sessID)
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

	// Stand up a fake hub WebSocket server. runTerminalRelay writes binary relay
	// frames here (the same path as a real agentd→hub connection). Each decoded
	// payload is forwarded to frameCh for the test to inspect.
	frameCh := make(chan []byte, 64)

	hubLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}

	hubMux := http.NewServeMux()
	hubMux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, acceptErr := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if acceptErr != nil {
			return
		}
		defer conn.CloseNow()
		// A relay frame is: [1-byte type][16-byte UUID][payload]. The full frame
		// can reach bufSize+17 bytes for a snapshot replay. Set the read limit so
		// the fake hub accepts the large frame from the relay.
		conn.SetReadLimit(int64(bufSize + sharedrelay.TerminalFrameHeaderLen + 1))
		for {
			_, data, readErr := conn.Read(r.Context())
			if readErr != nil {
				return
			}
			// Decode the relay frame. Skip relay-end frames (type 0x02) and any
			// malformed frames — we only care about terminal data (type 0x01).
			_, payload, decodeErr := decodeTerminalFrame(data)
			if decodeErr != nil {
				continue
			}
			frameCh <- payload
		}
	})

	hubSrv := &http.Server{Handler: hubMux}
	go hubSrv.Serve(hubLn) //nolint:errcheck
	t.Cleanup(func() { hubSrv.Close() })

	// Give runTerminalRelay a generous timeout. The relay context doubles as the
	// test deadline — if the large frame never arrives, relayCtx.Done() fires.
	relayCtx, relayCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer relayCancel()

	// Dial the fake hub. This produces hubConn — the connection runTerminalRelay
	// uses to forward PTY output as binary relay frames.
	hubConn, _, err := websocket.Dial(relayCtx, "ws://"+hubLn.Addr().String()+"/ws", nil)
	if err != nil {
		t.Fatalf("dial fake hub failed: %v", err)
	}
	defer hubConn.CloseNow()

	// Build a minimal Client. runTerminalRelay uses relayCh (via
	// RegisterRelaySession), relayCancel (zombie cleanup), writeMu (protecting
	// hubConn writes), and dispatcher (DestroySession when the PTY exits).
	// newTestDispatcher provides a real in-memory Dispatcher; DestroySession
	// will return notFound for our ephemeral session, which the relay handles
	// gracefully (logs and continues).
	c := &Client{
		relayCh:     make(map[string]chan []byte),
		relayCancel: make(map[string]context.CancelFunc),
		dispatcher:  newTestDispatcher(),
	}

	go c.runTerminalRelay(relayCtx, relayCancel, hubConn, sessID, m)

	// Collect relay frames and track the largest payload. The snapshot replay
	// arrives as a single ttyd frame prefixed with byte '0' (ttyd server→client
	// type). The full payload must exceed 32 KB to prove localConn.SetReadLimit
	// is active — without it, localConn.Read fails silently and no frames arrive.
	var maxPayloadSize int
	for {
		select {
		case <-relayCtx.Done():
			t.Fatalf("timed out waiting for >32KB relay frame; largest payload seen: %d bytes", maxPayloadSize)
		case payload := <-frameCh:
			if len(payload) > maxPayloadSize {
				maxPayloadSize = len(payload)
			}
			if maxPayloadSize > 32*1024 {
				return // large snapshot delivered through the relay path
			}
		}
	}
}

// TestRelayIntegration_VimNocompatible_OutputDelivery tests the relay path
// (browser → hub → relay → local WS → ServeTerminal → PTY) end-to-end with
// vim in nocompatible mode. This exercises the fixes from issue #527:
//   - relay.go MessageText→MessageBinary (coder/websocket closes on text frames)
//   - zombie relay cancellation in RegisterRelaySession
//   - sess.mu released before writer writes in manager.go
func TestRelayIntegration_VimNocompatible_OutputDelivery(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping relay integration test in short mode")
	}

	vimPath, lookErr := exec.LookPath("vim")
	if lookErr != nil {
		t.Skip("vim not found in PATH; skipping relay integration test")
	}
	t.Logf("using vim at %s", vimPath)

	// Step 1: Create a PTY session with a shell.
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{})
	sessUUID := uuid.New()
	ptySessID := sessUUID.String()

	if createErr := ptyMgr.Create(ptySessID, t.TempDir(), []string{"sh"}, nil, 80, 24); createErr != nil {
		t.Fatalf("Create PTY session failed: %v", createErr)
	}
	t.Cleanup(func() { ptyMgr.Destroy(ptySessID) })

	// Step 2: Create a mock hub WebSocket pair using httptest.Server.
	// hubServerConn is the server-side connection the test uses to read/write frames.
	// hubClientConn is passed to runTerminalRelay as the "hub connection".
	var hubServerConn *websocket.Conn
	hubServerReady := make(chan struct{})

	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, acceptErr := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if acceptErr != nil {
			t.Logf("mock hub accept error: %v", acceptErr)
			return
		}
		hubServerConn = conn
		close(hubServerReady)
		// Block until the connection is closed.
		<-r.Context().Done()
	}))
	t.Cleanup(mockHub.Close)

	hubURL := "ws" + strings.TrimPrefix(mockHub.URL, "http")

	dialCtx, dialCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dialCancel()

	hubClientConn, _, dialErr := websocket.Dial(dialCtx, hubURL, nil)
	if dialErr != nil {
		t.Fatalf("dial mock hub failed: %v", dialErr)
	}
	dialCancel()

	// Wait for the server side to be ready.
	select {
	case <-hubServerReady:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for mock hub server connection")
	}
	t.Cleanup(func() { hubServerConn.CloseNow() })
	t.Cleanup(func() { hubClientConn.CloseNow() })

	// Step 3: Create a minimal Client and relay context.
	// dispatcher is required: runTerminalRelay calls c.dispatcher.DestroySession
	// when the PTY exits while the hub is still connected.
	c := &Client{
		relayCh:     make(map[string]chan []byte),
		relayCancel: make(map[string]context.CancelFunc),
		dispatcher:  newTestDispatcher(),
	}

	relayCtx, relayCancel := context.WithCancel(context.Background())

	// Step 4: Start runTerminalRelay in a goroutine.
	relayDone := make(chan struct{})
	go func() {
		defer close(relayDone)
		c.runTerminalRelay(relayCtx, relayCancel, hubClientConn, ptySessID, ptyMgr)
	}()

	// Step 5: Start a goroutine to read output frames from hubServerConn.
	// Output frames arrive as binary relay frames with the relay frame encoding.
	outputFrames := make(chan string, 4096)
	testCtx, testCancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer testCancel()

	go func() {
		for {
			_, data, readErr := hubServerConn.Read(testCtx)
			if readErr != nil {
				return
			}
			_, payload, decodeErr := decodeTerminalFrame(data)
			if decodeErr != nil {
				// Not a terminal frame (e.g. relay-end frame) — ignore.
				continue
			}
			// ttyd server→client frame: byte '0' + terminal bytes.
			if len(payload) > 1 && payload[0] == '0' {
				select {
				case outputFrames <- string(payload[1:]):
				default:
				}
			}
		}
	}()

	// collectFor drains outputFrames for dur, returning all received data.
	collectFor := func(dur time.Duration) string {
		timer := time.NewTimer(dur)
		defer timer.Stop()
		var sb strings.Builder
		for {
			select {
			case chunk, ok := <-outputFrames:
				if !ok {
					return sb.String()
				}
				sb.WriteString(chunk)
			case <-timer.C:
				return sb.String()
			}
		}
	}

	// sendInput delivers keyboard input to the relay via dispatchBinaryFrame,
	// which is the same code path used by the hub read loop in production.
	// payload is the raw ttyd client→server frame: byte '0' + keystrokes.
	sendInput := func(label string, payload []byte) {
		t.Helper()
		frame := encodeTerminalFrame(sessUUID, payload)
		c.dispatchBinaryFrame(frame)
	}

	// Step 6: Wait for shell prompt output.
	promptOutput := collectFor(3 * time.Second)
	if len(promptOutput) == 0 {
		t.Fatal("step 6: timed out waiting for shell prompt; no output received via relay path")
	}
	t.Logf("step 6: shell prompt received (%d bytes) via relay path", len(promptOutput))

	// Step 7: Launch vim with nocompatible mode.
	sendInput("step 7", []byte("0vim -u NONE --cmd \"set nocompatible\"\r"))

	// Step 8: Read output — should see vim's screen.
	vimStartOutput := collectFor(5 * time.Second)
	if len(vimStartOutput) == 0 {
		t.Fatal("step 8: no output received after vim start via relay path — vim may not have launched or relay path is broken")
	}
	t.Logf("step 8: vim startup output received (%d bytes) via relay path", len(vimStartOutput))

	// Step 9: Enter insert mode, type "hello", then ESC back to normal mode.
	sendInput("step 9", []byte("0ihello\x1b"))

	// Step 10: Read output — should see vim's response.
	insertOutput := collectFor(3 * time.Second)
	if len(insertOutput) == 0 {
		t.Errorf("step 10 FAIL (bug #527 relay path): no output received after typing in vim nocompatible mode via relay; "+
			"input reached vim but relay output stopped delivering frames")
	} else {
		t.Logf("step 10: insert output received (%d bytes) via relay path", len(insertOutput))
	}

	// Step 11: Quit vim.
	sendInput("step 11", []byte("0:q!\r"))
	quitOutput := collectFor(3 * time.Second)
	if len(quitOutput) == 0 {
		t.Logf("step 11: no output received after :q! (vim may have already exited)")
	} else {
		t.Logf("step 11: quit output received (%d bytes) via relay path", len(quitOutput))
	}

	// Step 12: Cancel relay context and wait for cleanup.
	relayCancel()
	select {
	case <-relayDone:
		t.Log("step 12: relay goroutine exited cleanly")
	case <-time.After(10 * time.Second):
		t.Error("step 12: relay goroutine did not exit within 10s after cancel")
	}
}
