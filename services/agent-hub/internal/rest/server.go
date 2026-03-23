package rest

import (
	"context"
	"expvar"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/dokipen/claude-cadence/services/agent-hub/internal/config"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/proxy"
)

// Server is the HTTP server for the agent-hub REST API.
type Server struct {
	httpServer *http.Server
	addr       atomic.Value // stores string; set in New() and updated in Start() after bind, read by Addr()
}

// New creates a new REST server.
func New(h *hub.Hub, cfg *config.Config) *Server {
	mux := http.NewServeMux()

	// Agent WebSocket endpoint — uses separate agent token auth, protected by rate limiter.
	agentToken := cfg.HubAuth.ResolveToken()
	mux.Handle("GET /ws/agent", rateLimiter(cfg.RateLimit)(http.HandlerFunc(handleAgentWebSocket(h, agentToken))))

	// REST API endpoints — protected by API token auth.
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/v1/agents", handleListAgents(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}", handleGetAgent(h))
	apiMux.HandleFunc("GET /api/v1/sessions", handleListAllSessions(h, listAllSessionsDeadline))
	apiMux.HandleFunc("POST /api/v1/agents/{name}/sessions", handleCreateSession(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}/sessions", handleListSessions(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}/sessions/{id}", handleGetSession(h))
	apiMux.HandleFunc("DELETE /api/v1/agents/{name}/sessions/{id}", handleDestroySession(h))
	apiMux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", proxy.HandleTerminalProxy(h, cfg.AllowedOrigins, cfg.Terminal.IdleTimeout))

	var apiHandler http.Handler = apiMux
	if cfg.Auth.Mode == "token" {
		apiToken := cfg.Auth.ResolveToken()
		apiHandler = tokenAuth(apiToken)(apiMux)
	}
	apiHandler = rateLimiter(cfg.RateLimit)(apiHandler)
	apiHandler = metricsMiddleware(apiHandler)
	mux.Handle("/api/v1/", apiHandler)
	mux.Handle("/ws/terminal/", apiHandler)

	// Metrics endpoint — protected by API token auth when auth is enabled.
	var metricsHandler http.Handler = expvar.Handler()
	if cfg.Auth.Mode == "token" {
		apiToken := cfg.Auth.ResolveToken()
		metricsHandler = tokenAuth(apiToken)(metricsHandler)
	}
	mux.Handle("GET /debug/vars", metricsHandler)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	s := &Server{
		httpServer: &http.Server{
			Addr:         addr,
			Handler:      mux,
			ReadHeaderTimeout: 10 * time.Second,
			WriteTimeout:      35 * time.Second, // Must exceed rpcCallTimeout (30s)
		},
	}
	s.addr.Store(addr)
	return s
}

// Addr returns the server's listen address.
func (s *Server) Addr() string {
	if v := s.addr.Load(); v != nil {
		return v.(string)
	}
	return ""
}

// Start begins listening and serving.
func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.Addr())
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	addr := ln.Addr().String()
	s.addr.Store(addr)
	slog.Info("REST server listening", "addr", addr)
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
