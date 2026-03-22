package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
	"github.com/google/uuid"
)

const (
	// rpcCallTimeout is the maximum time to wait for a getTerminalEndpoint response.
	rpcCallTimeout = 30 * time.Second

	// maxRelayMessageSize is the maximum size of a single WebSocket message
	// relayed through the terminal proxy (1 MiB).
	maxRelayMessageSize = 1024 * 1024
)

// HandleTerminalProxy returns an HTTP handler that proxies WebSocket connections
// from the browser to an agentd's ttyd instance via the hub.
// allowedOrigins restricts which browser origins may connect via Origin header
// validation (CSRF protection). When empty, connections from any origin are
// accepted — suitable for development or when the reverse proxy enforces access
// control. When non-empty, only the listed origin patterns are allowed.
func HandleTerminalProxy(h *hub.Hub, allowedOrigins []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agentName := r.PathValue("agent_name")
		sessionID := r.PathValue("session_id")

		agent, ok := h.Get(agentName)
		if !ok {
			writeJSONError(w, http.StatusNotFound, "agent not found")
			return
		}
		if agent.Status() != hub.StatusOnline {
			writeJSONError(w, http.StatusBadGateway, "agent offline")
			return
		}

		// Ask agentd for the ttyd endpoint.
		callCtx, cancel := context.WithTimeout(r.Context(), rpcCallTimeout)
		defer cancel()

		params := hub.GetTerminalEndpointParams{SessionID: sessionID}
		resultRaw, err := h.Call(callCtx, agent, "getTerminalEndpoint", params)
		if err != nil {
			writeRPCError(w, err)
			return
		}

		var endpoint hub.GetTerminalEndpointResult
		if err := json.Unmarshal(resultRaw, &endpoint); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "invalid terminal endpoint response")
			return
		}

		if endpoint.Relay {
			// Relay path: tunnel PTY frames through the agent's existing hub WebSocket.
			sessionUUID, err := uuid.Parse(sessionID)
			if err != nil {
				writeJSONError(w, http.StatusBadRequest, "invalid session ID")
				return
			}

			// Accept the browser's WebSocket upgrade before opening the relay.
			acceptOpts := &websocket.AcceptOptions{
				Subprotocols: []string{"tty"},
			}
			if len(allowedOrigins) > 0 {
				acceptOpts.OriginPatterns = allowedOrigins
			} else {
				// Safe for loopback/internal connections where a reverse proxy
				// (e.g. Caddy) handles origin validation before reaching the hub.
				acceptOpts.InsecureSkipVerify = true
			}
			browserConn, err := websocket.Accept(w, r, acceptOpts)
			if err != nil {
				slog.Error("failed to accept browser websocket", "error", err)
				return
			}
			defer browserConn.Close(websocket.StatusGoingAway, "proxy closing")

			// Clear the server's WriteTimeout so idle terminal sessions aren't killed.
			rc := http.NewResponseController(w)
			rc.SetWriteDeadline(time.Time{})

			browserConn.SetReadLimit(maxRelayMessageSize)

			ctx, ctxCancel := context.WithCancel(r.Context())
			defer ctxCancel()

			// Track this terminal session for graceful shutdown.
			sessionTrackID := uuid.NewString()
			h.TrackTerminalSession(sessionTrackID, ctxCancel)
			defer h.UntrackTerminalSession(sessionTrackID)

			relayCh, cleanup, err := h.OpenTerminalRelay(ctx, agentName, sessionUUID)
			if err != nil {
				slog.Error("failed to open terminal relay", "agent", agentName, "session", sessionID, "error", err)
				browserConn.Close(websocket.StatusInternalError, "relay unavailable")
				return
			}
			defer cleanup()

			// PTY → Browser goroutine.
			go func() {
				defer ctxCancel()
				for {
					select {
					case payload, ok := <-relayCh:
						if !ok {
							return
						}
						if err := browserConn.Write(ctx, websocket.MessageBinary, payload); err != nil {
							return
						}
					case <-ctx.Done():
						return
					}
				}
			}()

			// Browser → PTY (main goroutine).
			for {
				_, payload, err := browserConn.Read(ctx)
				if err != nil {
					break
				}
				if err := h.WriteTerminalFrame(ctx, agentName, sessionUUID, payload); err != nil {
					break
				}
			}
			return
		}

		if endpoint.URL == "" {
			writeJSONError(w, http.StatusBadGateway, "no terminal endpoint available")
			return
		}

		parsed, err := url.Parse(endpoint.URL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			writeJSONError(w, http.StatusBadGateway, "invalid terminal endpoint URL")
			return
		}

		if parsed.Scheme != "ws" && parsed.Scheme != "wss" {
			slog.Warn("terminal endpoint has invalid scheme",
				"agent", agentName,
				"scheme", parsed.Scheme,
			)
			writeJSONError(w, http.StatusBadGateway, "invalid terminal endpoint URL")
			return
		}

		// Compare hostname (without port) against the registered advertise
		// address. AdvertiseAddress may be a bare IP or host:port; extract
		// just the IP for comparison.
		expectedHost := agent.TtydConfig.AdvertiseAddress
		if h, _, err := net.SplitHostPort(expectedHost); err == nil {
			expectedHost = h
		}
		if parsed.Hostname() != expectedHost {
			slog.Warn("terminal endpoint host mismatch",
				"agent", agentName,
				"expected_host", agent.TtydConfig.AdvertiseAddress,
				"actual_host", parsed.Hostname(),
			)
			writeJSONError(w, http.StatusBadGateway, "terminal endpoint mismatch")
			return
		}

		// Dial agentd's terminal WebSocket.
		ttydURL := endpoint.URL
		ttydConn, _, err := websocket.Dial(r.Context(), ttydURL, &websocket.DialOptions{
			Subprotocols: []string{"tty"},
		})
		if err != nil {
			slog.Error("failed to dial ttyd", "url", ttydURL, "error", err)
			writeJSONError(w, http.StatusBadGateway, "failed to connect to terminal")
			return
		}
		defer ttydConn.Close(websocket.StatusGoingAway, "proxy closing")

		// Accept the browser's WebSocket upgrade.
		// When allowed_origins is configured, only those origins are permitted
		// (CSRF protection via Origin header validation). When it is empty we
		// fall back to skipping the check — this is safe for local development
		// or when the reverse proxy (e.g. Caddy) enforces access control and
		// the hub is not directly exposed to the internet.
		acceptOpts := &websocket.AcceptOptions{
			Subprotocols: []string{"tty"},
		}
		if len(allowedOrigins) > 0 {
			acceptOpts.OriginPatterns = allowedOrigins
		} else {
			acceptOpts.InsecureSkipVerify = true
		}
		browserConn, err := websocket.Accept(w, r, acceptOpts)
		if err != nil {
			slog.Error("failed to accept browser websocket", "error", err)
			ttydConn.Close(websocket.StatusGoingAway, "browser accept failed")
			return
		}
		defer browserConn.Close(websocket.StatusGoingAway, "proxy closing")

		// Clear the server's WriteTimeout so idle terminal sessions aren't killed.
		// coder/websocket extends the deadline on each write, but idle sessions
		// with no writes would hit the server's 35s timeout.
		rc := http.NewResponseController(w)
		rc.SetWriteDeadline(time.Time{})

		// Apply read limits to prevent memory exhaustion.
		browserConn.SetReadLimit(maxRelayMessageSize)
		ttydConn.SetReadLimit(maxRelayMessageSize)

		// Relay bidirectionally.
		ctx, ctxCancel := context.WithCancel(r.Context())
		defer ctxCancel()

		// Track this terminal session for graceful shutdown.
		sessionTrackID := uuid.NewString()
		h.TrackTerminalSession(sessionTrackID, ctxCancel)
		defer h.UntrackTerminalSession(sessionTrackID)

		errc := make(chan error, 2)
		go func() { errc <- relay(ctx, browserConn, ttydConn) }()
		go func() { errc <- relay(ctx, ttydConn, browserConn) }()

		// Wait for either direction to finish, then cancel the other.
		<-errc
		ctxCancel()
		<-errc
	}
}

// relay copies WebSocket messages from src to dst until ctx is cancelled or an error occurs.
func relay(ctx context.Context, dst, src *websocket.Conn) error {
	for {
		msgType, data, err := src.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
		if err := dst.Write(ctx, msgType, data); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
	}
}

// writeJSONError writes a JSON error response.
func writeJSONError(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// writeRPCError maps hub RPC errors to HTTP responses.
func writeRPCError(w http.ResponseWriter, err error) {
	var callErr *hub.CallError
	if errors.As(err, &callErr) {
		status := rpcCodeToHTTPStatus(callErr.RPCError.Code)
		writeJSONError(w, status, callErr.RPCError.Message)
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		writeJSONError(w, http.StatusGatewayTimeout, "agent timeout")
		return
	}
	writeJSONError(w, http.StatusBadGateway, "agent communication error")
}

func rpcCodeToHTTPStatus(code int) int {
	switch code {
	case hub.RPCErrNotFound:
		return http.StatusNotFound
	case hub.RPCErrAlreadyExists:
		return http.StatusConflict
	case hub.RPCErrInvalidArgument:
		return http.StatusBadRequest
	case hub.RPCErrFailedPrecondition:
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}
