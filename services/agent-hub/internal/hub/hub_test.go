package hub

import (
	"context"
	"encoding/json"
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
	h := New(30*time.Second, 5*time.Second, 5*time.Minute)
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

		resp, _ := NewResponse(req.ID, &RegisterResult{Accepted: true})
		respData, _ := json.Marshal(resp)
		conn.Write(r.Context(), websocket.MessageText, respData)

		agent := h.Register(params.Name, conn, &params)
		h.HandleAgentConnection(r.Context(), agent)
	}))
	t.Cleanup(srv.Close)

	return h, srv.URL
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
		Profiles: map[string]ProfileInfo{"default": {Description: "test"}},
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
