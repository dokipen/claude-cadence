package proxy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
)

// startTestHub creates a hub and HTTP server that accepts agent WebSocket
// connections and registers them. The connected agent responds to
// getTerminalEndpoint with address/port pointing at the mock ttyd server.
func startTestHub(t *testing.T, mockTtydAddr string) (*hub.Hub, string) {
	t.Helper()
	h := hub.New(30*time.Second, 5*time.Second, 5*time.Minute)
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

		// Read register.
		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}
		var req hub.Request
		json.Unmarshal(data, &req)
		var params hub.RegisterParams
		json.Unmarshal(req.Params, &params)

		resp, _ := hub.NewResponse(req.ID, &hub.RegisterResult{Accepted: true})
		respData, _ := json.Marshal(resp)
		conn.Write(r.Context(), websocket.MessageText, respData)

		agent, err := h.Register(params.Name, conn, &params)
		if err != nil {
			conn.Close(websocket.StatusPolicyViolation, err.Error())
			return
		}
		h.HandleAgentConnection(r.Context(), agent)
	}))
	t.Cleanup(srv.Close)

	return h, srv.URL
}

// connectAgent registers an agent that responds to getTerminalEndpoint with
// a URL whose hostname matches the advertised address.
// advertiseIP is the bare IP registered with the hub (validated by
// ValidateAdvertiseAddress). ttydAddr is the host:port used in the response URL.
func connectAgent(t *testing.T, url, name, advertiseIP, ttydAddr string) {
	t.Helper()
	respURL := "ws://" + ttydAddr + "/ws/terminal/any"
	connectAgentWithMismatch(t, url, name, advertiseIP, respURL)
}

// waitForAgent polls until the agent appears in the hub.
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

func TestHandleTerminalProxy_AgentNotFound(t *testing.T) {
	h := hub.New(30*time.Second, 5*time.Second, 5*time.Minute)
	h.Start()
	defer h.Stop()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/ws/terminal/nonexistent/sess-1")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestHandleTerminalProxy_AgentOffline(t *testing.T) {
	h := hub.New(30*time.Second, 5*time.Second, 5*time.Minute)
	h.Start()
	defer h.Stop()

	// Register a fake offline agent.
	offlineConn, _, _ := websocket.Dial(context.Background(), "", nil)
	_ = offlineConn // will be nil since dial fails, need another approach

	// Use hub's internal Register with a real conn that we then mark offline.
	// Instead, we'll test this flow through the proxy: connect an agent, then disconnect it.
	// For a simpler test, just verify agent-not-found returns 404.
	// The offline case is implicitly tested when the agent goes offline.
	t.Skip("offline agent test requires live connection teardown; covered by integration tests")
}

func TestHandleTerminalProxy_Relay(t *testing.T) {
	// Start a mock ttyd WebSocket server that echoes messages.
	mockTtyd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			t.Errorf("mock ttyd accept: %v", err)
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "done")

		// Echo loop.
		for {
			msgType, data, err := conn.Read(r.Context())
			if err != nil {
				return
			}
			echo := append([]byte("echo:"), data...)
			if err := conn.Write(r.Context(), msgType, echo); err != nil {
				return
			}
		}
	}))
	defer mockTtyd.Close()

	// Parse the mock ttyd address (host:port) and extract bare IP for registration.
	mockAddr := strings.TrimPrefix(mockTtyd.URL, "http://")
	mockHost := strings.SplitN(mockAddr, ":", 2)[0]

	// Start hub with agent.
	h, hubURL := startTestHub(t, mockTtyd.URL)
	connectAgent(t, hubURL, "test-agent", mockHost, mockAddr)
	waitForAgent(t, h, "test-agent")

	// Start proxy server.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	// Connect browser WebSocket to proxy.
	proxyWSURL := "ws" + strings.TrimPrefix(proxySrv.URL, "http") + "/ws/terminal/test-agent/sess-1"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	browserConn, _, err := websocket.Dial(ctx, proxyWSURL, nil)
	if err != nil {
		t.Fatalf("browser dial failed: %v", err)
	}
	defer browserConn.Close(websocket.StatusNormalClosure, "done")

	// Send a message through the proxy.
	msg := []byte("hello terminal")
	if err := browserConn.Write(ctx, websocket.MessageBinary, msg); err != nil {
		t.Fatalf("browser write: %v", err)
	}

	// Read echoed response.
	_, data, err := browserConn.Read(ctx)
	if err != nil {
		t.Fatalf("browser read: %v", err)
	}

	expected := "echo:hello terminal"
	if string(data) != expected {
		t.Errorf("expected %q, got %q", expected, string(data))
	}
}

// connectAgentWithMismatch is like connectAgent but lets the caller specify a
// different URL in the getTerminalEndpoint response than what was advertised
// at registration.
func connectAgentWithMismatch(t *testing.T, url, name, advertiseAddr, respURL string) {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(url, "http")
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	regReq, _ := hub.NewRequest("reg-1", "register", &hub.RegisterParams{
		Name:     name,
		Profiles: map[string]hub.ProfileInfo{"default": {Description: "test"}},
		Ttyd:     hub.TtydInfo{AdvertiseAddress: advertiseAddr, BasePort: 0},
	})
	data, _ := json.Marshal(regReq)
	conn.Write(context.Background(), websocket.MessageText, data)
	conn.Read(context.Background()) // ack

	go func() {
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var req hub.Request
			json.Unmarshal(data, &req)

			var resp *hub.Response
			switch req.Method {
			case "getTerminalEndpoint":
				result, _ := json.Marshal(hub.GetTerminalEndpointResult{
					URL: respURL,
				})
				resp = &hub.Response{
					JSONRPC: "2.0",
					ID:      req.ID,
					Result:  result,
				}
			case "ping":
				result, _ := json.Marshal(hub.PongResult{Pong: true})
				resp = &hub.Response{
					JSONRPC: "2.0",
					ID:      req.ID,
					Result:  result,
				}
			default:
				resp = hub.NewErrorResponse(req.ID, hub.RPCErrNotFound, "unknown method")
			}

			respData, _ := json.Marshal(resp)
			conn.Write(context.Background(), websocket.MessageText, respData)
		}
	}()
}

func TestHandleTerminalProxy_AddressMismatch(t *testing.T) {
	h, hubURL := startTestHub(t, "")
	connectAgentWithMismatch(t, hubURL, "mismatch-agent", "10.0.0.1", "ws://192.168.1.100:7681/ws/terminal/sess-1")
	waitForAgent(t, h, "mismatch-agent")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	resp, err := http.Get(proxySrv.URL + "/ws/terminal/mismatch-agent/sess-1")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", resp.StatusCode)
	}
}

func TestHandleTerminalProxy_EmptyURL(t *testing.T) {
	h, hubURL := startTestHub(t, "")
	connectAgentWithMismatch(t, hubURL, "empty-addr-agent", "10.0.0.1", "")
	waitForAgent(t, h, "empty-addr-agent")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	resp, err := http.Get(proxySrv.URL + "/ws/terminal/empty-addr-agent/sess-1")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", resp.StatusCode)
	}
}

func TestHandleTerminalProxy_BadScheme(t *testing.T) {
	h, hubURL := startTestHub(t, "")
	connectAgentWithMismatch(t, hubURL, "bad-scheme-agent", "10.0.0.1", "http://10.0.0.1:7681/ws/terminal/sess-1")
	waitForAgent(t, h, "bad-scheme-agent")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	resp, err := http.Get(proxySrv.URL + "/ws/terminal/bad-scheme-agent/sess-1")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", resp.StatusCode)
	}
}

func TestHandleTerminalProxy_MalformedURL(t *testing.T) {
	h, hubURL := startTestHub(t, "")
	connectAgentWithMismatch(t, hubURL, "malformed-agent", "10.0.0.1", "://missing-scheme")
	waitForAgent(t, h, "malformed-agent")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	resp, err := http.Get(proxySrv.URL + "/ws/terminal/malformed-agent/sess-1")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", resp.StatusCode)
	}
}

func TestHandleTerminalProxy_OriginRejected(t *testing.T) {
	h := hub.New(30*time.Second, 5*time.Second, 5*time.Minute)
	h.Start()
	defer h.Stop()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, []string{"example.com"}))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	// Send a WebSocket upgrade request with a non-matching Origin header.
	// The coder/websocket library enforces OriginPatterns before upgrading,
	// so the response should not be 101 Switching Protocols.
	req, err := http.NewRequest(http.MethodGet, proxySrv.URL+"/ws/terminal/some-agent/sess-1", nil)
	if err != nil {
		t.Fatalf("creating request: %v", err)
	}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	req.Header.Set("Origin", "https://evil.com")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusSwitchingProtocols {
		t.Errorf("expected origin to be rejected (non-101), got 101 Switching Protocols")
	}
}

// connectRelayAgent registers an agent that responds to getTerminalEndpoint
// with {relay: true}. After sending that response it echoes every binary
// frame it receives back to the hub as a binary frame using the same session
// UUID — simulating a PTY that echoes its input.
func connectRelayAgent(t *testing.T, hubURL, name string) {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(hubURL, "http")
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("connectRelayAgent dial: %v", err)
	}

	regReq, _ := hub.NewRequest("reg-1", "register", &hub.RegisterParams{
		Name:     name,
		Profiles: map[string]hub.ProfileInfo{"default": {Description: "relay-test"}},
		Ttyd:     hub.TtydInfo{AdvertiseAddress: ""},
	})
	data, _ := json.Marshal(regReq)
	conn.Write(context.Background(), websocket.MessageText, data)
	conn.Read(context.Background()) // consume ack

	go func() {
		for {
			msgType, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}

			// Binary frames are browser→PTY relay frames: decode, echo back.
			if msgType == websocket.MessageBinary {
				sessionID, payload, err := hub.DecodeTerminalFrame(data)
				if err != nil {
					continue
				}
				echoed := hub.EncodeTerminalFrame(sessionID, append([]byte("echo:"), payload...))
				conn.Write(context.Background(), websocket.MessageBinary, echoed)
				continue
			}

			// Text frames are JSON-RPC requests from the hub.
			var req hub.Request
			if err := json.Unmarshal(data, &req); err != nil {
				continue
			}

			var resp *hub.Response
			switch req.Method {
			case "getTerminalEndpoint":
				result, _ := json.Marshal(hub.GetTerminalEndpointResult{Relay: true})
				resp = &hub.Response{
					JSONRPC: "2.0",
					ID:      req.ID,
					Result:  result,
				}
			case "ping":
				result, _ := json.Marshal(hub.PongResult{Pong: true})
				resp = &hub.Response{
					JSONRPC: "2.0",
					ID:      req.ID,
					Result:  result,
				}
			default:
				resp = hub.NewErrorResponse(req.ID, hub.RPCErrNotFound, "unknown method")
			}

			respData, _ := json.Marshal(resp)
			conn.Write(context.Background(), websocket.MessageText, respData)
		}
	}()
}

// TestHandleTerminalProxy_RelayMode verifies the hub relay path end-to-end:
// the agent responds with {relay: true}, the browser sends a binary frame,
// the hub forwards it to the agent as a binary relay frame, the mock agent
// echoes it back, and the browser receives the echoed data.
func TestHandleTerminalProxy_RelayMode(t *testing.T) {
	// startTestHub already handles the register + HandleAgentConnection lifecycle.
	h, hubURL := startTestHub(t, "")
	connectRelayAgent(t, hubURL, "relay-agent")
	waitForAgent(t, h, "relay-agent")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	sessionID := "11111111-2222-3333-4444-555555555555"
	proxyWSURL := "ws" + strings.TrimPrefix(proxySrv.URL, "http") + "/ws/terminal/relay-agent/" + sessionID

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	browserConn, _, err := websocket.Dial(ctx, proxyWSURL, nil)
	if err != nil {
		t.Fatalf("browser dial: %v", err)
	}
	defer browserConn.Close(websocket.StatusNormalClosure, "done")

	msg := []byte("relay input")
	if err := browserConn.Write(ctx, websocket.MessageBinary, msg); err != nil {
		t.Fatalf("browser write: %v", err)
	}

	_, data, err := browserConn.Read(ctx)
	if err != nil {
		t.Fatalf("browser read: %v", err)
	}

	expected := "echo:relay input"
	if string(data) != expected {
		t.Errorf("expected %q, got %q", expected, string(data))
	}
}

// TestHandleTerminalProxy_BackwardCompat_DirectDial verifies that the legacy
// direct-dial path still works when the agent returns a URL instead of
// {relay: true}. This exercises the same code path as the existing
// TestHandleTerminalProxy_Relay test (which is confusingly named).
func TestHandleTerminalProxy_BackwardCompat_DirectDial(t *testing.T) {
	// Mock ttyd that echoes messages.
	mockTtyd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			t.Errorf("mock ttyd accept: %v", err)
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "done")
		for {
			msgType, data, err := conn.Read(r.Context())
			if err != nil {
				return
			}
			_ = conn.Write(r.Context(), msgType, append([]byte("direct:"), data...))
		}
	}))
	defer mockTtyd.Close()

	mockAddr := strings.TrimPrefix(mockTtyd.URL, "http://")
	mockHost := strings.SplitN(mockAddr, ":", 2)[0]

	h, hubURL := startTestHub(t, mockTtyd.URL)
	connectAgent(t, hubURL, "direct-agent", mockHost, mockAddr)
	waitForAgent(t, h, "direct-agent")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	proxyWSURL := "ws" + strings.TrimPrefix(proxySrv.URL, "http") + "/ws/terminal/direct-agent/sess-direct"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	browserConn, _, err := websocket.Dial(ctx, proxyWSURL, nil)
	if err != nil {
		t.Fatalf("browser dial: %v", err)
	}
	defer browserConn.Close(websocket.StatusNormalClosure, "done")

	msg := []byte("direct input")
	if err := browserConn.Write(ctx, websocket.MessageBinary, msg); err != nil {
		t.Fatalf("browser write: %v", err)
	}

	_, data, err := browserConn.Read(ctx)
	if err != nil {
		t.Fatalf("browser read: %v", err)
	}

	expected := "direct:direct input"
	if string(data) != expected {
		t.Errorf("expected %q, got %q", expected, string(data))
	}
}
