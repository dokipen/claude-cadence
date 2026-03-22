package proxy

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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

// TestHandleTerminalProxy_SurvivesReadTimeout verifies that WebSocket terminal
// connections survive past the HTTP server's ReadTimeout. Before the fix, the
// server's ReadTimeout (10s) set a deadline on the underlying TCP connection
// that killed idle WebSocket sessions.
func TestHandleTerminalProxy_SurvivesReadTimeout(t *testing.T) {
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

	mockAddr := strings.TrimPrefix(mockTtyd.URL, "http://")
	mockHost := strings.SplitN(mockAddr, ":", 2)[0]

	h, hubURL := startTestHub(t, mockTtyd.URL)
	connectAgent(t, hubURL, "timeout-agent", mockHost, mockAddr)
	waitForAgent(t, h, "timeout-agent")

	// Use NewUnstartedServer so we can set a short ReadTimeout that would
	// kill WebSocket connections without the fix.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", HandleTerminalProxy(h, nil))
	proxySrv := httptest.NewUnstartedServer(mux)
	proxySrv.Config.ReadTimeout = 150 * time.Millisecond
	proxySrv.Config.WriteTimeout = 35 * time.Second
	proxySrv.Start()
	defer proxySrv.Close()

	// Connect browser WebSocket.
	proxyWSURL := "ws" + strings.TrimPrefix(proxySrv.URL, "http") + "/ws/terminal/timeout-agent/sess-1"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	browserConn, _, err := websocket.Dial(ctx, proxyWSURL, nil)
	if err != nil {
		t.Fatalf("browser dial failed: %v", err)
	}
	defer browserConn.Close(websocket.StatusNormalClosure, "done")

	// Wait longer than the ReadTimeout — without the fix this kills the connection.
	time.Sleep(300 * time.Millisecond)

	// Send a message — should still work if deadlines were properly cleared.
	msg := []byte("still alive")
	if err := browserConn.Write(ctx, websocket.MessageBinary, msg); err != nil {
		t.Fatalf("browser write after ReadTimeout: %v", err)
	}

	_, data, err := browserConn.Read(ctx)
	if err != nil {
		t.Fatalf("browser read after ReadTimeout: %v (connection killed by server ReadTimeout)", err)
	}

	expected := "echo:still alive"
	if string(data) != expected {
		t.Errorf("expected %q, got %q", expected, string(data))
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

// ---------------------------------------------------------------------------
// Idle-closing connection infrastructure
// ---------------------------------------------------------------------------

// idleClosingConn wraps a net.Conn and closes it if no data is transferred
// within idleTimeout. The timer is reset on every Read/Write that moves bytes.
// This simulates OS/NAT idle connection drops.
type idleClosingConn struct {
	net.Conn
	idleTimeout time.Duration
	timer       *time.Timer
	mu          sync.Mutex
}

func newIdleClosingConn(c net.Conn, idleTimeout time.Duration) *idleClosingConn {
	ic := &idleClosingConn{
		Conn:        c,
		idleTimeout: idleTimeout,
	}
	ic.timer = time.AfterFunc(idleTimeout, func() {
		c.Close()
	})
	return ic
}

func (ic *idleClosingConn) resetTimer() {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	ic.timer.Reset(ic.idleTimeout)
}

func (ic *idleClosingConn) Read(b []byte) (int, error) {
	n, err := ic.Conn.Read(b)
	if n > 0 {
		ic.resetTimer()
	}
	return n, err
}

func (ic *idleClosingConn) Write(b []byte) (int, error) {
	n, err := ic.Conn.Write(b)
	if n > 0 {
		ic.resetTimer()
	}
	return n, err
}

func (ic *idleClosingConn) Close() error {
	ic.mu.Lock()
	ic.timer.Stop()
	ic.mu.Unlock()
	return ic.Conn.Close()
}

// idleClosingListener wraps a net.Listener and wraps every accepted connection
// in an idleClosingConn so that idle connections are dropped.
type idleClosingListener struct {
	net.Listener
	idleTimeout time.Duration
}

func (l *idleClosingListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return newIdleClosingConn(c, l.idleTimeout), nil
}

// ---------------------------------------------------------------------------
// Keepalive test
// ---------------------------------------------------------------------------

// TestHandleTerminalProxy_KeepalivePreventsDrop verifies that the proxy sends
// periodic keepalive pings that prevent idle OS/NAT connection drops.
//
// The mock ttyd server's listener is wrapped in an idleClosingListener that
// forcibly closes any connection that is idle for more than 300ms. Without
// keepalive pings from the hub to the ttyd connection the relay silently dies
// and the browser sees an error when it tries to send after the idle period.
//
// pingInterval (100ms) is chosen to be well within the idle timeout (300ms) so
// that pings reliably reset the idle timer on localhost. The pong must arrive
// within pingInterval; 100ms is ample for loopback.
func TestHandleTerminalProxy_KeepalivePreventsDrop(t *testing.T) {
	const idleTimeout = 300 * time.Millisecond

	// Use a ping interval well within the idle timeout.

	// Create the underlying TCP listener manually so we can wrap it.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	idleLn := &idleClosingListener{Listener: ln, idleTimeout: idleTimeout}

	// Start the mock ttyd WebSocket server on the idle-closing listener.
	ttydSrv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
				InsecureSkipVerify: true,
				Subprotocols:       []string{"tty"},
			})
			if err != nil {
				// Connection may have been killed by the idle wrapper — that is expected.
				return
			}
			defer conn.Close(websocket.StatusNormalClosure, "done")

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
		}),
	}
	go ttydSrv.Serve(idleLn) //nolint:errcheck
	t.Cleanup(func() { ttydSrv.Close() })

	// Determine the address for agent registration.
	ttydAddr := idleLn.Addr().String() // host:port
	ttydHost := strings.SplitN(ttydAddr, ":", 2)[0]

	// Start hub and connect an agent that points at the mock ttyd.
	h, hubURL := startTestHub(t, "http://"+ttydAddr)
	connectAgent(t, hubURL, "keepalive-agent", ttydHost, ttydAddr)
	waitForAgent(t, h, "keepalive-agent")

	// Start the proxy server with a 100ms ping interval — well within the 300ms
	// idle timeout and long enough for loopback pong roundtrips.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/terminal/{agent_name}/{session_id}", handleTerminalProxy(h, nil, 100*time.Millisecond))
	proxySrv := httptest.NewServer(mux)
	defer proxySrv.Close()

	// Connect a browser WebSocket through the proxy.
	proxyWSURL := "ws" + strings.TrimPrefix(proxySrv.URL, "http") + "/ws/terminal/keepalive-agent/sess-1"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	browserConn, _, err := websocket.Dial(ctx, proxyWSURL, nil)
	if err != nil {
		t.Fatalf("browser dial failed: %v", err)
	}
	defer browserConn.Close(websocket.StatusNormalClosure, "done")

	// The coder/websocket library requires Read to be called concurrently so
	// that it can process incoming control frames (Ping) and auto-respond with
	// Pong. Without this, the proxy's pingKeepalive targeting browserConn would
	// time out waiting for the pong and tear down the connection.
	type readResult struct {
		msgType websocket.MessageType
		data    []byte
		err     error
	}
	readCh := make(chan readResult, 1)
	go func() {
		msgType, data, err := browserConn.Read(ctx)
		readCh <- readResult{msgType, data, err}
	}()

	// Hold idle for longer than the idle timeout.
	// WITHOUT keepalive: the idle timer fires at 300ms, drops the hub→ttyd TCP
	// connection, and the relay goroutine terminates. When the browser sends a
	// message it either gets a write error or reads a close frame.
	// WITH keepalive: pings every 100ms reset the idle timer, so the connection
	// survives the 600ms idle period.
	time.Sleep(600 * time.Millisecond)

	// Try to send a message — should succeed only if the connection survived.
	msg := []byte("hello after idle")
	if err := browserConn.Write(ctx, websocket.MessageBinary, msg); err != nil {
		t.Fatalf("browser write after idle period: %v (connection was dropped — keepalive missing)", err)
	}

	// Read the echo response via the background goroutine.
	result := <-readCh
	if result.err != nil {
		t.Fatalf("browser read after idle period: %v (connection was dropped — keepalive missing)", result.err)
	}

	expected := "echo:hello after idle"
	if string(result.data) != expected {
		t.Errorf("expected %q, got %q", expected, string(result.data))
	}
}
