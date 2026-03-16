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
			Profiles: map[string]hub.ProfileInfo{"default": {Description: "test"}},
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
	})
}
