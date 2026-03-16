package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
)

const (
	// rpcCallTimeout is the maximum time to wait for a getTerminalEndpoint response.
	rpcCallTimeout = 30 * time.Second
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

		// Dial agentd's ttyd WebSocket.
		ttydURL := fmt.Sprintf("ws://%s:%d/ws", endpoint.Address, endpoint.Port)
		ttydConn, _, err := websocket.Dial(r.Context(), ttydURL, nil)
		if err != nil {
			slog.Error("failed to dial ttyd", "url", ttydURL, "error", err)
			writeJSONError(w, http.StatusBadGateway, "failed to connect to terminal")
			return
		}
		defer ttydConn.Close(websocket.StatusGoingAway, "proxy closing")

		// Accept the browser's WebSocket upgrade.
		browserConn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			// ttyd uses binary frames; allow any subprotocol the browser requests.
			InsecureSkipVerify: true,
		})
		if err != nil {
			slog.Error("failed to accept browser websocket", "error", err)
			ttydConn.Close(websocket.StatusGoingAway, "browser accept failed")
			return
		}
		defer browserConn.Close(websocket.StatusGoingAway, "proxy closing")

		// Relay bidirectionally.
		ctx, ctxCancel := context.WithCancel(r.Context())
		defer ctxCancel()

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
	io.WriteString(w, `{"error":"`+message+`"}`)
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
