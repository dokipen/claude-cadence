package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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

// TestRateLimiterEviction verifies that when the map is at capacity
// (rateLimiterMaxEntries) and a new unique IP arrives, exactly one entry is
// evicted — the least-recently-used unprotected entry — keeping the map at
// the hard cap. Each IP uses a distinct /24 prefix so CIDR bucketing produces
// one map entry per request.
func TestRateLimiterEviction(t *testing.T) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	fixedTime := time.Now()
	nowFn := func() time.Time { return fixedTime }

	lenFunc, _, middlewareFn := rateLimiterInternal(cfg, nowFn)

	// Wrap a no-op handler with the rate limiter middleware.
	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	sendRequest := func(ip string) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip + ":1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
	}

	// Step 1: Fill the map to exactly rateLimiterMaxEntries distinct /24 subnets.
	for i := 0; i < rateLimiterMaxEntries; i++ {
		sendRequest(fmt.Sprintf("10.%d.%d.1", i/256, i%256))
	}

	if got := lenFunc(); got != rateLimiterMaxEntries {
		t.Fatalf("after filling: map size = %d, want %d", got, rateLimiterMaxEntries)
	}

	// Step 2: Send a request from a brand-new /24 subnet.
	// The map is at cap, so exactly one LRU eviction must fire before insert.
	// After the eviction + insert the map must still be exactly at cap.
	sendRequest("20.0.0.1")

	if got := lenFunc(); got != rateLimiterMaxEntries {
		t.Fatalf("after one LRU eviction: map size = %d, want %d (hard cap must be maintained)", got, rateLimiterMaxEntries)
	}

	// Step 3: Send another new /24. Same invariant must hold.
	sendRequest("20.1.0.1")

	if got := lenFunc(); got != rateLimiterMaxEntries {
		t.Fatalf("after second LRU eviction: map size = %d, want %d", got, rateLimiterMaxEntries)
	}
}

// TestRateLimiterHardCap verifies that the map cannot grow beyond
// rateLimiterMaxEntries even when all entries are permanently fresh
// (fixed clock, no stale eviction). Guards against regression to the
// soft-eviction-only behavior where the map would grow without bound.
// Each IP is in a distinct /24 subnet so CIDR bucketing produces one
// entry per IP.
func TestRateLimiterHardCap(t *testing.T) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	// Fixed clock: all entries will always be fresh (never stale).
	fixedTime := time.Now()
	nowFn := func() time.Time { return fixedTime }

	lenFunc, _, middlewareFn := rateLimiterInternal(cfg, nowFn)

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	// Send requests from rateLimiterMaxEntries*2 distinct /24 subnets.
	total := rateLimiterMaxEntries * 2
	for i := 0; i < total; i++ {
		ip := fmt.Sprintf("10.%d.%d.1:1234", i/256, i%256)
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
	}

	got := lenFunc()
	if got != rateLimiterMaxEntries {
		t.Fatalf("map size = %d after %d distinct fresh /24 subnets; want %d (hard cap not enforced)", got, total, rateLimiterMaxEntries)
	}
}

// TestVictimEvictionAttack verifies that an attacker rotating through many
// fresh IPs cannot force the LRU hard-cap eviction to remove a victim IP's
// rate-limiter entry, which would reset its token bucket to a full burst
// and erase all accumulated rate-limit debt.
func TestVictimEvictionAttack(t *testing.T) {
	// Burst=5, RequestsPerSecond=1 — tokens are precious.
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1.0,
		Burst:             5,
	}

	// Two-phase clock: victim is inserted at baseTime (older), attackers at
	// laterTime (newer). This guarantees the victim has the oldest lastSeen
	// and will be chosen by the LRU eviction pass.
	baseTime := time.Now()
	laterTime := baseTime.Add(1 * time.Second)
	currentTime := baseTime
	nowFn := func() time.Time { return currentTime }

	_, _, middlewareFn := rateLimiterInternal(cfg, nowFn)

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	sendRequest := func(ip string) int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip + ":9999"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	const victimIP = "10.0.0.1"

	// Phase 1: drain the victim's full token bucket at baseTime.
	// Burst=5 means 5 requests are allowed; a 6th would be rejected.
	// We exhaust all 5 tokens so the victim has nothing left.
	currentTime = baseTime
	for i := 0; i < 5; i++ {
		if code := sendRequest(victimIP); code != http.StatusOK {
			t.Fatalf("setup: victim request %d/%d got %d, want 200", i+1, 5, code)
		}
	}
	// Confirm the 6th request is already rejected (bucket truly empty).
	if code := sendRequest(victimIP); code != http.StatusTooManyRequests {
		t.Fatalf("setup: victim 6th request got %d, want 429 (bucket should be empty)", code)
	}

	// Phase 2: fill the rest of the map with rateLimiterMaxEntries-1 fresh
	// attacker IPs from different /24 subnets. Clock advances to laterTime so
	// all attacker entries have lastSeen > victim's lastSeen (victim stays
	// oldest). The victim is already entry #1; we add rateLimiterMaxEntries-1
	// more to reach rateLimiterMaxEntries total.
	currentTime = laterTime
	for i := 0; i < rateLimiterMaxEntries-1; i++ {
		// Spread across different /24 subnets as described in the issue.
		attackerIP := fmt.Sprintf("192.%d.%d.1", (i/256)%256, i%256)
		if code := sendRequest(attackerIP); code != http.StatusOK {
			t.Fatalf("setup: attacker seed request %d got %d, want 200", i, code)
		}
	}

	// Phase 3: send one brand-new attacker IP to trigger LRU eviction.
	// The map is at 1000 entries; the new IP causes getLimiter to evict the
	// single oldest entry. The victim (baseTime) is older than all attackers
	// (laterTime), so the victim's limiter is evicted and destroyed.
	currentTime = laterTime
	if code := sendRequest("172.16.0.1"); code != http.StatusOK {
		t.Fatalf("setup: eviction-trigger request got %d, want 200", code)
	}

	// Phase 4: make one more request from the victim IP.
	//
	// EXPECTED (correct behaviour): the victim's token bucket was already
	// exhausted, so this request should be rate-limited → 429.
	//
	// ACTUAL (buggy behaviour): the eviction above destroyed the victim's
	// limiter; getLimiter creates a brand-new one with a full Burst=5 bucket,
	// so the request succeeds → 200.
	//
	// The test fails here because the current implementation is buggy.
	code := sendRequest(victimIP)
	if code != http.StatusTooManyRequests {
		t.Errorf("victim request after eviction: got %d, want 429 — "+
			"eviction reset the victim's token bucket (LRU eviction attack)", code)
	}
}

// TestCidrKey verifies the cidrKey helper for all key input categories.
func TestCidrKey(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		// IPv4 host address → /24 prefix (last octet zeroed).
		{"1.2.3.200", "1.2.3.0"},
		// IPv4 address whose last octet is already zero.
		{"1.2.3.0", "1.2.3.0"},
		// IPv6 host address → /48 prefix (lower 80 bits zeroed).
		{"2001:db8::1", "2001:db8::"},
		// IPv4-mapped IPv6 address → treated as IPv4, masked to /24.
		{"::ffff:1.2.3.4", "1.2.3.0"},
		// Unparseable string → returned unchanged.
		{"not-an-ip", "not-an-ip"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := cidrKey(tt.input)
			if got != tt.want {
				t.Errorf("cidrKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// TestRateLimiterCidrBucketing verifies that two IPs in the same /24 share a
// single map entry, and that an IP in a different /24 gets its own entry.
func TestRateLimiterCidrBucketing(t *testing.T) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	fixedTime := time.Now()
	nowFn := func() time.Time { return fixedTime }

	lenFunc, _, middlewareFn := rateLimiterInternal(cfg, nowFn)

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	sendRequest := func(ip string) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip + ":1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
	}

	// Two IPs in the same /24 (10.0.0.0/24) should share one bucket.
	sendRequest("10.0.0.1")
	sendRequest("10.0.0.2")

	if got := lenFunc(); got != 1 {
		t.Fatalf("after two IPs in the same /24: map size = %d, want 1 (should share one bucket)", got)
	}

	// An IP in a different /24 (10.0.1.0/24) gets its own bucket.
	sendRequest("10.0.1.1")

	if got := lenFunc(); got != 2 {
		t.Fatalf("after adding a third IP in a different /24: map size = %d, want 2", got)
	}
}

// BenchmarkRateLimiter measures the hot path: a returning IP that already has
// an entry in the map. b.RunParallel stresses the mutex under concurrency.
func BenchmarkRateLimiter(b *testing.B) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	fixedTime := time.Now()
	nowFn := func() time.Time { return fixedTime }

	_, _, middlewareFn := rateLimiterInternal(cfg, nowFn)

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	// Pre-populate the limiter with the IP that will be used in the hot path.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.168.1.1:9999"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = "192.168.1.1:9999"
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
		}
	})
}

// TestRateLimiterLRUOrder verifies that re-touching an entry moves it to the
// front of the LRU list, protecting it from the next eviction while the truly
// oldest-untouched entry is chosen as the victim instead.
func TestRateLimiterLRUOrder(t *testing.T) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	fixedTime := time.Now()
	nowFn := func() time.Time { return fixedTime }

	lenFunc, containsFunc, middlewareFn := rateLimiterInternal(cfg, nowFn)

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	sendRequest := func(ip string) int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip + ":1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	// Step 1: Fill the map to rateLimiterMaxEntries. The first IP inserted
	// ("10.0.0.1") ends up at the LRU tail after all subsequent inserts push
	// it toward the back (each new insert goes to the front).
	for i := 0; i < rateLimiterMaxEntries; i++ {
		sendRequest(fmt.Sprintf("10.%d.%d.1", i/256, i%256))
	}

	if got := lenFunc(); got != rateLimiterMaxEntries {
		t.Fatalf("after filling: map size = %d, want %d", got, rateLimiterMaxEntries)
	}

	// Step 2: Re-touch the very first IP inserted ("10.0.0.1"). This moves it
	// to the front of the LRU list, making the second-inserted IP ("10.0.1.1")
	// the new LRU tail (the next eviction victim).
	const retouchedIP = "10.0.0.1"
	sendRequest(retouchedIP)

	// The re-touch should not change the map size (it is a hit, not an insert).
	if got := lenFunc(); got != rateLimiterMaxEntries {
		t.Fatalf("after re-touch: map size = %d, want %d (re-touch must not change size)", got, rateLimiterMaxEntries)
	}

	// Step 3: Trigger one eviction by inserting a new IP. The LRU tail at
	// this point is the second-inserted IP ("10.0.1.1"), not the re-touched
	// one. The re-touched IP must survive.
	sendRequest("20.0.0.1")

	// Map must still be at cap after eviction + insert.
	if got := lenFunc(); got != rateLimiterMaxEntries {
		t.Fatalf("after eviction: map size = %d, want %d", got, rateLimiterMaxEntries)
	}

	// Step 4: Assert the re-touched entry is still present in the map.
	// containsFunc checks map membership directly, so this fails for the right
	// reason if the re-touched entry was wrongly chosen as the eviction victim.
	// (A size-only check would be vacuously true because getLimiter silently
	// re-inserts an evicted entry, triggering a second eviction to keep the cap.)
	const retouchedCIDR = "10.0.0.0" // cidrKey("10.0.0.1") → /24 prefix
	if !containsFunc(retouchedCIDR) {
		t.Fatalf("re-touched entry %q was evicted; it should have survived because it was moved to the LRU front", retouchedCIDR)
	}
}

// TestRateLimiterConcurrentEviction launches many goroutines each sending
// requests from a unique IP and asserts the map never exceeds the hard cap.
// Run with -race to catch list-pointer data races: go test -race ./internal/rest/...
func TestRateLimiterConcurrentEviction(t *testing.T) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	fixedTime := time.Now()
	nowFn := func() time.Time { return fixedTime }

	lenFunc, _, middlewareFn := rateLimiterInternal(cfg, nowFn)

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	const goroutines = 50
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for g := 0; g < goroutines; g++ {
		g := g // capture
		go func() {
			defer wg.Done()
			// Each goroutine uses a distinct /24 subnet (10.g.0.1) to guarantee
			// a unique map entry and therefore trigger eviction when at cap.
			ip := fmt.Sprintf("10.%d.0.1", g)
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = ip + ":9999"
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
		}()
	}

	wg.Wait()

	if got := lenFunc(); got > rateLimiterMaxEntries {
		t.Fatalf("after concurrent requests: map size = %d, exceeds hard cap %d", got, rateLimiterMaxEntries)
	}
}

// BenchmarkRateLimiterEvictionPath measures throughput on the eviction code
// path: every iteration inserts a new IP from a pool larger than the cap,
// forcing an LRU eviction each time. Compare with BenchmarkRateLimiter which
// tests the fast (cache-hit) path.
func BenchmarkRateLimiterEvictionPath(b *testing.B) {
	cfg := config.RateLimitConfig{
		RequestsPerSecond: 1_000_000.0,
		Burst:             1_000_000,
	}

	fixedTime := time.Now()
	nowFn := func() time.Time { return fixedTime }

	_, _, middlewareFn := rateLimiterInternal(cfg, nowFn)

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := middlewareFn(noop)

	// Pre-fill the map to the hard cap so eviction fires from the very first
	// iteration of b.RunParallel.
	for i := 0; i < rateLimiterMaxEntries; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = fmt.Sprintf("10.%d.%d.1:1234", i/256, i%256)
		h.ServeHTTP(httptest.NewRecorder(), req)
	}

	// Rotating pool of IPs larger than the cap: every iteration produces an IP
	// not currently in the map (because the pool cycles through 2× cap unique
	// /24 subnets that differ from the pre-fill range), ensuring an eviction
	// on every call.
	poolSize := rateLimiterMaxEntries * 2
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			idx := i % poolSize
			i++
			ip := fmt.Sprintf("20.%d.%d.1", idx/256, idx%256)
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = ip + ":5678"
			h.ServeHTTP(httptest.NewRecorder(), req)
		}
	})
}
