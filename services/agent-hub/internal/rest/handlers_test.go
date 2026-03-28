package rest

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
)

func TestRpcCodeToHTTPStatus(t *testing.T) {
	tests := []struct {
		rpcCode    int
		httpStatus int
	}{
		{hub.RPCErrNotFound, http.StatusNotFound},
		{hub.RPCErrAlreadyExists, http.StatusConflict},
		{hub.RPCErrInvalidArgument, http.StatusBadRequest},
		{hub.RPCErrFailedPrecondition, http.StatusConflict},
		{hub.RPCErrInternal, http.StatusInternalServerError},
		{-99999, http.StatusInternalServerError},
	}

	for _, tt := range tests {
		got := rpcCodeToHTTPStatus(tt.rpcCode)
		if got != tt.httpStatus {
			t.Errorf("rpcCodeToHTTPStatus(%d): expected %d, got %d", tt.rpcCode, tt.httpStatus, got)
		}
	}
}

func TestNormalizeRepoFilter(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"https://github.com/owner/repo", "owner/repo"},
		{"https://github.com/owner/repo.git", "owner/repo"},
		{"http://github.com/owner/repo", "owner/repo"},
		// SSH remotes are rejected by ValidateProfileRepo at registration; no
		// stored profile can carry a git@ URL, so SSH normalization is not needed.
		// The input passes through lowercased with .git stripped.
		{"git@github.com:owner/repo.git", "git@github.com:owner/repo"},
		// Non-GitHub HTTPS hosts: strip scheme only, preserve host.
		{"https://gitlab.com/owner/repo.git", "gitlab.com/owner/repo"},
		{"https://gitlab.com/owner/repo", "gitlab.com/owner/repo"},
		{"http://gitlab.com/owner/repo", "gitlab.com/owner/repo"},
		{"https://gitea.example.com/owner/repo.git", "gitea.example.com/owner/repo"},
		{"https://gitea.example.com:3000/owner/repo.git", "gitea.example.com:3000/owner/repo"},
		{"HTTPS://GITHUB.COM/Owner/Repo", "owner/repo"},
		{"", ""},
	}

	for _, tt := range tests {
		got := normalizeRepoFilter(tt.input)
		if got != tt.want {
			t.Errorf("normalizeRepoFilter(%q): expected %q, got %q", tt.input, tt.want, got)
		}
	}
}

func TestFilterAgentsByRepo(t *testing.T) {
	agents := []hub.AgentInfo{
		{
			Name: "alpha",
			Profiles: map[string]hub.ProfileInfo{
				"match":   {Description: "matches repo", Repo: "https://github.com/owner/repo"},
				"nomatch": {Description: "different repo", Repo: "https://github.com/other/repo"},
				"generic": {Description: "generic profile", Repo: ""},
			},
		},
		{
			Name: "beta",
			Profiles: map[string]hub.ProfileInfo{
				"nomatch": {Description: "different repo", Repo: "https://github.com/other/repo"},
			},
		},
		{
			Name:     "gamma",
			Profiles: map[string]hub.ProfileInfo{},
		},
	}

	t.Run("profiles matching repo are kept", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		alphaProfiles := result[0].Profiles
		if _, ok := alphaProfiles["match"]; !ok {
			t.Error("expected 'match' profile to be kept")
		}
	})

	t.Run("profiles not matching are removed", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		alphaProfiles := result[0].Profiles
		if _, ok := alphaProfiles["nomatch"]; ok {
			t.Error("expected 'nomatch' profile to be removed")
		}
	})

	t.Run("profiles with empty Repo are always kept", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		alphaProfiles := result[0].Profiles
		if _, ok := alphaProfiles["generic"]; !ok {
			t.Error("expected generic profile with empty Repo to be kept")
		}
	})

	t.Run("agent with no matching profiles appears with empty profiles map", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		betaProfiles := result[1].Profiles
		if len(betaProfiles) != 0 {
			t.Errorf("expected empty profiles map for beta, got %d profiles", len(betaProfiles))
		}
	})

	t.Run("multiple agents filtered correctly", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		if len(result) != 3 {
			t.Errorf("expected 3 agents in result, got %d", len(result))
		}
		if result[0].Name != "alpha" {
			t.Errorf("expected first agent to be 'alpha', got %q", result[0].Name)
		}
		if result[1].Name != "beta" {
			t.Errorf("expected second agent to be 'beta', got %q", result[1].Name)
		}
	})

	t.Run("no-op when no profiles match: agent still present with empty profiles", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "no/match/at/all")
		// alpha has one generic profile (empty Repo), so it keeps that
		// beta has no generic profiles, so empty
		// gamma already empty
		betaProfiles := result[1].Profiles
		if len(betaProfiles) != 0 {
			t.Errorf("expected 0 profiles for beta with no match, got %d", len(betaProfiles))
		}
		if result[1].Name != "beta" {
			t.Errorf("expected beta to still be present")
		}
	})

	t.Run("originals are not mutated", func(t *testing.T) {
		_ = filterAgentsByRepo(agents, "owner/repo")
		if len(agents[0].Profiles) != 3 {
			t.Errorf("original alpha profiles were mutated: expected 3, got %d", len(agents[0].Profiles))
		}
	})

	t.Run("normalization applied to repo param", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "https://github.com/owner/repo.git")
		alphaProfiles := result[0].Profiles
		if _, ok := alphaProfiles["match"]; !ok {
			t.Error("expected 'match' profile to be kept when repo param uses full HTTPS URL")
		}
	})


	t.Run("non-GitHub HTTPS host matches full URL", func(t *testing.T) {
		gitlabAgents := []hub.AgentInfo{
			{
				Name: "alpha",
				Profiles: map[string]hub.ProfileInfo{
					"match":   {Description: "gitlab repo", Repo: "https://gitlab.com/owner/repo"},
					"nomatch": {Description: "different repo", Repo: "https://gitlab.com/other/repo"},
				},
			},
		}
		result := filterAgentsByRepo(gitlabAgents, "https://gitlab.com/owner/repo")
		if _, ok := result[0].Profiles["match"]; !ok {
			t.Error("expected 'match' profile to be kept for non-GitHub HTTPS URL")
		}
		if _, ok := result[0].Profiles["nomatch"]; ok {
			t.Error("expected 'nomatch' profile to be removed for non-GitHub HTTPS URL")
		}
	})

	t.Run("non-GitHub HTTPS host with port matches full URL", func(t *testing.T) {
		portAgents := []hub.AgentInfo{
			{
				Name: "alpha",
				Profiles: map[string]hub.ProfileInfo{
					"match": {Description: "self-hosted with port", Repo: "https://gitea.example.com:3000/owner/repo"},
				},
			},
		}
		result := filterAgentsByRepo(portAgents, "https://gitea.example.com:3000/owner/repo")
		if _, ok := result[0].Profiles["match"]; !ok {
			t.Error("expected 'match' profile to be kept for HTTPS URL with port")
		}
	})

	t.Run("non-GitHub HTTPS host matches with .git suffix stripped", func(t *testing.T) {
		gitlabAgents := []hub.AgentInfo{
			{
				Name: "alpha",
				Profiles: map[string]hub.ProfileInfo{
					"match": {Description: "gitlab repo with .git", Repo: "https://gitlab.com/owner/repo.git"},
				},
			},
		}
		result := filterAgentsByRepo(gitlabAgents, "https://gitlab.com/owner/repo")
		if _, ok := result[0].Profiles["match"]; !ok {
			t.Error("expected 'match' profile to be kept when stored with .git suffix")
		}
	})
}

// startTestHubWithAgent creates a hub and connects a simulated agent that echoes
// RPC method names back as {"echo": "<method>"}.  It returns the hub and a
// cleanup function that tears down the agent connection and hub.
func startTestHubWithAgent(t *testing.T, agentName string) *hub.Hub {
	t.Helper()

	h := hub.New(30*time.Second, 5*time.Second, 0, 5*time.Minute, 0)
	h.Start()
	t.Cleanup(h.Stop)

	// Spin up an in-process HTTP server so the simulated agent can dial the
	// WebSocket endpoint using the real hub.HandleAgentConnection path.
	agentToken := "test-agent-token"
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/agent", handleAgentWebSocket(h, agentToken))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/agent"
	conn, _, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + agentToken}},
	})
	if err != nil {
		t.Fatalf("dial agent ws: %v", err)
	}
	t.Cleanup(func() { conn.Close(websocket.StatusNormalClosure, "test done") })

	// Register the agent.
	regReq, _ := hub.NewRequest("reg-1", "register", &hub.RegisterParams{
		Name: agentName,
		Profiles: map[string]hub.ProfileInfo{
			"default": {Description: "test", Repo: "https://github.com/test/repo"},
		},
	})
	data, _ := json.Marshal(regReq)
	if err := conn.Write(context.Background(), websocket.MessageText, data); err != nil {
		t.Fatalf("write register: %v", err)
	}
	if _, _, err := conn.Read(context.Background()); err != nil {
		t.Fatalf("read register ack: %v", err)
	}

	// Echo loop: respond with {"echo": "<method>"} for any RPC call.
	go func() {
		for {
			_, msg, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var req hub.Request
			json.Unmarshal(msg, &req)
			var resp *hub.Response
			if req.Method == "ping" {
				resp, _ = hub.NewResponse(req.ID, map[string]bool{"pong": true})
			} else {
				resp, _ = hub.NewResponse(req.ID, map[string]string{"echo": req.Method})
			}
			respData, _ := json.Marshal(resp)
			conn.Write(context.Background(), websocket.MessageText, respData)
		}
	}()

	// Wait for the agent to appear in the hub.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := h.Get(agentName); ok {
			return h
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("agent %q did not register in time", agentName)
	return nil
}

func TestHandleGetSessionOutput_CallsRPCAndReturnsResult(t *testing.T) {
	h := startTestHubWithAgent(t, "output-agent")

	handler := handleGetSessionOutput(h)

	req := httptest.NewRequest("GET", "/api/v1/agents/output-agent/sessions/sess-123/output", nil)
	req.SetPathValue("name", "output-agent")
	req.SetPathValue("id", "sess-123")
	rw := httptest.NewRecorder()

	handler.ServeHTTP(rw, req)

	resp := rw.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}

	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	if result["echo"] != "getSessionOutput" {
		t.Errorf("expected echo=getSessionOutput, got %v", result)
	}
}

func TestHandleGetSessionOutput_OfflineAgentReturns502(t *testing.T) {
	h := hub.New(30*time.Second, 5*time.Second, 0, 5*time.Minute, 0)
	h.Start()
	t.Cleanup(h.Stop)

	// No agent connected — hub has no agents at all, so resolveAgent returns 404.
	// To get a 502 we need the agent registered but offline. Register it by
	// connecting and immediately disconnecting so the hub marks it offline.
	agentToken := "test-agent-token"
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/agent", handleAgentWebSocket(h, agentToken))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/agent"
	conn, _, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + agentToken}},
	})
	if err != nil {
		t.Fatalf("dial agent ws: %v", err)
	}

	// Register.
	regReq, _ := hub.NewRequest("reg-1", "register", &hub.RegisterParams{
		Name:     "offline-agent",
		Profiles: map[string]hub.ProfileInfo{"default": {Description: "test"}},
	})
	data, _ := json.Marshal(regReq)
	conn.Write(context.Background(), websocket.MessageText, data)
	conn.Read(context.Background()) // ack

	// Wait for hub to see the agent as online.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if a, ok := h.Get("offline-agent"); ok && a.Status() == hub.StatusOnline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Now disconnect the agent to make it go offline.
	conn.Close(websocket.StatusNormalClosure, "going offline")

	// Wait for hub to mark it offline.
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if a, ok := h.Get("offline-agent"); ok && a.Status() != hub.StatusOnline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	handler := handleGetSessionOutput(h)
	req := httptest.NewRequest("GET", "/api/v1/agents/offline-agent/sessions/sess-1/output", nil)
	req.SetPathValue("name", "offline-agent")
	req.SetPathValue("id", "sess-1")
	rw := httptest.NewRecorder()

	handler.ServeHTTP(rw, req)

	if rw.Code != http.StatusBadGateway {
		t.Errorf("expected 502 for offline agent, got %d", rw.Code)
	}
}

func TestHandleSendInput_Success(t *testing.T) {
	h := startTestHubWithAgent(t, "test-agent")

	handler := handleSendInput(h)

	req := httptest.NewRequest("POST", "/api/v1/agents/test-agent/sessions/sess-1/input", strings.NewReader(`{"text":"y\n"}`))
	req.SetPathValue("name", "test-agent")
	req.SetPathValue("id", "sess-1")
	rw := httptest.NewRecorder()

	handler.ServeHTTP(rw, req)

	resp := rw.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}
}

func TestHandleSendInput_OfflineAgentReturns502(t *testing.T) {
	h := hub.New(30*time.Second, 5*time.Second, 0, 5*time.Minute, 0)
	h.Start()
	t.Cleanup(h.Stop)

	agentToken := "test-agent-token"
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/agent", handleAgentWebSocket(h, agentToken))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/agent"
	conn, _, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + agentToken}},
	})
	if err != nil {
		t.Fatalf("dial agent ws: %v", err)
	}

	regReq, _ := hub.NewRequest("reg-1", "register", &hub.RegisterParams{
		Name:     "offline-send-agent",
		Profiles: map[string]hub.ProfileInfo{"default": {Description: "test"}},
	})
	data, _ := json.Marshal(regReq)
	conn.Write(context.Background(), websocket.MessageText, data)
	conn.Read(context.Background()) // ack

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if a, ok := h.Get("offline-send-agent"); ok && a.Status() == hub.StatusOnline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	conn.Close(websocket.StatusNormalClosure, "going offline")

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if a, ok := h.Get("offline-send-agent"); ok && a.Status() != hub.StatusOnline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	handler := handleSendInput(h)
	req := httptest.NewRequest("POST", "/api/v1/agents/offline-send-agent/sessions/sess-1/input", strings.NewReader(`{"text":"y\n"}`))
	req.SetPathValue("name", "offline-send-agent")
	req.SetPathValue("id", "sess-1")
	rw := httptest.NewRecorder()

	handler.ServeHTTP(rw, req)

	if rw.Code != http.StatusBadGateway {
		t.Errorf("expected 502 for offline agent, got %d", rw.Code)
	}
}

func TestHandleSendInput_BodyTooLargeReturns413(t *testing.T) {
	h := startTestHubWithAgent(t, "big-body-agent")

	handler := handleSendInput(h)

	oversizedBody := strings.Repeat("x", hub.RPCMaxMessageSize+1)
	req := httptest.NewRequest("POST", "/api/v1/agents/big-body-agent/sessions/sess-1/input", strings.NewReader(oversizedBody))
	req.SetPathValue("name", "big-body-agent")
	req.SetPathValue("id", "sess-1")
	rw := httptest.NewRecorder()

	handler.ServeHTTP(rw, req)

	if rw.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 for oversized body, got %d", rw.Code)
	}
}

func TestHandleSendInput_InvalidJSONReturns400(t *testing.T) {
	h := startTestHubWithAgent(t, "json-agent")

	handler := handleSendInput(h)

	req := httptest.NewRequest("POST", "/api/v1/agents/json-agent/sessions/sess-1/input", strings.NewReader(`{"invalid`))
	req.SetPathValue("name", "json-agent")
	req.SetPathValue("id", "sess-1")
	rw := httptest.NewRecorder()

	handler.ServeHTTP(rw, req)

	if rw.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid JSON, got %d", rw.Code)
	}
}

func TestHandleSendInput_UnknownAgentReturns404(t *testing.T) {
	h := startTestHubWithAgent(t, "known-agent")

	handler := handleSendInput(h)

	req := httptest.NewRequest("POST", "/api/v1/agents/unknown-agent/sessions/sess-1/input", strings.NewReader(`{"text":"y\n"}`))
	req.SetPathValue("name", "unknown-agent")
	req.SetPathValue("id", "sess-1")
	rw := httptest.NewRecorder()

	handler.ServeHTTP(rw, req)

	if rw.Code != http.StatusNotFound {
		t.Errorf("expected 404 for unknown agent, got %d", rw.Code)
	}
}
