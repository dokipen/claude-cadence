package rest

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
)

// handleListAgents returns all registered agents.
func handleListAgents(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agents := h.List()

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"agents": agents,
		}); err != nil {
			slog.Error("failed to encode agents response", "error", err)
		}
	}
}

// handleGetAgent returns info for a single agent by name.
func handleGetAgent(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		agent, ok := h.Get(name)
		if !ok {
			writeJSONError(w, http.StatusNotFound, "agent not found")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"name":      agent.Name,
			"profiles":  agent.Profiles,
			"status":    agent.Status(),
			"last_seen": agent.LastSeen(),
		})
	}
}

// rpcCallTimeout is the maximum time to wait for an agentd response.
const rpcCallTimeout = 30 * time.Second

// handleCreateSession forwards a CreateSession request to the target agentd.
func handleCreateSession(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agent, ok := resolveAgent(h, w, r)
		if !ok {
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, hub.MaxMessageSize))
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "failed to read request body")
			return
		}
		var params json.RawMessage
		if len(body) > 0 {
			params = body
		}

		result, err := callAgent(r.Context(), h, agent, "createSession", params, w)
		if err != nil {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		w.Write(result)
	}
}

// handleListSessions forwards a ListSessions request to the target agentd.
func handleListSessions(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agent, ok := resolveAgent(h, w, r)
		if !ok {
			return
		}

		params := map[string]any{}
		if profile := r.URL.Query().Get("profile"); profile != "" {
			params["agent_profile"] = profile
		}
		if state := r.URL.Query().Get("state"); state != "" {
			params["state"] = state
		}

		result, err := callAgent(r.Context(), h, agent, "listSessions", params, w)
		if err != nil {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(result)
	}
}

// handleGetSession forwards a GetSession request to the target agentd.
func handleGetSession(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agent, ok := resolveAgent(h, w, r)
		if !ok {
			return
		}

		sessionID := r.PathValue("id")
		params := map[string]string{"session_id": sessionID}

		result, err := callAgent(r.Context(), h, agent, "getSession", params, w)
		if err != nil {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(result)
	}
}

// handleDestroySession forwards a DestroySession request to the target agentd.
func handleDestroySession(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agent, ok := resolveAgent(h, w, r)
		if !ok {
			return
		}

		sessionID := r.PathValue("id")
		params := map[string]any{"session_id": sessionID}
		if r.URL.Query().Get("force") == "true" {
			params["force"] = true
		}

		result, err := callAgent(r.Context(), h, agent, "destroySession", params, w)
		if err != nil {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(result)
	}
}

// resolveAgent looks up the agent by the "name" path parameter.
// Returns false if the agent was not found or is offline (writes the HTTP error).
func resolveAgent(h *hub.Hub, w http.ResponseWriter, r *http.Request) (*hub.ConnectedAgent, bool) {
	name := r.PathValue("name")
	agent, ok := h.Get(name)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "agent not found")
		return nil, false
	}
	if agent.Status() != hub.StatusOnline {
		writeJSONError(w, http.StatusBadGateway, "agent offline")
		return nil, false
	}
	return agent, true
}

// callAgent performs an RPC call to the agent and maps errors to HTTP responses.
// Returns nil result and non-nil error if an HTTP error was already written.
func callAgent(ctx context.Context, h *hub.Hub, agent *hub.ConnectedAgent, method string, params any, w http.ResponseWriter) (json.RawMessage, error) {
	callCtx, cancel := context.WithTimeout(ctx, rpcCallTimeout)
	defer cancel()

	result, err := h.Call(callCtx, agent, method, params)
	if err != nil {
		writeRPCError(w, err)
		return nil, err
	}
	return result, nil
}

// writeRPCError maps an RPC error to an HTTP status code and writes the response.
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

// rpcCodeToHTTPStatus maps JSON-RPC error codes to HTTP status codes.
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

// writeJSONError writes a JSON error response.
func writeJSONError(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// handleAgentWebSocket accepts WebSocket connections from agentd instances.
func handleAgentWebSocket(h *hub.Hub, agentToken string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Validate agent token.
		auth := r.Header.Get("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(auth, prefix) {
			http.Error(w, "missing or invalid authorization header", http.StatusUnauthorized)
			return
		}
		provided := auth[len(prefix):]
		if subtle.ConstantTimeCompare([]byte(provided), []byte(agentToken)) != 1 {
			http.Error(w, "invalid agent token", http.StatusUnauthorized)
			return
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			// Agent connections come from agentd (not browsers), so skip origin check.
			InsecureSkipVerify: true,
		})
		if err != nil {
			slog.Error("failed to accept websocket", "error", err)
			return
		}

		conn.SetReadLimit(hub.MaxMessageSize)

		// Read the first message, which must be a register request.
		_, data, err := conn.Read(r.Context())
		if err != nil {
			slog.Error("failed to read register message", "error", err)
			conn.Close(websocket.StatusProtocolError, "expected register message")
			return
		}

		var req hub.Request
		if err := json.Unmarshal(data, &req); err != nil || req.Method != "register" {
			slog.Error("invalid register message", "error", err)
			conn.Close(websocket.StatusProtocolError, "expected register message")
			return
		}

		var params hub.RegisterParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			slog.Error("invalid register params", "error", err)
			conn.Close(websocket.StatusProtocolError, "invalid register params")
			return
		}

		if err := hub.ValidateAdvertiseAddress(params.Ttyd.AdvertiseAddress); err != nil {
			slog.Warn("rejecting agent registration: invalid advertise address",
				"agent", params.Name, "address", params.Ttyd.AdvertiseAddress, "error", err)
			conn.Close(websocket.StatusPolicyViolation, err.Error())
			return
		}

		// Attempt registration before sending the acknowledgment so we can
		// reject agents that try to change their AdvertiseAddress.
		agent, regErr := h.Register(params.Name, conn, &params)

		// Build the response based on whether registration succeeded.
		var resp *hub.Response
		if regErr != nil {
			slog.Warn("agent registration rejected", "agent", params.Name, "error", regErr)
			resp = hub.NewErrorResponse(req.ID, hub.RPCErrFailedPrecondition, "registration rejected")
		} else {
			resp, err = hub.NewResponse(req.ID, &hub.RegisterResult{Accepted: true})
			if err != nil {
				slog.Error("failed to create register response", "error", err)
				conn.Close(websocket.StatusInternalError, "internal error")
				return
			}
		}

		respData, err := json.Marshal(resp)
		if err != nil {
			slog.Error("failed to marshal register response", "error", err)
			conn.Close(websocket.StatusInternalError, "internal error")
			return
		}
		if err := conn.Write(r.Context(), websocket.MessageText, respData); err != nil {
			slog.Error("failed to send register response", "error", err)
			return
		}

		if regErr != nil {
			conn.Close(websocket.StatusPolicyViolation, "registration rejected")
			return
		}

		slog.Info("agent connected via websocket", "agent", params.Name)

		// Block handling messages until the connection closes.
		h.HandleAgentConnection(r.Context(), agent)
	}
}
