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
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
	"golang.org/x/sync/errgroup"
)

// normalizeRepoFilter normalizes a repo identifier for comparison.
// It lowercases the input, strips a .git suffix, strips a trailing slash,
// and strips known GitHub URL/SSH prefixes so that different representations
// of the same repository compare equal.
func normalizeRepoFilter(repo string) string {
	s := strings.ToLower(repo)
	s = strings.TrimSuffix(s, ".git")
	s = strings.TrimSuffix(s, "/")
	for _, prefix := range []string{
		"https://github.com/",
		"http://github.com/",
		"git@github.com:",
	} {
		if strings.HasPrefix(s, prefix) {
			s = s[len(prefix):]
			break
		}
	}
	return s
}

// filterAgentsByRepo returns a copy of agents with each agent's Profiles map
// filtered to only those profiles whose Repo matches repo (after normalization)
// or whose Repo is empty (generic profiles that match any project).
// All agents are returned even if their filtered Profiles map is empty.
func filterAgentsByRepo(agents []hub.AgentInfo, repo string) []hub.AgentInfo {
	normalized := normalizeRepoFilter(repo)
	result := make([]hub.AgentInfo, len(agents))
	for i, agent := range agents {
		filtered := make(map[string]hub.ProfileInfo)
		for name, profile := range agent.Profiles {
			if profile.Repo == "" || normalizeRepoFilter(profile.Repo) == normalized {
				filtered[name] = profile
			}
		}
		result[i] = hub.AgentInfo{
			Name:     agent.Name,
			Profiles: filtered,
			Status:   agent.Status,
			LastSeen: agent.LastSeen,
		}
	}
	return result
}

// handleListAgents returns all registered agents.
func handleListAgents(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agents := h.List()

		if repo := r.URL.Query().Get("repo"); repo != "" {
			agents = filterAgentsByRepo(agents, repo)
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"agents": agents,
		}); err != nil {
			slog.Error("failed to encode agents response", "error", err)
		}
	}
}

// listAllSessionsDeadline caps the total fan-out time for handleListAllSessions.
// Without this, worst-case latency is ceil(N/16)*5s (e.g. 160 agents → 50s),
// which exceeds the HTTP server's 35s WriteTimeout. Chosen to be safely under WriteTimeout.
const listAllSessionsDeadline = 28 * time.Second

// handleListAllSessions returns sessions across all online agents.
func handleListAllSessions(h *hub.Hub, overallDeadline time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agents := h.List()

		params := map[string]any{}
		if wfi := r.URL.Query().Get("waiting_for_input"); wfi == "true" {
			params["waiting_for_input"] = true
		}

		type agentSessions struct {
			AgentName string          `json:"agent_name"`
			Sessions  json.RawMessage `json:"sessions"`
		}

		// sem is per-request so concurrent callers each get their own pool of 16 slots.
		sem := make(chan struct{}, MaxAgentFanOut)

		var (
			mu      sync.Mutex
			results = make([]agentSessions, 0, len(agents))
		)

		// Apply an overall deadline across the entire fan-out. Without this,
		// worst-case latency is ceil(N/16)*listAllSessionsTimeout (e.g. 160
		// agents → 50s), which would exceed the HTTP server's WriteTimeout.
		fanOutCtx, cancel := context.WithTimeout(r.Context(), overallDeadline)
		defer cancel()

		eg, egCtx := errgroup.WithContext(fanOutCtx)
	loop:
		for _, info := range agents {
			if info.Status != hub.StatusOnline {
				continue
			}
			agent, ok := h.Get(info.Name)
			if !ok {
				continue
			}
			// Acquire semaphore before spawning goroutine to bound both
			// goroutine count and concurrent RPCs.
			select {
			case sem <- struct{}{}:
			case <-egCtx.Done():
				break loop
			}
			eg.Go(func() error {
				defer func() { <-sem }()
				callCtx, cancel := context.WithTimeout(egCtx, listAllSessionsTimeout)
				defer cancel()

				result, err := h.Call(callCtx, agent, "listSessions", params)
				if err != nil {
					slog.Debug("failed to list sessions from agent", "agent", info.Name, "error", err)
					return nil
				}

				var parsed struct {
					Sessions json.RawMessage `json:"sessions"`
				}
				if err := json.Unmarshal(result, &parsed); err != nil {
					slog.Debug("failed to parse sessions response", "agent", info.Name, "error", err)
					return nil
				}

				mu.Lock()
				results = append(results, agentSessions{
					AgentName: info.Name,
					Sessions:  parsed.Sessions,
				})
				mu.Unlock()
				return nil
			})
		}
		eg.Wait() //nolint:errcheck // goroutines only return nil

		// egCtx is cancelled when fanOutCtx's deadline is exceeded, which is
		// the only non-nil error source since goroutines always return nil.
		if errors.Is(egCtx.Err(), context.DeadlineExceeded) {
			writeJSONError(w, http.StatusGatewayTimeout, "fan-out deadline exceeded")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"agents": results,
		}); err != nil {
			slog.Error("failed to encode sessions response", "error", err)
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

		profiles := agent.Profiles
		if repo := r.URL.Query().Get("repo"); repo != "" {
			normalized := normalizeRepoFilter(repo)
			filtered := make(map[string]hub.ProfileInfo)
			for pname, profile := range profiles {
				if profile.Repo == "" || normalizeRepoFilter(profile.Repo) == normalized {
					filtered[pname] = profile
				}
			}
			profiles = filtered
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"name":      agent.Name,
			"profiles":  profiles,
			"status":    agent.Status(),
			"last_seen": agent.LastSeen(),
		})
	}
}

// rpcCallTimeout is the maximum time to wait for an agentd response.
const rpcCallTimeout = 30 * time.Second

// listAllSessionsTimeout is a tighter timeout for the fan-out polling endpoint,
// where each RPC is a lightweight in-memory query on the agent side.
const listAllSessionsTimeout = 5 * time.Second

// MaxAgentFanOut bounds the number of concurrent RPCs in handleListAllSessions
// to limit goroutine pressure when many agents are online.
const MaxAgentFanOut = 16

// handleCreateSession forwards a CreateSession request to the target agentd.
func handleCreateSession(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agent, ok := resolveAgent(h, w, r)
		if !ok {
			return
		}

		// CreateSession params are small (session ID + profile name); cap at RPC
		// frame limit rather than the global REST body limit (1 MiB).
		r.Body = http.MaxBytesReader(w, r.Body, hub.RPCMaxMessageSize)

		body, err := io.ReadAll(r.Body)
		if err != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				writeJSONError(w, http.StatusRequestEntityTooLarge, "request body too large")
				return
			}
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

		// Agent connections originate from agentd (a non-browser client) and
		// do not include an Origin header, so origin validation is not needed.
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			slog.Error("failed to accept websocket", "error", err)
			return
		}

		// Clear server-level read and write deadlines so http.Server's
		// ReadTimeout/WriteTimeout do not kill this long-lived WebSocket
		// connection. Both terminal proxy paths do the same.
		rc := http.NewResponseController(w)
		if err := rc.SetReadDeadline(time.Time{}); err != nil {
			slog.Error("failed to clear read deadline", "error", err)
			conn.Close(websocket.StatusInternalError, "internal error")
			return
		}
		if err := rc.SetWriteDeadline(time.Time{}); err != nil {
			slog.Error("failed to clear write deadline", "error", err)
			conn.Close(websocket.StatusInternalError, "internal error")
			return
		}

		// The register message is a JSON-RPC text frame; apply the RPC limit.
		// HandleAgentConnection raises this to MaxMessageSize for relay frames.
		conn.SetReadLimit(hub.RPCMaxMessageSize)

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

		for name, profile := range params.Profiles {
			if err := hub.ValidateProfileRepo(profile.Repo); err != nil {
				slog.Warn("rejecting agent registration: invalid profile repo",
					"agent", params.Name, "profile", name, "error", err)
				conn.Close(websocket.StatusPolicyViolation, err.Error())
				return
			}
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
