package rest

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/dokipen/claude-cadence/services/agent-hub/internal/config"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/proxy"
)

// Server is the HTTP server for the agent-hub REST API.
type Server struct {
	httpServer *http.Server
	addr       string
}

// New creates a new REST server.
func New(h *hub.Hub, cfg *config.Config) *Server {
	mux := http.NewServeMux()

	// Agent WebSocket endpoint — uses separate agent token auth.
	agentToken := cfg.HubAuth.ResolveToken()
	mux.HandleFunc("GET /ws/agent", handleAgentWebSocket(h, agentToken))

	// REST API endpoints — protected by API token auth.
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/v1/agents", handleListAgents(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}", handleGetAgent(h))
	apiMux.HandleFunc("POST /api/v1/agents/{name}/sessions", handleCreateSession(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}/sessions", handleListSessions(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}/sessions/{id}", handleGetSession(h))
	apiMux.HandleFunc("DELETE /api/v1/agents/{name}/sessions/{id}", handleDestroySession(h))
	apiMux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", proxy.HandleTerminalProxy(h))

	var apiHandler http.Handler = apiMux
	if cfg.Auth.Mode == "token" {
		apiToken := cfg.Auth.ResolveToken()
		apiHandler = tokenAuth(apiToken)(apiMux)
	}
	mux.Handle("/api/v1/", apiHandler)
	mux.Handle("/ws/terminal/", apiHandler)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	return &Server{
		httpServer: &http.Server{
			Addr:         addr,
			Handler:      mux,
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 35 * time.Second, // Must exceed rpcCallTimeout (30s)
		},
		addr: addr,
	}
}

// Addr returns the server's listen address.
func (s *Server) Addr() string {
	return s.addr
}

// Start begins listening and serving.
func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	s.addr = ln.Addr().String()
	slog.Info("REST server listening", "addr", s.addr)
	return s.httpServer.Serve(ln)
}

// Stop gracefully shuts down the server.
func (s *Server) Stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.httpServer.Shutdown(ctx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
}
