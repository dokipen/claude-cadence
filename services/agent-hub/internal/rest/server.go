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

	// REST API endpoints — protected by API token auth, with body-read deadline.
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/v1/agents", handleListAgents(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}", handleGetAgent(h))
	apiMux.HandleFunc("GET /api/v1/sessions", handleListAllSessions(h, listAllSessionsDeadline))
	apiMux.HandleFunc("GET /api/v1/diagnostics", handleGetDiagnostics(h, cfg.Log.Path, listAllSessionsDeadline))
	apiMux.HandleFunc("POST /api/v1/agents/{name}/sessions", handleCreateSession(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}/sessions", handleListSessions(h))
	apiMux.HandleFunc("GET /api/v1/agents/{name}/sessions/{id}", handleGetSession(h))
	apiMux.HandleFunc("DELETE /api/v1/agents/{name}/sessions/{id}", handleDestroySession(h))

	var apiHandler http.Handler = apiMux
	if cfg.Auth.Mode == "token" {
		apiToken := cfg.Auth.ResolveToken()
		apiHandler = tokenAuth(apiToken)(apiMux)
	}
	apiHandler = maxBodyMiddleware(apiHandler)
	apiHandler = bodyReadDeadlineMiddleware(BodyReadTimeout)(apiHandler)
	apiHandler = rateLimiter(cfg.RateLimit)(apiHandler)
	apiHandler = metricsMiddleware(apiHandler)
	mux.Handle("/api/v1/", apiHandler)

	// Terminal WebSocket — rate limited and auth-protected, but no body-read
	// deadline: setting a connection-level read deadline would kill live sessions.
	var terminalHandler http.Handler = http.HandlerFunc(proxy.HandleTerminalProxy(h, cfg.AllowedOrigins, cfg.Terminal.IdleTimeout, cfg.Terminal.ResolveToken()))
	if cfg.Auth.Mode == "token" {
		apiToken := cfg.Auth.ResolveToken()
		terminalHandler = tokenAuth(apiToken)(terminalHandler)
	}
	terminalHandler = rateLimiter(cfg.RateLimit)(terminalHandler)
	terminalHandler = metricsMiddleware(terminalHandler)
	mux.Handle("GET /ws/terminal/{agent_name}/{session_id}", terminalHandler)

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
			// ReadTimeout is intentionally not set. Go's ReadTimeout applies to
			// the full net.Conn lifetime: setting it would kill long-lived
			// WebSocket connections (agent WS, terminal WS) once the timeout
			// fires. The same protection is achieved per-request for REST
			// endpoints via bodyReadDeadlineMiddleware (30 s), and the
			// ReadHeaderTimeout (10 s) covers the pre-body window.
			WriteTimeout: 35 * time.Second, // Must exceed rpcCallTimeout (30s)
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
