package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/config"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
)

func TestTokenAuth(t *testing.T) {
	const validToken = "test-secret-token"

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	middleware := tokenAuth(validToken)(nextHandler)

	tests := []struct {
		name       string
		authHeader string
		wantStatus int
	}{
		{
			name:       "missing authorization header",
			authHeader: "",
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "invalid format no bearer prefix",
			authHeader: "Token " + validToken,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "wrong token",
			authHeader: "Bearer wrong-token",
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "lowercase bearer prefix",
			authHeader: "bearer " + validToken,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "valid token",
			authHeader: "Bearer " + validToken,
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/agents", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}

			rec := httptest.NewRecorder()
			middleware.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
		})
	}
}

func TestHandleListAgents(t *testing.T) {
	// Use a real hub with WebSocket connections to test the handler end-to-end.
	h := hub.New(30*time.Second, 5*time.Second, 5*time.Minute)
	h.Start()
	t.Cleanup(h.Stop)

	handler := handleListAgents(h)

	// Empty hub returns empty agents array.
	t.Run("empty hub", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/agents", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}

		var body struct {
			Agents []json.RawMessage `json:"agents"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if len(body.Agents) != 0 {
			t.Errorf("expected 0 agents, got %d", len(body.Agents))
		}
	})

	// Register an agent with a real WebSocket pair to avoid nil-conn panics on cleanup.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Errorf("accept ws: %v", err)
			return
		}
		if _, err := h.Register("test-agent", conn, &hub.RegisterParams{
			Name:     "test-agent",
			Profiles: map[string]hub.ProfileInfo{"default": {Description: "test", Repo: "https://github.com/test/repo.git"}},
		}); err != nil {
			t.Errorf("Register: %v", err)
			return
		}
		// Keep connection open until test ends.
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)

	// Connect a WebSocket client to trigger registration.
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	wsConn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { wsConn.Close(websocket.StatusNormalClosure, "done") })

	// Wait for registration.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := h.Get("test-agent"); ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Run("with agent", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/agents", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}

		var body struct {
			Agents []hub.AgentInfo `json:"agents"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if len(body.Agents) != 1 {
			t.Fatalf("expected 1 agent, got %d", len(body.Agents))
		}
		if body.Agents[0].Name != "test-agent" {
			t.Errorf("agent name = %q, want test-agent", body.Agents[0].Name)
		}
		if body.Agents[0].Status != hub.StatusOnline {
			t.Errorf("agent status = %q, want online", body.Agents[0].Status)
		}
		profile, ok := body.Agents[0].Profiles["default"]
		if !ok {
			t.Fatal("expected 'default' profile in response")
		}
		if profile.Description != "test" {
			t.Errorf("profile description = %q, want test", profile.Description)
		}
		if profile.Repo != "https://github.com/test/repo.git" {
			t.Errorf("profile repo = %q, want https://github.com/test/repo.git", profile.Repo)
		}
	})
}

// TestRateLimiterEviction verifies that eviction fires when the map reaches
// exactly 1000 entries (>= 1000) and that stale entries (> 5 min old) are
// removed during eviction.
func TestRateLimiterEviction(t *testing.T) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	baseTime := time.Now().Add(-10 * time.Minute)
	currentTime := baseTime
	nowFn := func() time.Time { return currentTime }

	lenFunc, middlewareFn := rateLimiterInternal(cfg, nowFn)

	// Wrap a no-op handler with the rate limiter middleware.
	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	sendRequest := func(ip string) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip + ":1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
	}

	// Step 1: Add 999 distinct IPs with the old (stale) timestamp.
	// All entries get lastSeen = baseTime (10 minutes ago).
	for i := 0; i < 999; i++ {
		sendRequest(fmt.Sprintf("10.0.%d.%d", i/256, i%256))
	}

	if got := lenFunc(); got != 999 {
		t.Fatalf("after 999 IPs: map size = %d, want 999", got)
	}

	// Step 2: Advance the clock to now so new entries are fresh.
	currentTime = time.Now()

	// Step 3: Add the 1000th distinct IP.
	// len(limiters) is 999 before this call; 999 >= 1000 is false → no eviction → insert → len = 1000.
	sendRequest("10.1.0.0")

	if got := lenFunc(); got != 1000 {
		t.Fatalf("after 1000th IP: map size = %d, want 1000", got)
	}

	// Step 4: Add the 1001st distinct IP.
	// len(limiters) is 1000 before this call; 1000 >= 1000 is true → eviction runs.
	// The first 999 entries have lastSeen = baseTime (10 min ago), so they are evicted.
	// Entry 1000 ("10.1.0.0") has lastSeen = currentTime, so it survives.
	// After eviction, the 1001st IP is inserted → map size = 2.
	sendRequest("10.1.0.1")

	if got := lenFunc(); got != 2 {
		t.Fatalf("after eviction triggered by 1001st IP: map size = %d, want 2 (eviction should have removed 999 stale entries)", got)
	}
}

// TestRateLimiterHardCap verifies that the map cannot grow beyond 1000 entries
// even when all entries are permanently fresh (fixed clock, no stale eviction).
// This test is expected to FAIL with the current soft-eviction implementation
// because eviction removes nothing when all entries have a recent lastSeen, so
// the map grows to 1500. The fix requires LRU hard-cap eviction.
func TestRateLimiterHardCap(t *testing.T) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	// Fixed clock: all entries will always be fresh (never stale).
	fixedTime := time.Now()
	nowFn := func() time.Time { return fixedTime }

	lenFunc, middlewareFn := rateLimiterInternal(cfg, nowFn)

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	// Send requests from 1500 distinct IPs.
	for i := 0; i < 1500; i++ {
		ip := fmt.Sprintf("10.%d.%d.1:1234", i/256, i%256)
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
	}

	got := lenFunc()
	if got > 1000 {
		t.Errorf("map size = %d after 1500 distinct fresh IPs; want <= 1000 (hard cap not enforced)", got)
	}
}
