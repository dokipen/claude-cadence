package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
	"github.com/google/uuid"
)

const (
	// rpcCallTimeout is the maximum time to wait for a getTerminalEndpoint response.
	rpcCallTimeout = 30 * time.Second
)

// defaultPingInterval is how often the proxy sends keepalive pings to both
// WebSocket connections to prevent idle connection drops by OS/NAT firewalls.
const defaultPingInterval = 10 * time.Second

// HandleTerminalProxy returns an HTTP handler that proxies WebSocket connections
// from the browser to an agentd's ttyd instance via the hub.
// allowedOrigins restricts which browser origins may connect via Origin header
// validation (CSRF protection). When empty, connections from any origin are
// accepted — suitable for development or when the reverse proxy enforces access
// control. When non-empty, only the listed origin patterns are allowed.
// A zero idleTimeout disables idle timeout enforcement.
func HandleTerminalProxy(h *hub.Hub, allowedOrigins []string, idleTimeout time.Duration, agentdToken string) http.HandlerFunc {
	return handleTerminalProxy(h, allowedOrigins, defaultPingInterval, idleTimeout, agentdToken)
}

// handleTerminalProxy is the testable implementation that accepts an explicit
// pingInterval and idleTimeout, avoiding the data race caused by tests mutating
// a package-level var. A zero idleTimeout disables idle timeout enforcement.
func handleTerminalProxy(h *hub.Hub, allowedOrigins []string, pingInterval time.Duration, idleTimeout time.Duration, agentdToken string) http.HandlerFunc {
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

			// Create context and session ID early so we can check the session
			// limit before accepting the WebSocket upgrade.
			ctx, ctxCancel := context.WithCancel(r.Context())
			defer ctxCancel()

			sessionTrackID := uuid.NewString()
			if !h.AcquireTerminalSession(sessionTrackID, ctxCancel) {
				ctxCancel()
				http.Error(w, "terminal session limit reached", http.StatusServiceUnavailable)
				return
			}
			defer h.UntrackTerminalSession(sessionTrackID)

			// Accept the browser's WebSocket upgrade after the session limit check.
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
			rc.SetReadDeadline(time.Time{})
			rc.SetWriteDeadline(time.Time{})

			browserConn.SetReadLimit(hub.MaxMessageSize)

			// Set up idle timeout if configured.
			var idleTimer *time.Timer
			var idleTimerMu sync.Mutex

			resetIdle := func() {} // no-op when idleTimeout == 0

			if idleTimeout > 0 {
				idleTimer = time.AfterFunc(idleTimeout, func() {
					slog.Info("terminal session idle timeout", "session", sessionTrackID, "idle_timeout", idleTimeout)
					ctxCancel()
				})
				defer idleTimer.Stop()

				resetIdle = func() {
					idleTimerMu.Lock()
					defer idleTimerMu.Unlock()
					idleTimer.Reset(idleTimeout)
				}
			}

			relayCh, cleanup, err := h.OpenTerminalRelay(ctx, agentName, sessionUUID)
			if err != nil {
				slog.Error("failed to open terminal relay", "agent", agentName, "session", sessionID, "error", err)
				browserConn.Close(websocket.StatusInternalError, "relay unavailable")
				return
			}
			defer cleanup()

			// Ping browserConn to prevent idle OS/NAT firewalls from dropping the
			// browser→hub connection. Read is called concurrently by the browser→PTY
			// loop below, satisfying the pong-reception requirement.
			//
			// Unlike the non-relay path (which drains four goroutines via errc),
			// this goroutine is fire-and-forget: the deferred ctxCancel above
			// unblocks pingKeepalive's ctx.Done select, guaranteeing cleanup.
			go func() {
				if err := pingKeepalive(ctx, browserConn, pingInterval); err != nil && ctx.Err() == nil {
					ctxCancel()
				}
			}()

			// PTY → Browser goroutine.
			go func() {
				defer ctxCancel()
				for {
					select {
					case payload, ok := <-relayCh:
						if !ok {
							return
						}
						resetIdle()
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
				resetIdle()
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

		// Create context and session ID early so we can check the session
		// limit before accepting the WebSocket upgrade.
		ctx, ctxCancel := context.WithCancel(r.Context())
		defer ctxCancel()

		sessionTrackID := uuid.NewString()
		if !h.AcquireTerminalSession(sessionTrackID, ctxCancel) {
			ctxCancel()
			http.Error(w, "terminal session limit reached", http.StatusServiceUnavailable)
			return
		}
		defer h.UntrackTerminalSession(sessionTrackID)

		// Dial agentd's terminal WebSocket.
		ttydURL := endpoint.URL
		dialOpts := &websocket.DialOptions{
			Subprotocols: []string{"tty"},
		}
		if agentdToken != "" {
			dialOpts.HTTPHeader = http.Header{
				"Authorization": []string{"Bearer " + agentdToken},
			}
		}
		ttydConn, _, err := websocket.Dial(r.Context(), ttydURL, dialOpts)
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

		// Clear connection deadlines so idle terminal sessions aren't killed.
		// The HTTP server sets WriteTimeout (35s) which would close idle
		// WebSocket connections. ReadHeaderTimeout doesn't affect post-upgrade
		// connections, but we clear both as defense-in-depth.
		rc := http.NewResponseController(w)
		rc.SetReadDeadline(time.Time{})
		rc.SetWriteDeadline(time.Time{})

		// Apply read limits to prevent memory exhaustion.
		browserConn.SetReadLimit(hub.MaxMessageSize)
		ttydConn.SetReadLimit(hub.MaxMessageSize)

		// Set up idle timeout if configured.
		var idleTimer *time.Timer
		var idleTimerMu sync.Mutex

		activityFn := func() {} // no-op when idleTimeout == 0

		if idleTimeout > 0 {
			idleTimer = time.AfterFunc(idleTimeout, func() {
				slog.Info("terminal session idle timeout", "session", sessionTrackID, "idle_timeout", idleTimeout)
				ctxCancel()
			})
			defer idleTimer.Stop()

			activityFn = func() {
				idleTimerMu.Lock()
				defer idleTimerMu.Unlock()
				idleTimer.Reset(idleTimeout)
			}
		}

		errc := make(chan error, 4)
		go func() { errc <- relay(ctx, browserConn, ttydConn, activityFn) }()
		go func() { errc <- relay(ctx, ttydConn, browserConn, activityFn) }()
		go func() { errc <- pingKeepalive(ctx, browserConn, pingInterval) }()
		go func() { errc <- pingKeepalive(ctx, ttydConn, pingInterval) }()

		// Wait for any goroutine to finish, then cancel the rest.
		<-errc
		ctxCancel()
		<-errc
		<-errc
		<-errc
	}
}

// relay copies WebSocket messages from src to dst until ctx is cancelled or an
// error occurs. activityFn is called after each successful read and write to
// signal activity (used to reset the idle timeout timer). Calling on read
// ensures keystrokes (browser→PTY direction) reset the idle timer even when
// PTY output is sparse.
func relay(ctx context.Context, dst, src *websocket.Conn, activityFn func()) error {
	for {
		msgType, data, err := src.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
		activityFn()
		if err := dst.Write(ctx, msgType, data); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
		activityFn()
	}
}

// pingKeepalive sends periodic WebSocket pings on conn to prevent idle
// OS/NAT firewalls from dropping the connection. It fires every pingInterval
// and uses a per-ping context with the same timeout so a slow pong times out
// before the next ping is due. It returns ctx.Err() when the context is
// cancelled, or the ping error on failure.
//
// Ping requires that Read is being called concurrently on conn so that the
// pong frame can be received and processed:
//   - pinging browserConn is safe because relay(ctx, ttydConn, browserConn)
//     calls browserConn.Read in a sibling goroutine.
//   - pinging ttydConn is safe because relay(ctx, browserConn, ttydConn)
//     calls ttydConn.Read in a sibling goroutine.
func pingKeepalive(ctx context.Context, conn *websocket.Conn, pingInterval time.Duration) error {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, pingInterval)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				return err
			}
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
