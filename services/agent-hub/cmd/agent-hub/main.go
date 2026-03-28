package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dokipen/claude-cadence/services/agent-hub/internal/config"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/metrics"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/rest"
)

func main() {
	configPath := flag.String("config", "", "path to config file")
	flag.Parse()

	if *configPath == "" {
		*configPath = os.Getenv("AGENT_HUB_CONFIG")
	}
	if *configPath == "" {
		slog.Error("config path required: use --config flag or AGENT_HUB_CONFIG env var")
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

	if len(cfg.AllowedOrigins) == 0 && cfg.Auth.Mode == "token" {
		slog.Warn("allowed_origins is not configured; terminal WebSocket accepts connections from any origin")
	}

	// Create hub.
	h := hub.New(cfg.Heartbeat.Interval, cfg.Heartbeat.Timeout, cfg.Heartbeat.KeepaliveInterval, cfg.AgentTTL, cfg.Terminal.MaxSessions)
	h.Start()

	// Create and start REST server.
	srv := rest.New(h, cfg)

	// Background goroutine to snapshot gauge metrics periodically.
	metricsCtx, metricsCancel := context.WithCancel(context.Background())
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-metricsCtx.Done():
				return
			case <-ticker.C:
				metrics.Snapshot(h.AgentCount(), h.OnlineAgentCount(), h.TerminalSessionCount())
			}
		}
	}()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("starting agent-hub", "addr", srv.Addr())
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

	// Stop accepting new connections first, then drain the hub.
	metricsCancel()
	srv.Stop()
	h.Stop()
	slog.Info("agent-hub stopped")
}
