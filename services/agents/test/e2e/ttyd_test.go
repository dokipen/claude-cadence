package e2e_test

import (
	"context"
	"net/http"
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

// ttydTestEnv creates a separate server with ttyd enabled for ttyd-specific tests.
type ttydTestEnv struct {
	addr       string
	cleanup    func()
	socketName string
}

func newTtydTestEnv(t *testing.T) *ttydTestEnv {
	t.Helper()

	socketName := "agentd-ttyd-test"
	tmuxClient := tmux.NewClient(socketName)
	ttydClient := ttyd.NewClient(true, 17681)
	store := session.NewStore()
	profiles := map[string]config.Profile{
		"sleeper": {Command: "sleep 3600"},
	}

	mgr := session.NewManager(store, tmuxClient, ttydClient, profiles)
	svc := service.NewAgentService(mgr)

	srv, err := server.New(svc, "127.0.0.1", 0)
	if err != nil {
		t.Fatalf("creating ttyd test server: %v", err)
	}

	go func() {
		if err := srv.Start(); err != nil {
			t.Logf("ttyd test server stopped: %v", err)
		}
	}()

	return &ttydTestEnv{
		addr:       srv.Addr(),
		socketName: socketName,
		cleanup: func() {
			srv.Stop()
			cleanupAllTestSessions(socketName)
		},
	}
}

func (e *ttydTestEnv) client(t *testing.T) agentsv1.AgentServiceClient {
	t.Helper()
	conn, err := grpc.NewClient(e.addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("connecting to ttyd test server: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return agentsv1.NewAgentServiceClient(conn)
}

func TestTtyd_Disabled(t *testing.T) {
	// Use the default test server (ttyd disabled).
	client := newTestClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	sess := resp.GetSession()
	if sess.GetState() != agentsv1.SessionState_SESSION_STATE_RUNNING {
		t.Errorf("expected RUNNING, got %v", sess.GetState())
	}
	if sess.GetWebsocketUrl() != "" {
		t.Errorf("expected empty websocket_url when ttyd disabled, got %q", sess.GetWebsocketUrl())
	}
}

func TestTtyd_StartsWithSession(t *testing.T) {
	if !ttydAvailable() {
		t.Skip("ttyd not installed")
	}

	env := newTtydTestEnv(t)
	t.Cleanup(env.cleanup)

	client := env.client(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	sess := resp.GetSession()
	if sess.GetWebsocketUrl() == "" {
		t.Fatal("expected non-empty websocket_url when ttyd enabled")
	}
}

func TestTtyd_HttpResponds(t *testing.T) {
	if !ttydAvailable() {
		t.Skip("ttyd not installed")
	}

	env := newTtydTestEnv(t)
	t.Cleanup(env.cleanup)

	client := env.client(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	sessionID := resp.GetSession().GetId()

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: sessionID,
			Force:     true,
		})
	})

	wsURL := resp.GetSession().GetWebsocketUrl()
	if wsURL == "" {
		t.Fatal("expected non-empty websocket_url")
	}

	// Convert ws:// to http:// for HTTP check.
	httpURL := strings.Replace(wsURL, "ws://", "http://", 1)

	// Poll until ttyd HTTP endpoint responds (it takes a moment to start).
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(httpURL)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return // success
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Errorf("ttyd HTTP endpoint %s did not respond within 5s", httpURL)
}

func TestTtyd_StopsOnDestroy(t *testing.T) {
	if !ttydAvailable() {
		t.Skip("ttyd not installed")
	}

	env := newTtydTestEnv(t)
	t.Cleanup(env.cleanup)

	client := env.client(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	sessionID := resp.GetSession().GetId()
	wsURL := resp.GetSession().GetWebsocketUrl()
	if wsURL == "" {
		t.Fatal("expected non-empty websocket_url")
	}

	httpURL := strings.Replace(wsURL, "ws://", "http://", 1)

	// Wait for ttyd to be ready.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		r, err := http.Get(httpURL)
		if err == nil {
			r.Body.Close()
			if r.StatusCode == http.StatusOK {
				break
			}
		}
		time.Sleep(250 * time.Millisecond)
	}

	// Destroy the session.
	_, err = client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
		SessionId: sessionID,
		Force:     true,
	})
	if err != nil {
		t.Fatalf("DestroySession: %v", err)
	}

	// Verify ttyd is no longer responding.
	time.Sleep(500 * time.Millisecond)
	_, err = http.Get(httpURL)
	if err == nil {
		t.Error("expected ttyd HTTP endpoint to be down after destroy")
	}
}

func TestTtyd_UniquePort(t *testing.T) {
	if !ttydAvailable() {
		t.Skip("ttyd not installed")
	}

	env := newTtydTestEnv(t)
	t.Cleanup(env.cleanup)

	client := env.client(t)
	ctx := context.Background()
	name1 := uniqueSessionName(t)
	name2 := uniqueSessionName(t)

	resp1, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name1,
	})
	if err != nil {
		t.Fatalf("CreateSession 1: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp1.GetSession().GetId(),
			Force:     true,
		})
	})

	resp2, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name2,
	})
	if err != nil {
		t.Fatalf("CreateSession 2: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp2.GetSession().GetId(),
			Force:     true,
		})
	})

	url1 := resp1.GetSession().GetWebsocketUrl()
	url2 := resp2.GetSession().GetWebsocketUrl()

	if url1 == "" || url2 == "" {
		t.Fatalf("expected non-empty websocket URLs, got %q and %q", url1, url2)
	}
	if url1 == url2 {
		t.Errorf("expected unique websocket URLs, both are %q", url1)
	}

	t.Logf("Session 1 URL: %s", url1)
	t.Logf("Session 2 URL: %s", url2)
}

func ttydAvailable() bool {
	path, err := exec.LookPath("ttyd")
	return err == nil && path != ""
}
