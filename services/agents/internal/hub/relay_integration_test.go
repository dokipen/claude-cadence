package hub

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
)

// TestRelayIntegration_VimNocompatible_OutputDelivery tests the relay path
// (browser → hub → relay → local WS → ServeTerminal → PTY) end-to-end with
// vim in nocompatible mode. This exercises the fixes from issue #527.
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
	c := &Client{
		relayCh:     make(map[string]chan []byte),
		relayCancel: make(map[string]context.CancelFunc),
	}

	relayCtx, relayCancel := context.WithCancel(context.Background())

	// Step 4: Start runTerminalRelay in a goroutine.
	relayDone := make(chan struct{})
	go func() {
		defer close(relayDone)
		c.runTerminalRelay(relayCtx, relayCancel, hubClientConn, ptySessID, ptyMgr)
	}()

	// Step 5: Start a goroutine to read output frames from hubServerConn.
	// Output frames arrive as binary frames with the relay frame encoding.
	outputFrames := make(chan string, 4096)
	outputDone := make(chan struct{})
	testCtx, testCancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer testCancel()

	go func() {
		defer close(outputDone)
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

	// sendInput sends keyboard input to the relay by writing a binary relay
	// frame to hubServerConn. The relay's dispatchBinaryFrame will route it
	// to the PTY session's input channel.
	sendInput := func(label string, payload []byte) {
		t.Helper()
		// payload is the raw ttyd client→server frame: byte '0' + keystrokes.
		frame := encodeTerminalFrame(sessUUID, payload)
		writeCtx, writeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer writeCancel()
		if writeErr := hubServerConn.Write(writeCtx, websocket.MessageBinary, frame); writeErr != nil {
			t.Fatalf("%s: failed to send input frame: %v", label, writeErr)
		}
		// dispatchBinaryFrame is not running from a hub readLoop here, so we
		// call it directly to route the frame to the session's input channel.
		c.dispatchBinaryFrame(frame)
	}

	// Step 6: Wait for shell prompt output.
	promptOutput := collectFor(3 * time.Second)
	if len(promptOutput) == 0 {
		t.Fatal("step 6: timed out waiting for shell prompt; no output received via relay path")
	}
	t.Logf("step 6: shell prompt received (%d bytes) via relay path", len(promptOutput))

	// Step 7: Launch vim with nocompatible mode.
	input := []byte("0vim -u NONE --cmd \"set nocompatible\"\r")
	sendInput("step 7", input)

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
