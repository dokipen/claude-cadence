package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
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
func HandleTerminalProxy(h *hub.Hub) http.HandlerFunc {
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

		if endpoint.Address != agent.TtydConfig.AdvertiseAddress {
			slog.Warn("terminal endpoint address mismatch",
				"agent", agentName,
				"expected_address", agent.TtydConfig.AdvertiseAddress,
				"actual_address", endpoint.Address,
			)
			writeJSONError(w, http.StatusBadGateway, "terminal endpoint mismatch")
			return
		}
		maxPorts := agent.TtydConfig.MaxPorts
		if maxPorts <= 0 {
			maxPorts = 100 // default matches agentd's default
		}
		maxPort := agent.TtydConfig.BasePort + maxPorts
		if endpoint.Port < agent.TtydConfig.BasePort || endpoint.Port >= maxPort {
			slog.Warn("terminal endpoint port out of range",
				"agent", agentName,
				"port", endpoint.Port,
				"range_start", agent.TtydConfig.BasePort,
				"range_end", maxPort,
			)
			writeJSONError(w, http.StatusBadGateway, "terminal endpoint mismatch")
			return
		}

		// Dial agentd's ttyd WebSocket.
		ttydURL := fmt.Sprintf("ws://%s:%d/ws", endpoint.Address, endpoint.Port)
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
		// Allow any origin because the hub sits behind a reverse proxy (Caddy)
		// which forwards the browser's Origin (e.g. https://cadence.bootsy.internal)
		// while the hub sees Host as 127.0.0.1:4200. Caddy handles TLS and access control.
		browserConn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
			Subprotocols:       []string{"tty"},
		})
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
