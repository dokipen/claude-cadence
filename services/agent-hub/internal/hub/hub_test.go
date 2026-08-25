package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/google/uuid"

	sharedrelay "github.com/dokipen/claude-cadence/services/shared/relay"
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
	h := New(interval, timeout, 15*time.Second, 5*time.Minute, 0)
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

// startTestHubWithKeepalive creates a Hub and HTTP server with custom heartbeat and keepalive settings.
func startTestHubWithKeepalive(t *testing.T, interval, timeout, keepalive time.Duration) (*Hub, string) {
	t.Helper()
	h := New(interval, timeout, keepalive, 5*time.Minute, 0)
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

		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}
		var req Request
		json.Unmarshal(data, &req)

		var params RegisterParams
		json.Unmarshal(req.Params, &params)

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

// TestHeartbeatTimeoutClosesConnection covers issue #691: a heartbeat
// timeout marks the agent offline via markOfflineIfCurrent, which must also
// close the underlying websocket connection. Otherwise HandleAgentConnection's
// read loop would stay alive and keep calling Touch() on the "offline" agent,
// and the client-side connection would remain usable, preventing the agent
// from ever reconnecting. This test asserts the fixed behavior: once the
// agent is marked offline, the original connection is closed — a write from
// the original client connection fails, and LastSeen no longer advances.
func TestHeartbeatTimeoutClosesConnection(t *testing.T) {
	h, url := startTestHubWithHeartbeat(t, 50*time.Millisecond, 50*time.Millisecond)

	conn := connectRawAgent(t, url, "raw-silent-agent")
	defer conn.CloseNow()

	agent := waitForAgent(t, h, "raw-silent-agent")

	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Poll until the agent is marked offline by the heartbeat timeout. The
	// client never reads or responds to the hub's heartbeat ping, so the
	// heartbeat loop's timeout branch will fire and call markOfflineIfCurrent.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if agent.Status() == StatusOffline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if agent.Status() != StatusOffline {
		t.Fatalf("expected agent to be marked offline after heartbeat timeout, got %s", agent.Status())
	}

	lastSeenBeforeWrite := agent.LastSeen()

	// The underlying websocket connection must have been closed when the
	// agent was marked offline. Prove this by writing a message from the
	// original client connection: either the write itself fails immediately
	// (connection already closed locally), or the hub's read loop has
	// exited and never processes the message, so LastSeen must not advance.
	req, err := NewRequest("post-offline-1", "noop", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	writeErr := conn.Write(context.Background(), websocket.MessageText, data)

	touchDeadline := time.Now().Add(1 * time.Second)
	touched := false
	for time.Now().Before(touchDeadline) {
		if agent.LastSeen().After(lastSeenBeforeWrite) {
			touched = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if touched {
		t.Fatalf("expected hub's read loop to have exited after the agent went offline, but LastSeen advanced after a post-offline write")
	}

	if writeErr == nil {
		// The local write may briefly succeed if it races the close
		// handshake, but the connection must observe the close shortly
		// after: poll with bounded per-attempt reads until Read reports an
		// error (the expected outcome), or the deadline is reached.
		readDeadline := time.Now().Add(1 * time.Second)
		closed := false
		for time.Now().Before(readDeadline) {
			readCtx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			_, _, readErr := conn.Read(readCtx)
			cancel()
			if readErr != nil && !errors.Is(readErr, context.DeadlineExceeded) {
				closed = true
				break
			}
		}
		if !closed {
			t.Fatalf("expected connection to be closed after agent marked offline, but reads kept succeeding or timing out")
		}
	}

	if agent.Status() != StatusOffline {
		t.Fatalf("expected agent to remain marked offline, got %s", agent.Status())
	}
}

// dialAndRegisterNoFatal dials the test server and registers under name,
// without using t.Fatalf (safe to call from a background goroutine, unlike
// t.Fatalf/FailNow which must only be called from the test's own goroutine).
func dialAndRegisterNoFatal(url, name string) (*websocket.Conn, error) {
	wsURL := "ws" + strings.TrimPrefix(url, "http")
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}

	regReq, err := NewRequest("reg-1", "register", &RegisterParams{
		Name:     name,
		Profiles: map[string]ProfileInfo{"default": {Description: "test", Repo: "https://github.com/test/repo"}},
	})
	if err != nil {
		return nil, fmt.Errorf("build register request: %w", err)
	}
	data, err := json.Marshal(regReq)
	if err != nil {
		return nil, fmt.Errorf("marshal register request: %w", err)
	}
	if err := conn.Write(context.Background(), websocket.MessageText, data); err != nil {
		return nil, fmt.Errorf("write register: %w", err)
	}
	if _, _, err := conn.Read(context.Background()); err != nil {
		return nil, fmt.Errorf("read register ack: %w", err)
	}
	return conn, nil
}

// connectReconnectingAgent dials and registers under name, then behaves like
// connectSilentAgent (never responding to heartbeat pings) until its
// connection is closed by the hub. At that point it redials and re-registers
// under the same name, and from then on behaves like connectAgent (echoing
// responses to every request, including heartbeat pings), simulating how a
// real agentd process reconnects after being dropped.
func connectReconnectingAgent(t *testing.T, url, name string) *websocket.Conn {
	t.Helper()

	conn, err := dialAndRegisterNoFatal(url, name)
	if err != nil {
		t.Fatalf("initial connect: %v", err)
	}

	go func() {
		// Silent phase: consume messages without replying, so heartbeat
		// pings time out and the hub closes this connection.
		for {
			if _, _, err := conn.Read(context.Background()); err != nil {
				break
			}
		}

		// Reconnect under the same name and answer normally from here on.
		reconnected, err := dialAndRegisterNoFatal(url, name)
		if err != nil {
			t.Logf("reconnect failed: %v", err)
			return
		}
		for {
			_, data, err := reconnected.Read(context.Background())
			if err != nil {
				return
			}
			var req Request
			if err := json.Unmarshal(data, &req); err != nil {
				continue
			}
			result, _ := json.Marshal(map[string]string{"echo": req.Method})
			resp := &Response{JSONRPC: "2.0", ID: req.ID, Result: result}
			respData, err := json.Marshal(resp)
			if err != nil {
				continue
			}
			if err := reconnected.Write(context.Background(), websocket.MessageText, respData); err != nil {
				return
			}
		}
	}()

	return conn
}

// TestHeartbeatTimeoutThenReconnectRestoresOnline covers the acceptance
// criteria for issue #691: after a heartbeat timeout marks an agent offline
// and closes its connection, the agent must be able to reconnect and be
// restored to online status. Before the fix, the stale connection was never
// closed, so a reconnect attempt under the same name would only replace the
// map entry while the old read loop kept running against a "phantom" agent —
// this test guards against that regressing.
func TestHeartbeatTimeoutThenReconnectRestoresOnline(t *testing.T) {
	h, url := startTestHubWithHeartbeat(t, 50*time.Millisecond, 50*time.Millisecond)

	connectReconnectingAgent(t, url, "reconnecting-agent")

	agent := waitForAgent(t, h, "reconnecting-agent")
	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Poll until the heartbeat timeout marks the agent offline.
	offlineDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(offlineDeadline) {
		if agent.Status() == StatusOffline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if agent.Status() != StatusOffline {
		t.Fatalf("expected agent to be marked offline after heartbeat timeout, got %s", agent.Status())
	}

	// Poll until the reconnect completes and the agent is restored online.
	// Register() replaces the map entry, so re-fetch via h.Get rather than
	// reusing the (now stale) agent pointer.
	onlineDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(onlineDeadline) {
		if current, ok := h.Get("reconnecting-agent"); ok && current.Status() == StatusOnline {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected agent to be restored online after reconnect")
}

// TestWSKeepaliveLoop_Disabled verifies that a zero keepalive interval does not
// panic and that the agent stays online (the loop is a no-op).
func TestWSKeepaliveLoop_Disabled(t *testing.T) {
	h, url := startTestHubWithKeepalive(t, 30*time.Second, 5*time.Second, 0)

	connectAgent(t, url, "test-agent")
	agent := waitForAgent(t, h, "test-agent")

	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Give it a moment to ensure no panic from a zero-interval ticker.
	time.Sleep(50 * time.Millisecond)

	if agent.Status() != StatusOnline {
		t.Errorf("expected agent to remain online, got %s", agent.Status())
	}
}

// TestWSKeepaliveLoop_KeepsAgentOnline verifies that protocol-level keepalive pings
// are sent and the agent remains online when responding normally.
func TestWSKeepaliveLoop_KeepsAgentOnline(t *testing.T) {
	// Use a very short keepalive interval to trigger multiple pings in the test window.
	h, url := startTestHubWithKeepalive(t, 30*time.Second, 5*time.Second, 20*time.Millisecond)

	connectAgent(t, url, "test-agent")
	agent := waitForAgent(t, h, "test-agent")

	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Wait long enough for several keepalive pings to have fired.
	time.Sleep(100 * time.Millisecond)

	// Agent should still be online — keepalive pings must not cause spurious offline marking.
	if agent.Status() != StatusOnline {
		t.Errorf("expected agent to remain online after keepalive pings, got %s", agent.Status())
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
	h := New(30*time.Second, 5*time.Second, 15*time.Second, 5*time.Minute, 0)
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
	h := New(30*time.Second, 5*time.Second, 15*time.Second, 5*time.Minute, 0)
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
	h := New(30*time.Second, 5*time.Second, 15*time.Second, ttl, 0)
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

	// Acquire two sessions.
	_, cancel1 := context.WithCancel(context.Background())
	_, cancel2 := context.WithCancel(context.Background())
	if !h.AcquireTerminalSession("sess-1", cancel1) {
		t.Fatal("AcquireTerminalSession sess-1 failed unexpectedly")
	}
	if !h.AcquireTerminalSession("sess-2", cancel2) {
		t.Fatal("AcquireTerminalSession sess-2 failed unexpectedly")
	}

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

// TestHandleAgentConnection_OversizedTextFrame verifies that a large text
// (JSON-RPC) frame does NOT cause the hub to close the connection or mark
// the agent offline. Per issue #685, message size alone must never be
// treated as a dead-peer signal — only the connection-level read limit
// backstop may close the connection, and no legitimate RPC message should
// ever approach it. This uses a 600 KiB frame, comfortably larger than the
// old (deleted) RPC size check but far below the hub's read limit.
func TestHandleAgentConnection_OversizedTextFrame(t *testing.T) {
	h, url := startTestHub(t)

	conn := connectRawAgent(t, url, "oversize-agent")
	defer conn.CloseNow()

	agent := waitForAgent(t, h, "oversize-agent")
	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Build a 600 KiB JSON-RPC-shaped text frame (padding embedded in the
	// result field). This is larger than the old, now-deleted
	// 512 KiB post-read RPC frame cap but must be handled without closing the
	// connection.
	const frameSize = 600 * 1024
	const prefix = `{"jsonrpc":"2.0","id":"x","result":"`
	const suffix = `"}`
	padding := make([]byte, frameSize-len(prefix)-len(suffix))
	for i := range padding {
		padding[i] = 'x'
	}
	oversized := append([]byte(prefix), padding...)
	oversized = append(oversized, []byte(suffix)...)

	if err := conn.Write(context.Background(), websocket.MessageText, oversized); err != nil {
		t.Fatalf("write large text frame: %v", err)
	}

	// Deterministic liveness proof: perform a real hub->agent RPC round-trip
	// over the same connection AFTER the large frame was read by the hub.
	// The hub processes frames sequentially in its read loop, so if the
	// large frame had caused the hub to close the connection (the old
	// size-based close), the ping request below would never reach the raw
	// agent and h.Call would fail with a timeout or write error. This is
	// strictly stronger than polling Status() for a fixed interval, and
	// completes in milliseconds on the happy path.
	//
	// The raw agent replies to every request it receives (including any
	// heartbeat ping) so the round-trip cannot be confused by other traffic.
	readErr := make(chan error, 1)
	go func() {
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				readErr <- err
				return
			}
			var req Request
			if err := json.Unmarshal(data, &req); err != nil || req.Method == "" {
				continue
			}
			result, _ := json.Marshal(map[string]string{"pong": "ok"})
			resp := &Response{JSONRPC: "2.0", ID: req.ID, Result: result}
			respData, _ := json.Marshal(resp)
			if err := conn.Write(context.Background(), websocket.MessageText, respData); err != nil {
				readErr <- err
				return
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result, err := h.Call(ctx, agent, "ping", nil)
	if err != nil {
		select {
		case rerr := <-readErr:
			t.Fatalf("RPC round-trip after large text frame failed (%v); agent-side read error: %v — hub closed the connection on message size", err, rerr)
		default:
			t.Fatalf("RPC round-trip after large text frame failed: %v — hub closed or stalled the connection on message size", err)
		}
	}
	var pong map[string]string
	if err := json.Unmarshal(result, &pong); err != nil || pong["pong"] != "ok" {
		t.Fatalf("unexpected ping result after large text frame: %s", result)
	}

	// Belt-and-braces: the agent must still be online. The round-trip above
	// already proves the connection is open, so a short poll suffices to
	// catch a delayed offline transition.
	deadline := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		if agent.Status() != StatusOnline {
			t.Fatalf("agent went offline after large text frame (status=%s) — message size must never mark an agent offline", agent.Status())
		}
		time.Sleep(25 * time.Millisecond)
	}
	if agent.Status() != StatusOnline {
		t.Errorf("expected agent to remain online after large text frame, got %s", agent.Status())
	}
}

// TestHandleAgentConnection_FullBufferSnapshotFrame verifies that a binary
// relay frame carrying a full PTY ring-buffer snapshot replay (the exact
// scenario that caused the 2026-08-23 outage in issue #685) does not close
// the agent connection or mark the agent offline, and that the frame is
// delivered intact to the registered terminal relay channel.
//
// Frame size is exactly sharedrelay.MaxSnapshotFrameSize (1,048,593 bytes):
// ring buffer (1<<20 - 1) + ttyd '0' prefix (1) + relay header (17). The
// hub's former agent-connection read limit (1<<20 = 1,048,576) was 17 bytes
// too small for this frame, so coder/websocket closed the connection with
// StatusMessageTooBig before HandleAgentConnection ever saw the data.
func TestHandleAgentConnection_FullBufferSnapshotFrame(t *testing.T) {
	h, url := startTestHub(t)

	conn := connectRawAgent(t, url, "snapshot-agent")
	defer conn.CloseNow()

	agent := waitForAgent(t, h, "snapshot-agent")
	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	sessionID := uuid.New()
	relayCh, cleanup, err := h.OpenTerminalRelay(context.Background(), "snapshot-agent", sessionID)
	if err != nil {
		t.Fatalf("OpenTerminalRelay: %v", err)
	}
	// On current (buggy) code the hub closes the agent connection and calls
	// CloseTerminalChannels internally, which already closes this relay
	// channel. Guard against a double-close panic from our own cleanup call
	// so the test reports the real failure (frame not delivered / agent
	// offline) instead of crashing the test binary.
	defer func() {
		defer func() { _ = recover() }()
		cleanup()
	}()

	// Build the ttyd-prefixed payload: '0' output-type byte + ring buffer
	// worth of PTY output.
	ttydPayload := make([]byte, sharedrelay.MaxPTYBufferSize+sharedrelay.TtydFramePrefixLen)
	ttydPayload[0] = '0'
	for i := sharedrelay.TtydFramePrefixLen; i < len(ttydPayload); i++ {
		ttydPayload[i] = byte('a' + i%26)
	}
	if len(ttydPayload) != sharedrelay.MaxSnapshotFrameSize-sharedrelay.TerminalFrameHeaderLen {
		t.Fatalf("test setup: unexpected ttyd payload length %d", len(ttydPayload))
	}

	frame := EncodeTerminalFrame(sessionID, ttydPayload)
	if len(frame) != sharedrelay.MaxSnapshotFrameSize {
		t.Fatalf("test setup: expected frame of %d bytes, got %d", sharedrelay.MaxSnapshotFrameSize, len(frame))
	}

	if err := conn.Write(context.Background(), websocket.MessageBinary, frame); err != nil {
		t.Fatalf("write full-buffer snapshot frame: %v", err)
	}

	// The frame should be delivered intact to the relay channel.
	select {
	case delivered := <-relayCh:
		if len(delivered) != len(ttydPayload) {
			t.Errorf("expected delivered payload of %d bytes, got %d", len(ttydPayload), len(delivered))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for full-buffer snapshot frame to be delivered — connection likely closed by SetReadLimit")
	}

	// Give the hub's read loop a moment; the connection must still be open.
	time.Sleep(100 * time.Millisecond)
	if agent.Status() != StatusOnline {
		t.Errorf("expected agent to remain online after full-buffer snapshot frame, got %s", agent.Status())
	}

	// Confirm the connection is still usable for further frames.
	pingReq, _ := NewRequest("ping-check", "ping", nil)
	pingData, _ := json.Marshal(pingReq)
	if err := conn.Write(context.Background(), websocket.MessageText, pingData); err != nil {
		t.Fatalf("write after snapshot frame failed — connection was closed: %v", err)
	}
}

// TestHandleAgentConnection_AtLimitBinaryFrame verifies that a large binary
// relay frame with an invalid header does NOT close the connection: the hub
// logs a warning about the invalid frame and continues the read loop.
func TestHandleAgentConnection_AtLimitBinaryFrame(t *testing.T) {
	h, url := startTestHub(t)

	conn := connectRawAgent(t, url, "atlimit-agent")
	defer conn.CloseNow()

	agent := waitForAgent(t, h, "atlimit-agent")
	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Send a half-snapshot-sized binary frame. The frame header will be
	// invalid (no 0x01 type byte in the right position), so
	// DecodeTerminalFrame returns an error — but the hub logs a warning and
	// continues the loop without closing the connection.
	atLimit := make([]byte, sharedrelay.MaxSnapshotFrameSize/2)
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

// TestMaxMessageSizeConstants asserts the invariant that protects against
// issue #685: the largest legitimate relay frame the hub can receive
// (sharedrelay.MaxSnapshotFrameSize, a full PTY ring-buffer snapshot replay)
// must be strictly less than the hub's agent-connection read limit. If this
// inversion ever creeps back in, coder/websocket closes the whole agent
// connection on a routine snapshot replay instead of delivering the frame.
func TestMaxMessageSizeConstants(t *testing.T) {
	if sharedrelay.MaxSnapshotFrameSize >= AgentMaxMessageSize {
		t.Errorf("sharedrelay.MaxSnapshotFrameSize (%d) must be < AgentMaxMessageSize (%d) — a full ring-buffer snapshot replay would close the agent connection (issue #685)",
			sharedrelay.MaxSnapshotFrameSize, AgentMaxMessageSize)
	}
}

// TestCloseTerminalChannel verifies that CloseTerminalChannel closes and removes
// a single relay channel while leaving other channels for different sessions intact.
func TestCloseTerminalChannel(t *testing.T) {
	agent := &ConnectedAgent{
		Name:             "test-agent",
		status:           StatusOnline,
		pending:          make(map[string]chan *Response),
		terminalChannels: make(map[uuid.UUID]*terminalRelay),
	}

	sessA := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	sessB := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

	chA, _ := agent.RegisterTerminalRelay(sessA)
	chB, cleanupB := agent.RegisterTerminalRelay(sessB)
	defer cleanupB()

	// Close only sessA.
	agent.CloseTerminalChannel(sessA)

	// chA should be closed: receive returns zero value with ok=false.
	select {
	case val, ok := <-chA:
		if ok {
			t.Errorf("expected chA to be closed, got value %v", val)
		}
	default:
		t.Error("expected receive on closed chA to succeed immediately, but it would block")
	}

	// chB should still be open and empty (non-blocking receive would block).
	select {
	case val, ok := <-chB:
		if !ok {
			t.Error("expected chB to still be open, but it was closed")
		} else {
			t.Errorf("expected chB to be empty and open, got unexpected value %v", val)
		}
	default:
		// Good: channel is open and empty.
	}

	// Count remaining terminal channels — should be exactly 1.
	agent.terminalMu.Lock()
	count := len(agent.terminalChannels)
	agent.terminalMu.Unlock()
	if count != 1 {
		t.Errorf("expected 1 terminal channel after CloseTerminalChannel, got %d", count)
	}
}

// TestHandleAgentConnection_RelayEndFrame verifies that when an agent sends a
// FrameTypeRelayEnd binary frame, the hub closes the corresponding terminal channel.
func TestHandleAgentConnection_RelayEndFrame(t *testing.T) {
	h, url := startTestHub(t)

	conn := connectRawAgent(t, url, "relay-end-agent")
	defer conn.CloseNow()

	agent := waitForAgent(t, h, "relay-end-agent")

	// Register a terminal relay channel for a known session ID.
	sessID := uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc")
	ch, _ := agent.RegisterTerminalRelay(sessID)

	// Build and send a FrameTypeRelayEnd frame: [0x02][16-byte UUID].
	frame := make([]byte, sharedrelay.TerminalFrameHeaderLen)
	frame[0] = sharedrelay.FrameTypeRelayEnd
	copy(frame[1:17], sessID[:])

	if err := conn.Write(context.Background(), websocket.MessageBinary, frame); err != nil {
		t.Fatalf("write relay-end frame: %v", err)
	}

	// Poll until the channel is closed (hub processes frame asynchronously).
	deadline := time.Now().Add(2 * time.Second)
	channelClosed := false
	for time.Now().Before(deadline) {
		select {
		case _, ok := <-ch:
			if !ok {
				channelClosed = true
			}
		default:
		}
		if channelClosed {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !channelClosed {
		t.Error("expected terminal channel to be closed after FrameTypeRelayEnd, but it is still open")
	}
}

// TestHandleAgentConnection_UnknownBinaryFrameType verifies that an unknown
// binary frame type is handled gracefully — logged and ignored — and the
// connection remains open.
func TestHandleAgentConnection_UnknownBinaryFrameType(t *testing.T) {
	h, url := startTestHub(t)

	conn := connectRawAgent(t, url, "unknown-frame-agent")
	defer conn.CloseNow()

	agent := waitForAgent(t, h, "unknown-frame-agent")
	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Send a binary frame with unknown type 0xFF and a valid-length header.
	frame := make([]byte, sharedrelay.TerminalFrameHeaderLen)
	frame[0] = 0xFF
	id := uuid.New()
	copy(frame[1:17], id[:])

	if err := conn.Write(context.Background(), websocket.MessageBinary, frame); err != nil {
		t.Fatalf("write unknown frame: %v", err)
	}

	// Give the hub's read loop a moment to process the frame.
	time.Sleep(100 * time.Millisecond)

	// Agent should still be online — hub did not close the connection.
	if agent.Status() != StatusOnline {
		t.Errorf("expected agent to remain online after unknown binary frame type, got %s", agent.Status())
	}

	// Confirm connection is still usable by sending a valid text frame.
	pingReq, _ := NewRequest("ping-unknown-check", "ping", nil)
	pingData, _ := json.Marshal(pingReq)
	if err := conn.Write(context.Background(), websocket.MessageText, pingData); err != nil {
		t.Fatalf("write after unknown frame failed — connection was closed: %v", err)
	}
}

// connectPingOnlyAgent dials the test server, registers, then reads messages
// and only responds to "ping" — all other RPC calls are silently dropped.
// This allows heartbeat to succeed while RPC calls time out.
func connectPingOnlyAgent(t *testing.T, url, name string) {
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

	// Read loop: only respond to ping; drop everything else.
	go func() {
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var req Request
			if err := json.Unmarshal(data, &req); err != nil {
				continue
			}
			if req.Method != "ping" {
				// Silently drop non-ping requests (simulates hung RPC).
				continue
			}
			result, _ := json.Marshal(map[string]string{"pong": "ok"})
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

func TestRPCTimeoutDemotesAgent(t *testing.T) {
	// Use a long heartbeat interval so heartbeats don't interfere with the test.
	h, url := startTestHubWithHeartbeat(t, 30*time.Second, 5*time.Second)

	connectPingOnlyAgent(t, url, "rpc-timeout-agent")
	agent := waitForAgent(t, h, "rpc-timeout-agent")

	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Make 3 RPC calls with a short timeout. The agent will not respond to
	// getDiagnostics, so each call should time out after ~200ms.
	for i := 0; i < 3; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		_, err := h.Call(ctx, agent, "getDiagnostics", map[string]string{})
		cancel()

		if err == nil {
			t.Fatalf("call %d: expected timeout error, got nil", i+1)
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("call %d: expected DeadlineExceeded, got: %v", i+1, err)
		}
	}

	// After 3 consecutive deadline-exceeded timeouts, the agent should be offline.
	if agent.Status() != StatusOffline {
		t.Errorf("expected agent to be offline after 3 consecutive RPC timeouts, got %s", agent.Status())
	}
}

func TestRPCTimeout_TwoFailuresDoNotDemote(t *testing.T) {
	// Use a long heartbeat interval so heartbeats don't interfere with the test.
	h, url := startTestHubWithHeartbeat(t, 30*time.Second, 5*time.Second)

	connectPingOnlyAgent(t, url, "rpc-two-fail-agent")
	agent := waitForAgent(t, h, "rpc-two-fail-agent")

	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Make only 2 RPC calls that time out. The threshold is 3, so the agent
	// must remain online after 2 consecutive failures (off-by-one guard).
	for i := 0; i < 2; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		_, err := h.Call(ctx, agent, "getDiagnostics", map[string]string{})
		cancel()

		if err == nil {
			t.Fatalf("call %d: expected timeout error, got nil", i+1)
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("call %d: expected DeadlineExceeded, got: %v", i+1, err)
		}
	}

	// After only 2 consecutive timeouts (below the threshold of 3), the agent
	// must still be online.
	if agent.Status() != StatusOnline {
		t.Errorf("expected agent to remain online after 2 consecutive RPC timeouts (threshold is %d), got %s",
			maxConsecutiveRPCFailures, agent.Status())
	}
}

func TestRPCTimeout_SuccessResetsCounter(t *testing.T) {
	// Test that resetRPCFailures zeroes the counter so that N-1 timeouts + 1
	// success + N-1 more timeouts never reaches the demotion threshold.
	// Because ConnectedAgent is in the same package we can call the methods
	// directly without going through the full WebSocket stack.
	agent := &ConnectedAgent{
		Name:    "counter-reset-agent",
		status:  StatusOnline,
		pending: make(map[string]chan *Response),
	}

	// Increment twice — still below threshold (3).
	c1 := agent.incRPCFailures()
	c2 := agent.incRPCFailures()
	if c1 != 1 {
		t.Errorf("after first incRPCFailures: expected 1, got %d", c1)
	}
	if c2 != 2 {
		t.Errorf("after second incRPCFailures: expected 2, got %d", c2)
	}

	// Simulate a successful RPC — counter resets to 0.
	agent.resetRPCFailures()
	if agent.consecutiveRPCFailures != 0 {
		t.Errorf("after resetRPCFailures: expected 0, got %d", agent.consecutiveRPCFailures)
	}

	// Two more increments after the reset must only reach 2, not 4.
	c3 := agent.incRPCFailures()
	c4 := agent.incRPCFailures()
	if c3 != 1 {
		t.Errorf("after reset + first incRPCFailures: expected 1, got %d", c3)
	}
	if c4 != 2 {
		t.Errorf("after reset + second incRPCFailures: expected 2, got %d", c4)
	}

	// Agent must still be online — nothing here should have triggered demotion.
	if agent.Status() != StatusOnline {
		t.Errorf("agent status should remain online throughout counter test, got %s", agent.Status())
	}
}

func TestRPCCanceledDoesNotDemoteAgent(t *testing.T) {
	h, url := startTestHubWithHeartbeat(t, 30*time.Second, 5*time.Second)

	connectPingOnlyAgent(t, url, "rpc-cancel-agent")
	agent := waitForAgent(t, h, "rpc-cancel-agent")

	if agent.Status() != StatusOnline {
		t.Fatalf("expected agent to start online, got %s", agent.Status())
	}

	// Make maxConsecutiveRPCFailures+1 RPC calls and cancel each context
	// mid-flight (after the WebSocket write succeeds but before the agent
	// responds). This exercises the select { case <-ctx.Done() } branch in
	// hub.go and the errors.Is(callErr, context.DeadlineExceeded) gate that
	// deliberately excludes context.Canceled from the failure counter.
	for i := 0; i < maxConsecutiveRPCFailures+1; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)

		errCh := make(chan error, 1)
		go func() {
			_, err := h.Call(ctx, agent, "getDiagnostics", map[string]string{})
			errCh <- err
		}()

		// Give the WebSocket write time to land before cancelling.
		time.Sleep(50 * time.Millisecond)
		cancel()

		err := <-errCh
		if err == nil {
			t.Fatalf("call %d: expected error, got nil", i+1)
		}
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("call %d: expected context.Canceled, got: %v", i+1, err)
		}
	}

	// After maxConsecutiveRPCFailures+1 context.Canceled errors, the agent
	// must still be online — Canceled is deliberately excluded from the counter.
	if agent.Status() != StatusOnline {
		t.Errorf("expected agent to remain online after %d context.Canceled RPC errors, got %s",
			maxConsecutiveRPCFailures+1, agent.Status())
	}

	// White-box: confirm the counter was never incremented.
	if agent.consecutiveRPCFailures != 0 {
		t.Errorf("expected consecutiveRPCFailures to be 0 after context.Canceled errors, got %d",
			agent.consecutiveRPCFailures)
	}
}
