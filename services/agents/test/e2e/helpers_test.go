package e2e_test

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	agentsv1 "github.com/dokipen/claude-cadence/services/agents/gen/agents/v1"
	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/server"
	"github.com/dokipen/claude-cadence/services/agents/internal/service"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
	"github.com/dokipen/claude-cadence/services/agents/internal/tmux"
	"github.com/dokipen/claude-cadence/services/agents/internal/ttyd"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var serverAddr string

func TestMain(m *testing.M) {
	// Load test config
	cfg, err := config.Load("testdata/config.yaml")
	if err != nil {
		log.Fatalf("loading test config: %v", err)
	}

	// Create components
	tmuxClient := tmux.NewClient(cfg.Tmux.SocketName)
	ttydClient := ttyd.NewClient(cfg.Ttyd.Enabled, cfg.Ttyd.BasePort)
	store := session.NewStore()
	mgr := session.NewManager(store, tmuxClient, ttydClient, nil, nil, cfg.Profiles)
	svc := service.NewAgentService(mgr)

	// Create a minimal config for test server
	testCfg := &config.Config{
		Host:       "127.0.0.1",
		Port:       0,
		Reflection: true, // tests use reflection
		Auth:       config.AuthConfig{Mode: "none"},
	}

	// Start server on random port
	srv, err := server.New(svc, testCfg)
	if err != nil {
		log.Fatalf("creating server: %v", err)
	}

	go func() {
		if err := srv.Start(); err != nil {
			log.Printf("server stopped: %v", err)
		}
	}()

	serverAddr = srv.Addr()

	// Run tests
	code := m.Run()

	// Cleanup
	srv.Stop()
	cleanupAllTestSessions(cfg.Tmux.SocketName)

	os.Exit(code)
}

func newTestClient(t *testing.T) agentsv1.AgentServiceClient {
	t.Helper()
	conn, err := grpc.NewClient(serverAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("connecting to server: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return agentsv1.NewAgentServiceClient(conn)
}

func uniqueSessionName(t *testing.T) string {
	t.Helper()
	// Use test name (sanitized) + nanos for uniqueness
	name := strings.ReplaceAll(t.Name(), "/", "-")
	name = strings.ReplaceAll(name, " ", "-")
	// Keep only tmux-safe chars
	safe := ""
	for _, c := range name {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' {
			safe += string(c)
		}
	}
	return fmt.Sprintf("e2e-%s-%d", safe, time.Now().UnixNano())
}

func tmuxSessionExists(socketName, sessionName string) bool {
	cmd := exec.Command("tmux", "-L", socketName, "has-session", "-t", sessionName)
	return cmd.Run() == nil
}

func cleanupAllTestSessions(socketName string) {
	out, err := exec.Command("tmux", "-L", socketName, "list-sessions", "-F", "#{session_name}").Output()
	if err != nil {
		return // no sessions
	}
	for _, name := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if strings.HasPrefix(name, "e2e-") {
			exec.Command("tmux", "-L", socketName, "kill-session", "-t", name).Run()
		}
	}
}
