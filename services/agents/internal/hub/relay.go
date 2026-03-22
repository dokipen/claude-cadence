package hub

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
)

const (
	// frameTypeTerminal identifies a terminal relay binary frame.
	// Must match agent-hub's FrameTypeTerminal = 0x01.
	frameTypeTerminal byte = 0x01
	// terminalFrameHeaderLen is 1 (type byte) + 16 (UUID bytes).
	terminalFrameHeaderLen = 17
)

// encodeTerminalFrame encodes a terminal data frame as:
//
//	[1-byte type=0x01][16-byte session UUID][payload]
//
// This must match the format in services/agent-hub/internal/hub/relay.go.
func encodeTerminalFrame(sessionID uuid.UUID, payload []byte) []byte {
	frame := make([]byte, terminalFrameHeaderLen+len(payload))
	frame[0] = frameTypeTerminal
	copy(frame[1:17], sessionID[:])
	copy(frame[17:], payload)
	return frame
}

// decodeTerminalFrame decodes a binary frame, returning the session UUID and
// payload. Returns an error if the frame is malformed or the type byte is wrong.
func decodeTerminalFrame(frame []byte) (uuid.UUID, []byte, error) {
	if len(frame) < terminalFrameHeaderLen {
		return uuid.UUID{}, nil, fmt.Errorf("terminal frame too short: %d bytes", len(frame))
	}
	if frame[0] != frameTypeTerminal {
		return uuid.UUID{}, nil, fmt.Errorf("unexpected frame type: 0x%02x", frame[0])
	}
	var id uuid.UUID
	copy(id[:], frame[1:17])
	return id, frame[17:], nil
}

// runTerminalRelay bridges a PTY session to the hub WebSocket using binary relay
// frames. It spins up a local WebSocket server to satisfy ServeTerminal's
// *websocket.Conn requirement, then pumps frames between that connection and the
// hub WebSocket binary channel.
//
// A loopback HTTP server is used because coder/websocket requires a real HTTP
// upgrade handshake to produce a *websocket.Conn — there is no API to create
// one from a raw net.Conn. The TCP overhead on localhost is negligible.
//
// ptySessID is the string session UUID. The hub connection write mutex (writeMu)
// is used to protect concurrent writes on hubConn.
//
// relayCancel is the CancelFunc for ctx; it is called from the relay-channel
// cleanup so that both the channel close and context cancellation happen
// together when the session is unregistered (e.g. on hub reconnect).
//
// The relay runs until ctx is cancelled or the PTY session ends.
func (c *Client) runTerminalRelay(
	ctx context.Context,
	relayCancel context.CancelFunc,
	hubConn *websocket.Conn,
	ptySessID string,
	ptyMgr *pty.PTYManager,
) {
	parsed, err := uuid.Parse(ptySessID)
	if err != nil {
		slog.Error("relay: invalid session UUID", "session_id", ptySessID, "error", err)
		return
	}

	// Register an input channel so readLoop can deliver browser→PTY frames.
	// The cleanup closes the channel (unblocking the input select below) and
	// also cancels relayCtx so that any writes referencing the old hub
	// connection are torn down immediately on hub reconnect.
	inputCh, cleanup := c.RegisterRelaySession(ptySessID, relayCancel)
	defer cleanup()

	// Spin up a local WebSocket server that calls ServeTerminal.
	// This gives us a *websocket.Conn pair without modifying the pty package.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		slog.Error("relay: failed to listen for local WebSocket", "session_id", ptySessID, "error", err)
		return
	}

	localAddr := "ws://" + ln.Addr().String() + "/ws/terminal"

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/terminal", func(w http.ResponseWriter, r *http.Request) {
		conn, acceptErr := websocket.Accept(w, r, &websocket.AcceptOptions{
			// InsecureSkipVerify skips the Origin header check. This is safe
			// because the listener is bound to 127.0.0.1:0 and dialed within
			// the same process — it is not reachable from external hosts and
			// carries no TLS, so there is no real TLS bypass here.
			InsecureSkipVerify: true,
		})
		if acceptErr != nil {
			slog.Error("relay: local WS accept failed", "session_id", ptySessID, "error", acceptErr)
			return
		}
		defer conn.CloseNow()
		_ = ptyMgr.ServeTerminal(r.Context(), ptySessID, conn)
	})

	localSrv := &http.Server{Handler: mux}
	go func() {
		if serveErr := localSrv.Serve(ln); serveErr != nil && ctx.Err() == nil {
			slog.Debug("relay: local WS server stopped", "session_id", ptySessID, "error", serveErr)
		}
	}()
	defer localSrv.Close()

	// Connect the "browser side" of the local WebSocket pair.
	localConn, _, err := websocket.Dial(ctx, localAddr, nil)
	if err != nil {
		slog.Error("relay: failed to dial local WebSocket", "session_id", ptySessID, "error", err)
		return
	}
	defer localConn.CloseNow()

	slog.Debug("relay: terminal relay started", "session_id", ptySessID)

	// outputDone signals that the PTY→hub goroutine has exited.
	outputDone := make(chan struct{})

	// Goroutine: PTY output → hub binary frames.
	// Reads ttyd text frames from localConn and forwards as binary relay frames.
	go func() {
		defer close(outputDone)
		for {
			_, data, readErr := localConn.Read(ctx)
			if readErr != nil {
				slog.Debug("relay: local WS read ended", "session_id", ptySessID, "error", readErr)
				return
			}
			// data is a ttyd server→client frame: byte '0' + raw terminal bytes.
			// We forward the whole ttyd frame as the binary relay payload — the hub
			// and browser already understand the ttyd framing embedded in the payload.
			frame := encodeTerminalFrame(parsed, data)
			c.writeMu.Lock()
			writeErr := hubConn.Write(ctx, websocket.MessageBinary, frame)
			c.writeMu.Unlock()
			if writeErr != nil {
				slog.Debug("relay: hub write failed", "session_id", ptySessID, "error", writeErr)
				return
			}
		}
	}()

	// Main loop: hub binary frames → PTY input (via localConn).
	// Receives browser→PTY frames from inputCh and forwards them to localConn
	// as ttyd client→server text frames.
	for {
		select {
		case <-ctx.Done():
			slog.Debug("relay: context done, stopping relay", "session_id", ptySessID)
			return
		case <-outputDone:
			slog.Debug("relay: output goroutine done, stopping relay", "session_id", ptySessID)
			return
		case payload, ok := <-inputCh:
			if !ok {
				slog.Debug("relay: input channel closed, stopping relay", "session_id", ptySessID)
				return
			}
			// payload is the raw ttyd client→server frame forwarded from the browser:
			// byte '0' + input bytes, or byte '1' + JSON resize.
			if writeErr := localConn.Write(ctx, websocket.MessageText, payload); writeErr != nil {
				slog.Warn("relay: local WS write failed", "session_id", ptySessID, "error", writeErr)
				return
			}
		}
	}
}
