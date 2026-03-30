package hub

import (
	"context"
	"net"
	"net/http"
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
			select {
			case frameCh <- payload:
			default:
			}
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
	// RegisterRelaySession), writeMu (protecting hubConn writes), and dispatcher
	// (DestroySession when the PTY exits). newTestDispatcher provides a real
	// in-memory Dispatcher; DestroySession will return notFound for our ephemeral
	// session, which the relay handles gracefully (logs and continues).
	c := &Client{
		relayCh:    make(map[string]chan []byte),
		dispatcher: newTestDispatcher(),
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
