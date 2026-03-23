package rest_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
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

	h := hub.New(cfg.Heartbeat.Interval, cfg.Heartbeat.Timeout, cfg.AgentTTL, 0)
	h.Start()
	t.Cleanup(h.Stop)

	srv := rest.New(h, cfg)
	go srv.Start()
	t.Cleanup(srv.Stop)

	// Wait for the server to be ready by trying to connect.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		addr := srv.Addr()
		if addr != "127.0.0.1:0" && addr != "" {
			conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
			if err == nil {
				conn.Close()
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
			"default": {Description: "test profile", Repo: "https://github.com/test/repo"},
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

	// Verify profile repo field is exposed in the REST response.
	profiles, ok := agentInfo["profiles"].(map[string]any)
	if !ok {
		t.Fatal("expected profiles map in agent response")
	}
	defaultProfile, ok := profiles["default"].(map[string]any)
	if !ok {
		t.Fatal("expected default profile in profiles map")
	}
	if defaultProfile["repo"] != "https://github.com/test/repo" {
		t.Errorf("expected repo https://github.com/test/repo, got %v", defaultProfile["repo"])
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

	// Metrics endpoint should require auth.
	resp, err := http.Get(baseURL + "/debug/vars")
	if err != nil {
		t.Fatalf("metrics request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 without auth, got %d", resp.StatusCode)
	}

	// With auth, should return metrics.
	req, _ := http.NewRequest("GET", baseURL+"/debug/vars", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err = http.DefaultClient.Do(req)
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

	// Don't use startIntegrationServer to avoid double-stop via t.Cleanup.
	h := hub.New(cfg.Heartbeat.Interval, cfg.Heartbeat.Timeout, cfg.AgentTTL, 0)
	h.Start()

	srv := rest.New(h, cfg)
	go srv.Start()

	// Wait for server readiness.
	deadline := time.Now().Add(2 * time.Second)
	var baseURL string
	for time.Now().Before(deadline) {
		addr := srv.Addr()
		if addr != "127.0.0.1:0" && addr != "" {
			conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
			if err == nil {
				conn.Close()
				baseURL = "http://" + addr
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if baseURL == "" {
		t.Fatal("server did not start in time")
	}

	simulateAgent(t, baseURL, agentToken, "shutdown-agent")
	waitForAgent(t, h, "shutdown-agent")

	if h.AgentCount() != 1 {
		t.Fatalf("expected 1 agent, got %d", h.AgentCount())
	}

	// Stop (simulating SIGTERM) — HTTP first, then hub.
	srv.Stop()
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

func TestIntegration_RejectLoopbackAdvertiseAddress(t *testing.T) {
	apiToken := "api-tok"
	agentToken := "agent-tok"
	cfg := testConfig(apiToken, agentToken)

	_, baseURL := startIntegrationServer(t, cfg)

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
	defer conn.Close(websocket.StatusNormalClosure, "test done")

	// Send a register message with a loopback advertise address.
	regReq, _ := hub.NewRequest("reg-bad", "register", &hub.RegisterParams{
		Name: "bad-agent",
		Ttyd: hub.TtydInfo{AdvertiseAddress: "127.0.0.1", BasePort: 7681},
	})
	data, _ := json.Marshal(regReq)
	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("write register: %v", err)
	}

	// The hub should close the connection — any read must return an error.
	_, _, readErr := conn.Read(ctx)
	if readErr == nil {
		t.Fatal("expected connection to be closed after loopback address rejection, but read succeeded")
	}

	// Verify the agent did NOT end up in the hub's agent list.
	req, _ := http.NewRequest("GET", baseURL+"/api/v1/agents", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("list agents: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from /agents, got %d", resp.StatusCode)
	}

	var body map[string][]json.RawMessage
	json.NewDecoder(resp.Body).Decode(&body)
	if len(body["agents"]) != 0 {
		t.Fatalf("expected 0 agents after loopback rejection, got %d", len(body["agents"]))
	}
}

// simulateAgentWithDelay connects a simulated agentd that adds a controlled
// delay to listSessions responses. It increments/decrements the provided
// atomic counter to track concurrency, recording the observed peak in peak.
func simulateAgentWithDelay(t *testing.T, baseURL, agentToken, name string, inflight *int64, peak *int64, delay time.Duration) {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/ws/agent"
	ctx := context.Background()

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Authorization": {"Bearer " + agentToken},
		},
	})
	if err != nil {
		t.Errorf("dial hub (%s): %v", name, err)
		return
	}
	t.Cleanup(func() { conn.Close(websocket.StatusNormalClosure, "test done") })

	// Send register message.
	regReq, _ := hub.NewRequest("reg-1", "register", &hub.RegisterParams{
		Name: name,
		Profiles: map[string]hub.ProfileInfo{
			"default": {Description: "test profile", Repo: "https://github.com/test/repo"},
		},
	})
	data, _ := json.Marshal(regReq)
	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		t.Errorf("write register (%s): %v", name, err)
		return
	}

	// Read register ack.
	if _, _, err = conn.Read(ctx); err != nil {
		t.Errorf("read register ack (%s): %v", name, err)
		return
	}

	// Echo loop with delay for listSessions.
	go func() {
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var req hub.Request
			json.Unmarshal(data, &req)

			var resp *hub.Response
			if req.Method == "listSessions" {
				// Track concurrency.
				cur := atomic.AddInt64(inflight, 1)
				// Record peak using a CAS loop.
				for {
					old := atomic.LoadInt64(peak)
					if cur <= old {
						break
					}
					if atomic.CompareAndSwapInt64(peak, old, cur) {
						break
					}
				}
				time.Sleep(delay)
				atomic.AddInt64(inflight, -1)
				// Return a well-formed sessions response so the handler appends this agent.
				resp, _ = hub.NewResponse(req.ID, map[string]any{"sessions": []any{}})
			} else if req.Method == "ping" {
				resp, _ = hub.NewResponse(req.ID, map[string]bool{"pong": true})
			} else {
				resp, _ = hub.NewResponse(req.ID, map[string]string{"echo": req.Method})
			}
			respData, _ := json.Marshal(resp)
			conn.Write(context.Background(), websocket.MessageText, respData)
		}
	}()
}

func TestIntegration_ListAllSessionsConcurrencyCap(t *testing.T) {
	const numAgents = 24
	maxFanOut := rest.MaxAgentFanOut

	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)

	h, baseURL := startIntegrationServer(t, cfg)

	var inflight, peak int64

	for i := 0; i < numAgents; i++ {
		name := fmt.Sprintf("fanout-agent-%d", i)
		simulateAgentWithDelay(t, baseURL, agentToken, name, &inflight, &peak, 150*time.Millisecond)
		waitForAgent(t, h, name)
	}

	req, _ := http.NewRequest("GET", baseURL+"/api/v1/sessions", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("list all sessions: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Agents []json.RawMessage `json:"agents"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	// All agents should have responded (none timed out with a 150ms delay and 5s timeout).
	if len(result.Agents) != numAgents {
		t.Errorf("expected sessions from all %d agents, got %d", numAgents, len(result.Agents))
	}

	// Peak in-flight RPCs must never have exceeded the semaphore cap.
	if peak > int64(maxFanOut) {
		t.Errorf("peak concurrent listSessions RPCs = %d, want <= %d", peak, maxFanOut)
	}
}

func TestIntegration_RateLimiting_WSAgent(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)
	// Very low rate limit so burst is exhausted quickly.
	cfg.RateLimit.RequestsPerSecond = 1
	cfg.RateLimit.Burst = 2

	_, baseURL := startIntegrationServer(t, cfg)

	// Brief pause so token-bucket refills to its initial burst capacity after
	// any internal server setup requests (none fire against rate-limited paths,
	// but the pause keeps the timing consistent with other rate limit tests).
	time.Sleep(100 * time.Millisecond)

	// Send 20 rapid HTTP requests to /ws/agent with WebSocket upgrade headers.
	// With Burst=2, the token bucket allows 2 requests before returning 429;
	// the 3rd request and beyond should be rejected. We fire 20 to be safe.
	// The rate limiter fires before any WebSocket upgrade occurs.
	client := &http.Client{
		// Do not follow redirects; we want the raw status code.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	var rateLimited bool
	for i := 0; i < 20; i++ {
		req, _ := http.NewRequest("GET", baseURL+"/ws/agent", nil)
		req.Header.Set("Authorization", "Bearer "+agentToken)
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		req.Header.Set("Sec-WebSocket-Version", "13")

		resp, err := client.Do(req)
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
		t.Error("expected /ws/agent to be rate limited after burst exhausted, but no 429 was returned")
	}
}

func TestIntegration_RateLimiting_WSTerminal(t *testing.T) {
	apiToken := "test-api-token"
	agentToken := "test-agent-token"
	cfg := testConfig(apiToken, agentToken)
	// Very low rate limit so burst is exhausted quickly.
	cfg.RateLimit.RequestsPerSecond = 1
	cfg.RateLimit.Burst = 2

	_, baseURL := startIntegrationServer(t, cfg)

	// Brief pause for token-bucket consistency (mirrors WSAgent test above).
	time.Sleep(100 * time.Millisecond)

	// Send 20 rapid HTTP requests to /ws/terminal/<session-id> with WebSocket
	// upgrade headers. /ws/terminal/ routes through apiHandler which wraps
	// rateLimiter, so the rate limiter fires before any WebSocket upgrade.
	// With Burst=2, the 3rd request should return 429.
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	var rateLimited bool
	for i := 0; i < 20; i++ {
		req, _ := http.NewRequest("GET", baseURL+"/ws/terminal/test-agent/session-id", nil)
		req.Header.Set("Authorization", "Bearer "+apiToken)
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		req.Header.Set("Sec-WebSocket-Version", "13")

		resp, err := client.Do(req)
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
		t.Error("expected /ws/terminal/ to be rate limited after burst exhausted, but no 429 was returned")
	}
}
