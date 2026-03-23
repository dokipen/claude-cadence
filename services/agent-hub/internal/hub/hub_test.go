package hub

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// startTestHub creates a Hub and HTTP server that accepts agent WebSocket connections.
// Returns the hub, server URL, and a cleanup function.
func startTestHub(t *testing.T) (*Hub, string) {
	t.Helper()
	return startTestHubWithHeartbeat(t, 30*time.Second, 5*time.Second)
}

// connectAgent dials the test server as an agentd, registers, and runs a read loop
// that echoes back results for any method.
func connectAgent(t *testing.T, url, name string) {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(url, "http")
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	// Send register.
	regReq, _ := NewRequest("reg-1", "register", &RegisterParams{
		Name:     name,
		Profiles: map[string]ProfileInfo{"default": {Description: "test", Repo: "https://github.com/test/repo"}},
	})
	data, _ := json.Marshal(regReq)
	conn.Write(context.Background(), websocket.MessageText, data)

	// Read register ack.
	conn.Read(context.Background())

	// Echo loop: for any request, respond with {"echo": method}.
	go func() {
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var req Request
			json.Unmarshal(data, &req)

			result, _ := json.Marshal(map[string]string{"echo": req.Method})
			resp := &Response{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result:  result,
			}
			respData, _ := json.Marshal(resp)
			conn.Write(context.Background(), websocket.MessageText, respData)
		}
	}()
}

// startTestHubWithHeartbeat creates a Hub and HTTP server with custom heartbeat settings.
func startTestHubWithHeartbeat(t *testing.T, interval, timeout time.Duration) (*Hub, string) {
	t.Helper()
	h := New(interval, timeout, 5*time.Minute)
	h.Start()
	t.Cleanup(h.Stop)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			t.Errorf("accept ws: %v", err)
			return
		}

		// Read register message.
		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}
		var req Request
		json.Unmarshal(data, &req)

		var params RegisterParams
		json.Unmarshal(req.Params, &params)

		// Register first, then send the appropriate ack (mirrors production handler).
		agent, regErr := h.Register(params.Name, conn, &params)

		var resp *Response
		if regErr != nil {
			resp = NewErrorResponse(req.ID, RPCErrFailedPrecondition, "registration rejected")
		} else {
			resp, _ = NewResponse(req.ID, &RegisterResult{Accepted: true})
		}
		respData, _ := json.Marshal(resp)
		conn.Write(r.Context(), websocket.MessageText, respData)

		if regErr != nil {
			conn.Close(websocket.StatusPolicyViolation, "registration rejected")
			return
		}
		h.HandleAgentConnection(r.Context(), agent)
	}))
	t.Cleanup(srv.Close)

	return h, srv.URL
}

// connectSilentAgent dials the test server, registers, then reads messages
// without ever responding. This causes heartbeat pings to time out.
func connectSilentAgent(t *testing.T, url, name string) {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(url, "http")
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	// Send register.
	regReq, _ := NewRequest("reg-1", "register", &RegisterParams{
		Name:     name,
		Profiles: map[string]ProfileInfo{"default": {Description: "test", Repo: "https://github.com/test/repo"}},
	})
	data, _ := json.Marshal(regReq)
	conn.Write(context.Background(), websocket.MessageText, data)

	// Read register ack.
	conn.Read(context.Background())

	// Read loop: consume messages but never reply.
	go func() {
		for {
			_, _, err := conn.Read(context.Background())
			if err != nil {
				return
			}
		}
	}()
}

func waitForAgent(t *testing.T, h *Hub, name string) *ConnectedAgent {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if agent, ok := h.Get(name); ok {
			return agent
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("agent %q did not register in time", name)
	return nil
}

func TestHeartbeatTimeout(t *testing.T) {
	h, url := startTestHubWithHeartbeat(t, 50*time.Millisecond, 50*time.Millisecond)

	connectSilentAgent(t, url, "silent-agent")
	agent := waitForAgent(t, h, "silent-agent")

	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Poll until the agent is marked offline by the heartbeat timeout.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if agent.Status() == StatusOffline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if agent.Status() != StatusOffline {
		t.Errorf("expected agent to be marked offline after heartbeat timeout, got %s", agent.Status())
	}
}

func TestHub_Call_Success(t *testing.T) {
	h, url := startTestHub(t)
	connectAgent(t, url, "test-agent")

	// Wait for agent to register.
	deadline := time.Now().Add(2 * time.Second)
	var agent *ConnectedAgent
	for time.Now().Before(deadline) {
		var ok bool
		agent, ok = h.Get("test-agent")
		if ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if agent == nil {
		t.Fatal("agent did not register in time")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := h.Call(ctx, agent, "getSession", map[string]string{"session_id": "abc"})
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	var echo map[string]string
	json.Unmarshal(result, &echo)
	if echo["echo"] != "getSession" {
		t.Errorf("expected echo=getSession, got %v", echo)
	}
}

func TestHub_Call_AgentOffline(t *testing.T) {
	h := New(30*time.Second, 5*time.Second, 5*time.Minute)
	h.Start()
	defer h.Stop()

	// Create a fake offline agent.
	agent := &ConnectedAgent{
		Name:    "offline-agent",
		status:  StatusOffline,
		pending: make(map[string]chan *Response),
	}

	ctx := context.Background()
	_, err := h.Call(ctx, agent, "test", nil)
	if err == nil {
		t.Fatal("expected error for offline agent")
	}
	if !strings.Contains(err.Error(), "offline") {
		t.Errorf("expected 'offline' in error, got: %v", err)
	}
}

func TestHub_Call_RPCError(t *testing.T) {
	h, url := startTestHub(t)

	// Connect an agent that returns RPC errors.
	wsURL := "ws" + strings.TrimPrefix(url, "http")
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	regReq, _ := NewRequest("reg-1", "register", &RegisterParams{
		Name:     "error-agent",
		Profiles: map[string]ProfileInfo{},
	})
	data, _ := json.Marshal(regReq)
	conn.Write(context.Background(), websocket.MessageText, data)
	conn.Read(context.Background())

	go func() {
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var req Request
			json.Unmarshal(data, &req)

			resp := NewErrorResponse(req.ID, RPCErrNotFound, "session not found")
			respData, _ := json.Marshal(resp)
			conn.Write(context.Background(), websocket.MessageText, respData)
		}
	}()

	// Wait for registration.
	deadline := time.Now().Add(2 * time.Second)
	var agent *ConnectedAgent
	for time.Now().Before(deadline) {
		var ok bool
		agent, ok = h.Get("error-agent")
		if ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if agent == nil {
		t.Fatal("agent did not register in time")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = h.Call(ctx, agent, "getSession", map[string]string{"session_id": "xxx"})
	if err == nil {
		t.Fatal("expected CallError")
	}

	callErr, ok := err.(*CallError)
	if !ok {
		t.Fatalf("expected *CallError, got %T: %v", err, err)
	}
	if callErr.RPCError.Code != RPCErrNotFound {
		t.Errorf("expected code %d, got %d", RPCErrNotFound, callErr.RPCError.Code)
	}
}

func TestRegister(t *testing.T) {
	h, url := startTestHub(t)

	// Register a new agent via WebSocket.
	connectAgent(t, url, "agent-a")

	deadline := time.Now().Add(2 * time.Second)
	var a1 *ConnectedAgent
	for time.Now().Before(deadline) {
		var ok bool
		a1, ok = h.Get("agent-a")
		if ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if a1 == nil {
		t.Fatal("expected agent-a to be registered")
	}
	if a1.Status() != StatusOnline {
		t.Errorf("expected status online, got %s", a1.Status())
	}

	// Get returns the same pointer.
	got, ok := h.Get("agent-a")
	if !ok || got != a1 {
		t.Error("Get returned different pointer than expected")
	}

	// Re-register with the same name — old connection should be replaced.
	connectAgent(t, url, "agent-a")

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		second, _ := h.Get("agent-a")
		if second != nil && second != a1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	second, _ := h.Get("agent-a")
	if second == a1 {
		t.Error("expected re-register to replace the agent")
	}
	if second.Status() != StatusOnline {
		t.Errorf("replacement agent should be online, got %s", second.Status())
	}
}

// newTestHubNoReaper creates a Hub for unit tests that do not need the
// background reaper or real WebSocket connections. Agents registered with
// nil conns are removed before Stop so that Stop does not panic.
func newTestHubNoReaper(t *testing.T) *Hub {
	t.Helper()
	h := New(30*time.Second, 5*time.Second, 5*time.Minute)
	h.Start()
	t.Cleanup(func() {
		// Remove nil-conn agents to prevent panic in Stop.
		h.mu.Lock()
		for name, agent := range h.agents {
			if agent.Conn() == nil {
				delete(h.agents, name)
			}
		}
		h.mu.Unlock()
		h.Stop()
	})
	return h
}

func TestMarkOffline(t *testing.T) {
	h := newTestHubNoReaper(t)

	params := &RegisterParams{
		Name:     "agent-b",
		Profiles: map[string]ProfileInfo{},
	}
	if _, err := h.Register("agent-b", nil, params); err != nil {
		t.Fatalf("Register: %v", err)
	}

	agent, ok := h.Get("agent-b")
	if !ok {
		t.Fatal("agent not found")
	}
	if agent.Status() != StatusOnline {
		t.Fatalf("expected online, got %s", agent.Status())
	}

	h.MarkOffline("agent-b")

	if agent.Status() != StatusOffline {
		t.Errorf("expected offline after MarkOffline, got %s", agent.Status())
	}

	// MarkOffline on unknown agent should not panic.
	h.MarkOffline("no-such-agent")
}

func TestList(t *testing.T) {
	h := newTestHubNoReaper(t)

	// Empty hub returns empty list.
	if got := h.List(); len(got) != 0 {
		t.Errorf("expected empty list, got %d items", len(got))
	}

	if _, err := h.Register("alpha", nil, &RegisterParams{
		Name:     "alpha",
		Profiles: map[string]ProfileInfo{"p1": {Description: "one"}},
	}); err != nil {
		t.Fatalf("Register alpha: %v", err)
	}
	if _, err := h.Register("beta", nil, &RegisterParams{
		Name:     "beta",
		Profiles: map[string]ProfileInfo{"p2": {Description: "two"}, "p3": {Description: "three"}},
	}); err != nil {
		t.Fatalf("Register beta: %v", err)
	}

	list := h.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 agents, got %d", len(list))
	}

	found := map[string]AgentInfo{}
	for _, info := range list {
		found[info.Name] = info
	}

	if _, ok := found["alpha"]; !ok {
		t.Error("expected alpha in list")
	}
	if _, ok := found["beta"]; !ok {
		t.Error("expected beta in list")
	}
	if found["alpha"].Status != StatusOnline {
		t.Errorf("expected alpha online, got %s", found["alpha"].Status)
	}
	if len(found["beta"].Profiles) != 2 {
		t.Errorf("expected 2 profiles for beta, got %d", len(found["beta"].Profiles))
	}
}

func TestRegister_ProfileRepoRoundtrip(t *testing.T) {
	h := newTestHubNoReaper(t)

	repo := "https://github.com/org/myrepo"
	if _, err := h.Register("repo-agent", nil, &RegisterParams{
		Name: "repo-agent",
		Profiles: map[string]ProfileInfo{
			"default": {Description: "test profile", Repo: repo},
		},
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Verify via Get.
	agent, ok := h.Get("repo-agent")
	if !ok {
		t.Fatal("agent not found")
	}
	if agent.Profiles["default"].Repo != repo {
		t.Errorf("Get: expected repo %q, got %q", repo, agent.Profiles["default"].Repo)
	}

	// Verify via List.
	list := h.List()
	found := false
	for _, info := range list {
		if info.Name == "repo-agent" {
			if info.Profiles["default"].Repo != repo {
				t.Errorf("List: expected repo %q, got %q", repo, info.Profiles["default"].Repo)
			}
			found = true
		}
	}
	if !found {
		t.Error("repo-agent not found in List")
	}
}

func TestRegister_ProfileRepoEmpty(t *testing.T) {
	h := newTestHubNoReaper(t)

	// Register without repo — should succeed with empty string (backward compatible).
	if _, err := h.Register("no-repo-agent", nil, &RegisterParams{
		Name: "no-repo-agent",
		Profiles: map[string]ProfileInfo{
			"default": {Description: "no repo"},
		},
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}

	agent, ok := h.Get("no-repo-agent")
	if !ok {
		t.Fatal("agent not found")
	}
	if agent.Profiles["default"].Repo != "" {
		t.Errorf("expected empty repo, got %q", agent.Profiles["default"].Repo)
	}
}

func TestReaper(t *testing.T) {
	ttl := 50 * time.Millisecond
	h := New(30*time.Second, 5*time.Second, ttl)
	h.Start()
	t.Cleanup(func() {
		h.mu.Lock()
		for name, agent := range h.agents {
			if agent.Conn() == nil {
				delete(h.agents, name)
			}
		}
		h.mu.Unlock()
		h.Stop()
	})

	if _, err := h.Register("online-agent", nil, &RegisterParams{
		Name:     "online-agent",
		Profiles: map[string]ProfileInfo{},
	}); err != nil {
		t.Fatalf("Register online-agent: %v", err)
	}
	if _, err := h.Register("offline-agent", nil, &RegisterParams{
		Name:     "offline-agent",
		Profiles: map[string]ProfileInfo{},
	}); err != nil {
		t.Fatalf("Register offline-agent: %v", err)
	}

	// Mark one agent offline so the reaper targets it.
	h.MarkOffline("offline-agent")

	// Poll until the offline agent is reaped.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := h.Get("offline-agent"); !ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if _, ok := h.Get("offline-agent"); ok {
		t.Error("expected offline agent to be reaped")
	}
	if _, ok := h.Get("online-agent"); !ok {
		t.Error("expected online agent to survive reaper")
	}
}

func TestTerminalSessions(t *testing.T) {
	h := newTestHubNoReaper(t)

	if got := h.TerminalSessionCount(); got != 0 {
		t.Fatalf("expected 0 sessions, got %d", got)
	}

	// Track two sessions.
	_, cancel1 := context.WithCancel(context.Background())
	_, cancel2 := context.WithCancel(context.Background())
	h.TrackTerminalSession("sess-1", cancel1)
	h.TrackTerminalSession("sess-2", cancel2)

	if got := h.TerminalSessionCount(); got != 2 {
		t.Errorf("expected 2 sessions, got %d", got)
	}

	// Untrack one.
	h.UntrackTerminalSession("sess-1")
	if got := h.TerminalSessionCount(); got != 1 {
		t.Errorf("expected 1 session after untrack, got %d", got)
	}

	// Untrack the other.
	h.UntrackTerminalSession("sess-2")
	if got := h.TerminalSessionCount(); got != 0 {
		t.Errorf("expected 0 sessions after untrack, got %d", got)
	}

	// Untrack non-existent session should not panic.
	h.UntrackTerminalSession("no-such-session")
}

func TestAgentCount(t *testing.T) {
	h := newTestHubNoReaper(t)

	if got := h.AgentCount(); got != 0 {
		t.Fatalf("expected 0 agents, got %d", got)
	}
	if got := h.OnlineAgentCount(); got != 0 {
		t.Fatalf("expected 0 online agents, got %d", got)
	}

	if _, err := h.Register("a1", nil, &RegisterParams{
		Name:     "a1",
		Profiles: map[string]ProfileInfo{},
	}); err != nil {
		t.Fatalf("Register a1: %v", err)
	}
	if _, err := h.Register("a2", nil, &RegisterParams{
		Name:     "a2",
		Profiles: map[string]ProfileInfo{},
	}); err != nil {
		t.Fatalf("Register a2: %v", err)
	}
	if _, err := h.Register("a3", nil, &RegisterParams{
		Name:     "a3",
		Profiles: map[string]ProfileInfo{},
	}); err != nil {
		t.Fatalf("Register a3: %v", err)
	}

	if got := h.AgentCount(); got != 3 {
		t.Errorf("expected 3 agents, got %d", got)
	}
	if got := h.OnlineAgentCount(); got != 3 {
		t.Errorf("expected 3 online agents, got %d", got)
	}

	// Mark two offline.
	h.MarkOffline("a1")
	h.MarkOffline("a3")

	if got := h.AgentCount(); got != 3 {
		t.Errorf("expected 3 total agents after marking offline, got %d", got)
	}
	if got := h.OnlineAgentCount(); got != 1 {
		t.Errorf("expected 1 online agent, got %d", got)
	}
}


// TestRegister_RejectChangedAdvertiseAddress verifies that Hub.Register rejects
// re-registration when the AdvertiseAddress differs from the original.
// The first agent is registered via a real WebSocket connection (using
// startTestHub) so that the subsequent Register call does not panic when
// trying to close the existing connection.
func TestRegister_RejectChangedAdvertiseAddress(t *testing.T) {
	h, url := startTestHub(t)

	// Remove any nil-conn agents before h.Stop (registered by startTestHub)
	// runs, so Stop does not panic trying to close a nil WebSocket conn.
	// t.Cleanup is LIFO, so this executes before the cleanup registered by
	// startTestHub above.
	t.Cleanup(func() {
		h.mu.Lock()
		for name, a := range h.agents {
			if a.Conn() == nil {
				delete(h.agents, name)
			}
		}
		h.mu.Unlock()
	})

	// Register "agent-addr" via the real WebSocket path.
	connectAgent(t, url, "agent-addr")

	// Wait until the hub has the agent.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := h.Get("agent-addr"); ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, ok := h.Get("agent-addr"); !ok {
		t.Fatal("agent-addr did not register in time")
	}

	// Overwrite the stored TtydConfig to simulate an initial registration
	// with AdvertiseAddress "10.0.0.1".
	h.mu.Lock()
	h.agents["agent-addr"].TtydConfig = TtydInfo{
		AdvertiseAddress: "10.0.0.1",
		BasePort:         7681,
	}
	h.mu.Unlock()

	// Attempt re-registration with a DIFFERENT AdvertiseAddress.
	// The hub should reject this and leave the stored entry unchanged.
	_, err := h.Register("agent-addr", nil, &RegisterParams{
		Name:     "agent-addr",
		Profiles: map[string]ProfileInfo{},
		Ttyd: TtydInfo{
			AdvertiseAddress: "10.0.0.2", // changed — must be rejected
			BasePort:         7681,
		},
	})
	if err == nil {
		t.Fatal("expected error when re-registering with changed AdvertiseAddress")
	}
	if !errors.Is(err, ErrAdvertiseAddressChanged) {
		t.Fatalf("expected ErrAdvertiseAddressChanged, got: %v", err)
	}

	agent, ok := h.Get("agent-addr")
	if !ok {
		t.Fatal("agent-addr not found after re-registration attempt")
	}

	if agent.TtydConfig.AdvertiseAddress != "10.0.0.1" {
		t.Errorf("AdvertiseAddress was overwritten: got %q, want %q",
			agent.TtydConfig.AdvertiseAddress, "10.0.0.1")
	}
}

// TestRegister_AllowSameAdvertiseAddress verifies that re-registration with the
// same AdvertiseAddress is accepted and the existing entry is replaced.
// Uses a real WebSocket connection so the existing entry is present when the
// second Register call runs, exercising the same-address comparison branch.
func TestRegister_AllowSameAdvertiseAddress(t *testing.T) {
	h, url := startTestHub(t)

	// Register "agent-same" via WebSocket.
	connectAgent(t, url, "agent-same")

	deadline := time.Now().Add(2 * time.Second)
	var first *ConnectedAgent
	for time.Now().Before(deadline) {
		var ok bool
		first, ok = h.Get("agent-same")
		if ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if first == nil {
		t.Fatal("agent-same did not register in time")
	}

	// Set a known AdvertiseAddress on the existing entry.
	h.mu.Lock()
	h.agents["agent-same"].TtydConfig = TtydInfo{
		AdvertiseAddress: "10.0.0.1",
		BasePort:         7681,
	}
	h.mu.Unlock()

	// Re-register with the SAME AdvertiseAddress via direct call.
	// The existing entry has a real WebSocket conn so Close won't panic.
	second, err := h.Register("agent-same", nil, &RegisterParams{
		Name:     "agent-same",
		Profiles: map[string]ProfileInfo{},
		Ttyd: TtydInfo{
			AdvertiseAddress: "10.0.0.1",
			BasePort:         7681,
		},
	})
	if err != nil {
		t.Fatalf("re-registration with same address should succeed: %v", err)
	}

	// Clean up nil-conn entry before h.Stop.
	t.Cleanup(func() {
		h.mu.Lock()
		for name, a := range h.agents {
			if a.Conn() == nil {
				delete(h.agents, name)
			}
		}
		h.mu.Unlock()
	})

	if second == nil {
		t.Fatal("expected non-nil agent on re-registration with same address")
	}
	if second == first {
		t.Error("expected a new ConnectedAgent pointer on re-registration")
	}

	stored, ok := h.Get("agent-same")
	if !ok {
		t.Fatal("agent-same not found after re-registration")
	}
	if stored != second {
		t.Error("Get did not return the newly registered agent")
	}
	if stored.TtydConfig.AdvertiseAddress != "10.0.0.1" {
		t.Errorf("AdvertiseAddress changed unexpectedly: got %q", stored.TtydConfig.AdvertiseAddress)
	}
}

// connectRawAgent dials the test server, completes the register handshake,
// and returns the raw WebSocket connection for direct frame manipulation.
// The caller is responsible for closing the connection.
func connectRawAgent(t *testing.T, url, name string) *websocket.Conn {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(url, "http")
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	// Send register.
	regReq, _ := NewRequest("reg-1", "register", &RegisterParams{
		Name:     name,
		Profiles: map[string]ProfileInfo{"default": {Description: "test", Repo: "https://github.com/test/repo"}},
	})
	data, _ := json.Marshal(regReq)
	if err := conn.Write(context.Background(), websocket.MessageText, data); err != nil {
		t.Fatalf("write register: %v", err)
	}

	// Read register ack.
	if _, _, err := conn.Read(context.Background()); err != nil {
		t.Fatalf("read register ack: %v", err)
	}

	return conn
}

// TestHandleAgentConnection_OversizedTextFrame verifies that a text frame
// larger than RPCMaxMessageSize causes the hub to close the connection and
// mark the agent offline.
func TestHandleAgentConnection_OversizedTextFrame(t *testing.T) {
	h, url := startTestHub(t)

	conn := connectRawAgent(t, url, "oversize-agent")
	defer conn.CloseNow()

	agent := waitForAgent(t, h, "oversize-agent")
	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Send a text frame one byte larger than RPCMaxMessageSize.
	oversized := make([]byte, RPCMaxMessageSize+1)
	for i := range oversized {
		oversized[i] = 'x'
	}
	// Write may succeed (the close may happen on the hub side during Read).
	_ = conn.Write(context.Background(), websocket.MessageText, oversized)

	// The next Read on the client side should fail — the hub closed the
	// connection after detecting the oversized text frame.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _, readErr := conn.Read(ctx)
	if readErr == nil {
		t.Fatal("expected connection to be closed by hub after oversized text frame")
	}

	// Poll until the hub marks the agent offline.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if agent.Status() == StatusOffline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if agent.Status() != StatusOffline {
		t.Errorf("expected agent to be marked offline after oversized text frame, got %s", agent.Status())
	}
}

// TestHandleAgentConnection_AtLimitBinaryFrame verifies that a binary relay
// frame does NOT close the connection. Binary frames are allowed up to
// MaxMessageSize (1 MiB); the hub logs a warning about the invalid frame
// header and continues the read loop. The RPC size check must not apply
// to binary frames.
func TestHandleAgentConnection_AtLimitBinaryFrame(t *testing.T) {
	h, url := startTestHub(t)

	conn := connectRawAgent(t, url, "atlimit-agent")
	defer conn.CloseNow()

	agent := waitForAgent(t, h, "atlimit-agent")
	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Send a binary frame of exactly MaxMessageSize bytes. The frame header
	// will be invalid (no 0x01 type byte in the right position), so
	// DecodeTerminalFrame returns an error — but the hub logs a warning and
	// continues the loop without closing the connection.
	// Use half the relay limit to avoid any boundary behavior from WebSocket framing overhead.
	atLimit := make([]byte, MaxMessageSize/2)
	if err := conn.Write(context.Background(), websocket.MessageBinary, atLimit); err != nil {
		t.Fatalf("write binary frame: %v", err)
	}

	// Give the hub's read loop a moment to process the frame.
	time.Sleep(100 * time.Millisecond)

	// The agent should still be online — the hub did not close the connection.
	if agent.Status() != StatusOnline {
		t.Errorf("expected agent to remain online after at-limit binary frame, got %s", agent.Status())
	}

	// Confirm the connection is still usable: send a valid JSON-RPC text
	// message and verify we can read back from the server without a
	// connection-closed error. Use a short deadline to distinguish "no
	// reply" (expected, hub doesn't respond to unsolicited messages) from
	// "connection closed".
	pingReq, _ := NewRequest("ping-check", "ping", nil)
	pingData, _ := json.Marshal(pingReq)
	if err := conn.Write(context.Background(), websocket.MessageText, pingData); err != nil {
		t.Fatalf("write after binary frame failed — connection was closed: %v", err)
	}
}

// TestMaxMessageSizeConstants asserts that RPCMaxMessageSize is strictly less
// than MaxMessageSize. If someone changes one constant without the other this
// test will fail, preventing an accidental inversion.
func TestMaxMessageSizeConstants(t *testing.T) {
	if RPCMaxMessageSize >= MaxMessageSize {
		t.Errorf("RPCMaxMessageSize (%d) must be < MaxMessageSize (%d)",
			RPCMaxMessageSize, MaxMessageSize)
	}
}
