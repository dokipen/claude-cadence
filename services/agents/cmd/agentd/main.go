package main

import (
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/git"
	"github.com/dokipen/claude-cadence/services/agents/internal/server"
	"github.com/dokipen/claude-cadence/services/agents/internal/service"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
	"github.com/dokipen/claude-cadence/services/agents/internal/tmux"
	"github.com/dokipen/claude-cadence/services/agents/internal/ttyd"
	"github.com/dokipen/claude-cadence/services/agents/internal/vault"
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

	// Create components.
	tmuxClient := tmux.NewClient(cfg.Tmux.SocketName)
	ttydClient := ttyd.NewClient(cfg.Ttyd.Enabled, cfg.Ttyd.BasePort)
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
	manager := session.NewManager(store, tmuxClient, ttydClient, gitClient, vaultClient, cfg.Profiles)

	// Recover any orphaned tmux sessions from a previous run.
	recovered, err := manager.RecoverSessions()
	if err != nil {
		slog.Warn("session recovery failed", "error", err)
	} else if recovered > 0 {
		slog.Info("recovered sessions from tmux", "count", recovered)
	}

	// Start background stale session cleaner.
	cleaner := session.NewCleaner(manager, cfg.Cleanup.StaleSessionTTL, cfg.Cleanup.CheckInterval)
	cleaner.Start()

	agentService := service.NewAgentService(manager)

	srv, err := server.New(agentService, cfg)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}

	// Start server in goroutine.
	errCh := make(chan error, 1)
	go func() {
		slog.Info("starting agentd", "addr", srv.Addr())
		errCh <- srv.Start()
	}()

	// Wait for signal or server error.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	select {
	case sig := <-sigCh:
		slog.Info("received signal, shutting down", "signal", sig)
	case err := <-errCh:
		slog.Error("server error, shutting down", "error", err)
	}

	cleaner.Stop()
	srv.Stop()
	slog.Info("agentd stopped")
}
