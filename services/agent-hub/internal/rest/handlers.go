package rest

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

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

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{})
		if err != nil {
			slog.Error("failed to accept websocket", "error", err)
			return
		}

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

		// Send registration acknowledgment.
		resp, err := hub.NewResponse(req.ID, &hub.RegisterResult{Accepted: true})
		if err != nil {
			slog.Error("failed to create register response", "error", err)
			conn.Close(websocket.StatusInternalError, "internal error")
			return
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

		agent := h.Register(params.Name, conn, &params)
		slog.Info("agent connected via websocket", "agent", params.Name)

		// Block handling messages until the connection closes.
		h.HandleAgentConnection(r.Context(), agent)
	}
}
