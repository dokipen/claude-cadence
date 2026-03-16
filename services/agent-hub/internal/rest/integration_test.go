package rest_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/config"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/rest"
)

// testConfig returns a minimal config for integration tests.
func testConfig(apiToken, agentToken string) *config.Config {
	return &config.Config{
		Host: "127.0.0.1",
		Port: 0, // OS-assigned
		Auth: config.AuthConfig{
			Mode:  "token",
			Token: apiToken,
		},
		HubAuth: config.HubAuthConfig{
			Token: agentToken,
		},
		Heartbeat: config.HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  5 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
		RateLimit: config.RateLimitConfig{
			RequestsPerSecond: 100,
			Burst:             200,
		},
	}
}

// startIntegrationServer creates a hub, REST server, starts them, and returns
// the hub, base URL, and cleanup function.
func startIntegrationServer(t *testing.T, cfg *config.Config) (*hub.Hub, string) {
	t.Helper()

	h := hub.New(cfg.Heartbeat.Interval, cfg.Heartbeat.Timeout, cfg.AgentTTL)
	h.Start()
	t.Cleanup(h.Stop)

	srv := rest.New(h, cfg)
	go srv.Start()
	t.Cleanup(srv.Stop)

	// Wait for the server to be ready.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		addr := srv.Addr()
		if addr != "127.0.0.1:0" && addr != "" {
			resp, err := http.Get("http://" + addr + "/debug/vars")
			if err == nil {
				resp.Body.Close()
				return h, "http://" + addr
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("server did not start in time")
	return nil, ""
}

// simulateAgent connects a simulated agentd to the hub via WebSocket.
// It registers, then runs a read loop that echoes responses for all methods.
func simulateAgent(t *testing.T, baseURL, agentToken, name string) {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/ws/agent"
	ctx := context.Background()

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Authorization": {"Bearer " + agentToken},
		},
	})
	if err != nil {
		t.Fatalf("dial hub: %v", err)
	}
	t.Cleanup(func() { conn.Close(websocket.StatusNormalClosure, "test done") })

	// Send register message.
	regReq, _ := hub.NewRequest("reg-1", "register", &hub.RegisterParams{
		Name: name,
		Profiles: map[string]hub.ProfileInfo{
			"default": {Description: "test profile"},
		},
	})
	data, _ := json.Marshal(regReq)
	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("write register: %v", err)
	}

	// Read register ack.
	_, _, err = conn.Read(ctx)
	if err != nil {
		t.Fatalf("read register ack: %v", err)
	}

	// Echo loop: respond to hub requests.
	go func() {
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var req hub.Request
			json.Unmarshal(data, &req)

			var resp *hub.Response
			if req.Method == "ping" {
				resp, _ = hub.NewResponse(req.ID, map[string]bool{"pong": true})
			} else {
				// Echo the method name back as the result.
				resp, _ = hub.NewResponse(req.ID, map[string]string{"echo": req.Method})
			}
			respData, _ := json.Marshal(resp)
			conn.Write(context.Background(), websocket.MessageText, respData)
		}
	}()
}

// waitForAgent polls until the named agent appears in the hub.
func waitForAgent(t *testing.T, h *hub.Hub, name string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := h.Get(name); ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("agent %q did not register in time", name)
}

func TestIntegration_AgentRegistrationAndRPC(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)

	h, baseURL := startIntegrationServer(t, cfg)
	simulateAgent(t, baseURL, agentToken, "test-agent")
	waitForAgent(t, h, "test-agent")

	// List agents via REST API.
	req, _ := http.NewRequest("GET", baseURL+"/api/v1/agents", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("list agents: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string][]json.RawMessage
	json.NewDecoder(resp.Body).Decode(&body)
	if len(body["agents"]) != 1 {
		t.Fatalf("expected 1 agent, got %d", len(body["agents"]))
	}

	// Get agent details.
	req, _ = http.NewRequest("GET", baseURL+"/api/v1/agents/test-agent", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var agentInfo map[string]any
	json.NewDecoder(resp.Body).Decode(&agentInfo)
	if agentInfo["name"] != "test-agent" {
		t.Errorf("expected name test-agent, got %v", agentInfo["name"])
	}
	if agentInfo["status"] != "online" {
		t.Errorf("expected status online, got %v", agentInfo["status"])
	}
}

func TestIntegration_RPCCallViaREST(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)

	h, baseURL := startIntegrationServer(t, cfg)
	simulateAgent(t, baseURL, agentToken, "test-agent")
	waitForAgent(t, h, "test-agent")

	// Call listSessions via REST — should get echoed response from simulated agent.
	req, _ := http.NewRequest("GET", baseURL+"/api/v1/agents/test-agent/sessions", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	if result["echo"] != "listSessions" {
		t.Errorf("expected echo=listSessions, got %v", result)
	}
}

func TestIntegration_AuthRequired(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)

	_, baseURL := startIntegrationServer(t, cfg)

	// Request without token should be rejected.
	resp, err := http.Get(baseURL + "/api/v1/agents")
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}

	// Request with wrong token should be rejected.
	req, _ := http.NewRequest("GET", baseURL+"/api/v1/agents", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestIntegration_AgentNotFound(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)

	_, baseURL := startIntegrationServer(t, cfg)

	req, _ := http.NewRequest("GET", baseURL+"/api/v1/agents/nonexistent", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestIntegration_RateLimiting(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)
	// Very low rate limit for testing.
	cfg.RateLimit.RequestsPerSecond = 1
	cfg.RateLimit.Burst = 3

	_, baseURL := startIntegrationServer(t, cfg)

	// Wait a moment for the startup probe requests to clear.
	time.Sleep(100 * time.Millisecond)

	// Send many rapid requests to exceed the burst limit.
	var rateLimited bool
	for i := 0; i < 20; i++ {
		req, _ := http.NewRequest("GET", baseURL+"/api/v1/agents", nil)
		req.Header.Set("Authorization", "Bearer "+apiToken)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests {
			rateLimited = true
			break
		}
	}

	if !rateLimited {
		t.Error("expected rate limiting to kick in after burst")
	}
}

func TestIntegration_MetricsEndpoint(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)

	_, baseURL := startIntegrationServer(t, cfg)

	// Metrics endpoint should be accessible without auth.
	resp, err := http.Get(baseURL + "/debug/vars")
	if err != nil {
		t.Fatalf("metrics request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var vars map[string]any
	json.NewDecoder(resp.Body).Decode(&vars)

	// Check that our custom metrics exist.
	for _, key := range []string{"connected_agents", "online_agents", "active_terminal_sessions", "requests_total"} {
		if _, ok := vars[key]; !ok {
			t.Errorf("expected metric %q in /debug/vars", key)
		}
	}
}

func TestIntegration_GracefulShutdown(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)

	h, baseURL := startIntegrationServer(t, cfg)
	simulateAgent(t, baseURL, agentToken, "shutdown-agent")
	waitForAgent(t, h, "shutdown-agent")

	// Verify agent is registered.
	if h.AgentCount() != 1 {
		t.Fatalf("expected 1 agent, got %d", h.AgentCount())
	}

	// Stop the hub (simulating shutdown) — agents should be cleaned up.
	h.Stop()

	if h.AgentCount() != 0 {
		t.Errorf("expected 0 agents after stop, got %d", h.AgentCount())
	}
}

func TestIntegration_MultipleAgents(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)

	h, baseURL := startIntegrationServer(t, cfg)

	for i := 0; i < 3; i++ {
		name := fmt.Sprintf("agent-%d", i)
		simulateAgent(t, baseURL, agentToken, name)
		waitForAgent(t, h, name)
	}

	// List all agents.
	req, _ := http.NewRequest("GET", baseURL+"/api/v1/agents", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("list agents: %v", err)
	}
	defer resp.Body.Close()

	var body map[string][]json.RawMessage
	json.NewDecoder(resp.Body).Decode(&body)
	if len(body["agents"]) != 3 {
		t.Fatalf("expected 3 agents, got %d", len(body["agents"]))
	}
}
