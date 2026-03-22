package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/git"
	"github.com/dokipen/claude-cadence/services/agents/internal/hub"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/server"
	"github.com/dokipen/claude-cadence/services/agents/internal/service"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
	"github.com/dokipen/claude-cadence/services/agents/internal/vault"
	"github.com/dokipen/claude-cadence/services/agents/internal/wsauth"
)

func main() {
	configPath := flag.String("config", "", "path to config file")
	flag.Parse()

	// Fall back to env var.
	if *configPath == "" {
		*configPath = os.Getenv("AGENTD_CONFIG")
	}
	if *configPath == "" {
		slog.Error("config path required: use --config flag or AGENTD_CONFIG env var")
		os.Exit(1)
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Set up structured logging.
	var logLevel slog.Level
	switch cfg.Log.Level {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}

	var handler slog.Handler
	opts := &slog.HandlerOptions{Level: logLevel}
	if cfg.Log.Format == "text" {
		handler = slog.NewTextHandler(os.Stderr, opts)
	} else {
		handler = slog.NewJSONHandler(os.Stderr, opts)
	}
	slog.SetDefault(slog.New(handler))

	// Warn about deprecated config fields.
	cfg.LogDeprecations(slog.Default())

	// Create components.
	ptyManager := pty.NewPTYManager(pty.PTYConfig{BufferSize: cfg.PTY.BufferSize})
	store := session.NewStore()
	var gitClient *git.Client
	if cfg.RootDir != "" {
		gitClient = git.NewClient(cfg.RootDir)
	}
	var vaultClient *vault.Client
	if cfg.Vault != nil {
		vc, err := vault.NewClient(cfg.Vault)
		if err != nil {
			slog.Error("failed to create vault client", "error", err)
			os.Exit(1)
		}
		vaultClient = vc
	}
	manager := session.NewManager(store, ptyManager, gitClient, vaultClient, cfg.Profiles)

	// Start background stale session cleaner.
	cleaner := session.NewCleaner(manager, cfg.Cleanup.StaleSessionTTL, cfg.Cleanup.ReapInterval)
	cleaner.Start()

	// Start background idle input monitor.
	monitor := session.NewMonitor(manager, ptyManager, 5*time.Second)
	monitor.Start()

	agentService := service.NewAgentService(manager)

	srv, err := server.New(agentService, cfg)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}

	// Register WebSocket terminal handler.
	var expectedToken string
	if cfg.Auth.Mode == "token" {
		expectedToken = cfg.Auth.ResolveToken()
		if expectedToken == "" {
			slog.Error("auth.mode is \"token\" but no token is configured; set auth.token or auth.token_env_var")
			os.Exit(1)
		}
	}
	mux := http.NewServeMux()
	mux.Handle("/ws/terminal/", wsauth.TokenAuth(expectedToken, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Strip prefix and validate the session ID is a bare UUID with no
		// path components, preventing path traversal.
		sessionID := strings.TrimPrefix(r.URL.Path, "/ws/terminal/")
		if sessionID == "" || strings.ContainsAny(sessionID, "/?#") {
			http.Error(w, "missing or invalid session ID", http.StatusBadRequest)
			return
		}
		// agentd sits behind the issues-ui reverse proxy; allow all origins.
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: []string{"*"},
		})
		if err != nil {
			slog.Warn("websocket accept failed", "error", err)
			return
		}
		if err := ptyManager.ServeTerminal(r.Context(), sessionID, conn); err != nil {
			slog.Warn("terminal session ended with error", "session_id", sessionID, "error", err)
		}
	})))

	// Start hub client if configured.
	var hubClient *hub.Client
	if cfg.Hub != nil {
		dispatcher := hub.NewDispatcher(manager, cfg.Ttyd.AdvertiseAddress, cfg.PTY.WebSocketScheme)
		hubClient = hub.NewClient(*cfg.Hub, cfg.Profiles, cfg.Ttyd, dispatcher)
		hubClient.Start()
		slog.Info("hub client started", "url", cfg.Hub.URL, "name", cfg.Hub.Name)
	}

	// Start server in goroutine.
	errCh := make(chan error, 1)
	go func() {
		slog.Info("starting agentd", "addr", srv.Addr())
		errCh <- srv.Start()
	}()

	// Start HTTP server for WebSocket terminal handler.
	if cfg.Ttyd.AdvertiseAddress != "" {
		go func() {
			slog.Info("starting HTTP terminal server", "addr", cfg.Ttyd.AdvertiseAddress)
			if httpErr := http.ListenAndServe(cfg.Ttyd.AdvertiseAddress, mux); httpErr != nil {
				slog.Warn("HTTP terminal server stopped", "error", httpErr)
			}
		}()
	}

	// Wait for signal or server error.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	select {
	case sig := <-sigCh:
		slog.Info("received signal, shutting down", "signal", sig)
	case err := <-errCh:
		slog.Error("server error, shutting down", "error", err)
	}

	if hubClient != nil {
		hubClient.Stop()
	}
	monitor.Stop()
	cleaner.Stop()
	srv.Stop()
	slog.Info("agentd stopped")
}
