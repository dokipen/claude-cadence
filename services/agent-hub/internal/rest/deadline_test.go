package rest

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

// TestIntegration_ListAllSessionsDeadline verifies that handleListAllSessions
// returns HTTP 504 when the overall fan-out deadline fires before any agent
// responds.
func TestIntegration_ListAllSessionsDeadline(t *testing.T) {
	const agentToken = "deadline-agent-token"
	const agentDelay = 200 * time.Millisecond
	const fanOutDeadline = 100 * time.Millisecond

	// Create a hub with generous heartbeat settings.
	h := hub.New(30*time.Second, 5*time.Second, 5*time.Minute, 0)
	h.Start()
	t.Cleanup(h.Stop)

	// Build a mux with:
	//   - /ws/agent  → handleAgentWebSocket (so agents can connect and register)
	//   - /api/v1/sessions → handleListAllSessions with a 100ms deadline
	mux := http.NewServeMux()
	mux.Handle("GET /ws/agent", http.HandlerFunc(handleAgentWebSocket(h, agentToken)))
	mux.HandleFunc("GET /api/v1/sessions", handleListAllSessions(h, fanOutDeadline))

	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	// connectSlowAgent dials the hub WS endpoint, registers with the given name,
	// then enters a loop that sleeps agentDelay before responding to listSessions
	// (simulating a slow agent that won't answer before the deadline fires).
	connectSlowAgent := func(name string) {
		wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws/agent"
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

		// Send register.
		regReq, _ := hub.NewRequest("reg-1", "register", &hub.RegisterParams{
			Name: name,
			Profiles: map[string]hub.ProfileInfo{
				"default": {Description: "slow agent"},
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

		// Slow response loop.
		go func() {
			for {
				_, msgData, err := conn.Read(context.Background())
				if err != nil {
					return
				}
				var req hub.Request
				json.Unmarshal(msgData, &req)

				if req.Method == "ping" {
					resp, _ := hub.NewResponse(req.ID, map[string]bool{"pong": true})
					b, _ := json.Marshal(resp)
					conn.Write(context.Background(), websocket.MessageText, b)
					continue
				}

				// For listSessions: sleep past the fan-out deadline before responding.
				time.Sleep(agentDelay)

				resp, _ := hub.NewResponse(req.ID, map[string]any{"sessions": []any{}})
				b, _ := json.Marshal(resp)
				conn.Write(context.Background(), websocket.MessageText, b)
			}
		}()
	}

	// Connect 2 slow agents.
	connectSlowAgent("slow-agent-1")
	connectSlowAgent("slow-agent-2")

	// Wait until both agents appear in the hub.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if h.AgentCount() >= 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if h.AgentCount() < 2 {
		t.Fatalf("agents did not register in time, got %d", h.AgentCount())
	}

	// Make the request — the 100ms fan-out deadline should fire before the
	// agents' 200ms delay elapses, causing a 504 response.
	req, _ := http.NewRequest("GET", ts.URL+"/api/v1/sessions", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("list all sessions: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusGatewayTimeout {
		t.Errorf("expected 504 Gateway Timeout, got %d", resp.StatusCode)
	}
}
