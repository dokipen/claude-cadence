package e2e_test

import (
	"context"
	"testing"
	"time"

	agentsv1 "github.com/dokipen/claude-cadence/services/agents/gen/agents/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCreateSession_Success(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	sess := resp.GetSession()
	if sess.GetId() == "" {
		t.Error("expected non-empty session ID")
	}
	if sess.GetName() != name {
		t.Errorf("expected name %q, got %q", name, sess.GetName())
	}
	if sess.GetState() != agentsv1.SessionState_SESSION_STATE_RUNNING {
		t.Errorf("expected state RUNNING, got %v", sess.GetState())
	}
	if sess.GetAgentProfile() != "sleeper" {
		t.Errorf("expected agent_profile %q, got %q", "sleeper", sess.GetAgentProfile())
	}
	if !tmuxSessionExists("agentd-test", name) {
		t.Errorf("expected tmux session %q to exist", name)
	}
}

func TestCreateSession_DuplicateName(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("first CreateSession: %v", err)
	}

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	_, err = client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err == nil {
		t.Fatal("expected error on duplicate name, got nil")
	}
	if code := status.Code(err); code != codes.AlreadyExists {
		t.Errorf("expected AlreadyExists, got %v", code)
	}
}

func TestCreateSession_InvalidProfile(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()

	_, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "nonexistent",
		SessionName:  uniqueSessionName(t),
	})
	if err == nil {
		t.Fatal("expected error for unknown profile, got nil")
	}
	if code := status.Code(err); code != codes.NotFound {
		t.Errorf("expected NotFound, got %v", code)
	}
}

func TestCreateSession_AutoName(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  "",
	})
	if err != nil {
		t.Fatalf("CreateSession with empty name: %v", err)
	}

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	if resp.GetSession().GetName() == "" {
		t.Error("expected auto-generated non-empty session name")
	}
}

func TestGetSession_Running(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	createResp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	sessionID := createResp.GetSession().GetId()

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: sessionID,
			Force:     true,
		})
	})

	getResp, err := client.GetSession(ctx, &agentsv1.GetSessionRequest{
		SessionId: sessionID,
	})
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if getResp.GetSession().GetState() != agentsv1.SessionState_SESSION_STATE_RUNNING {
		t.Errorf("expected state RUNNING, got %v", getResp.GetSession().GetState())
	}
}

func TestGetSession_Stopped(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	createResp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "fast-exit",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	sessionID := createResp.GetSession().GetId()

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: sessionID,
			Force:     true,
		})
	})

	// Poll until the session transitions to STOPPED (tmux session exits).
	deadline := time.Now().Add(5 * time.Second)
	var lastState agentsv1.SessionState
	for time.Now().Before(deadline) {
		getResp, err := client.GetSession(ctx, &agentsv1.GetSessionRequest{
			SessionId: sessionID,
		})
		if err != nil {
			t.Fatalf("GetSession: %v", err)
		}
		lastState = getResp.GetSession().GetState()
		if lastState == agentsv1.SessionState_SESSION_STATE_STOPPED {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Errorf("expected state STOPPED within 5s, last state was %v", lastState)
}

func TestGetSession_NotFound(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()

	_, err := client.GetSession(ctx, &agentsv1.GetSessionRequest{
		SessionId: "nonexistent-uuid",
	})
	if err == nil {
		t.Fatal("expected error for nonexistent session ID, got nil")
	}
	if code := status.Code(err); code != codes.NotFound {
		t.Errorf("expected NotFound, got %v", code)
	}
}

func TestListSessions_Empty(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()

	// Use a profile filter that would only match sessions with a fake profile
	// that does not exist, ensuring an empty result even if other tests created sessions.
	resp, err := client.ListSessions(ctx, &agentsv1.ListSessionsRequest{
		AgentProfile: "no-such-profile-xyz",
	})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(resp.GetSessions()) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(resp.GetSessions()))
	}
}

func TestListSessions_Multiple(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()
	name1 := uniqueSessionName(t)
	name2 := uniqueSessionName(t)

	resp1, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name1,
	})
	if err != nil {
		t.Fatalf("CreateSession 1: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp1.GetSession().GetId(),
			Force:     true,
		})
	})

	resp2, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name2,
	})
	if err != nil {
		t.Fatalf("CreateSession 2: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp2.GetSession().GetId(),
			Force:     true,
		})
	})

	listResp, err := client.ListSessions(ctx, &agentsv1.ListSessionsRequest{})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}

	id1 := resp1.GetSession().GetId()
	id2 := resp2.GetSession().GetId()
	found := make(map[string]bool)
	for _, s := range listResp.GetSessions() {
		if s.GetId() == id1 || s.GetId() == id2 {
			found[s.GetId()] = true
		}
	}
	if !found[id1] {
		t.Errorf("session %q not found in list", id1)
	}
	if !found[id2] {
		t.Errorf("session %q not found in list", id2)
	}
}

func TestListSessions_FilterByProfile(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()
	sleeperName := uniqueSessionName(t)
	echoName := uniqueSessionName(t)

	sleeperResp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  sleeperName,
	})
	if err != nil {
		t.Fatalf("CreateSession sleeper: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: sleeperResp.GetSession().GetId(),
			Force:     true,
		})
	})

	echoResp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "echo-and-exit",
		SessionName:  echoName,
	})
	if err != nil {
		t.Fatalf("CreateSession echo-and-exit: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: echoResp.GetSession().GetId(),
			Force:     true,
		})
	})

	listResp, err := client.ListSessions(ctx, &agentsv1.ListSessionsRequest{
		AgentProfile: "sleeper",
	})
	if err != nil {
		t.Fatalf("ListSessions with filter: %v", err)
	}

	sleeperID := sleeperResp.GetSession().GetId()
	echoID := echoResp.GetSession().GetId()
	foundSleeper := false
	foundEcho := false
	for _, s := range listResp.GetSessions() {
		if s.GetId() == sleeperID {
			foundSleeper = true
		}
		if s.GetId() == echoID {
			foundEcho = true
		}
	}
	if !foundSleeper {
		t.Errorf("sleeper session %q not found in filtered list", sleeperID)
	}
	if foundEcho {
		t.Errorf("echo-and-exit session %q should not appear in sleeper-filtered list", echoID)
	}
}

func TestDestroySession_Force(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	createResp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	sessionID := createResp.GetSession().GetId()

	_, err = client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
		SessionId: sessionID,
		Force:     true,
	})
	if err != nil {
		t.Fatalf("DestroySession: %v", err)
	}

	if tmuxSessionExists("agentd-test", name) {
		t.Errorf("expected tmux session %q to be gone after destroy", name)
	}

	_, err = client.GetSession(ctx, &agentsv1.GetSessionRequest{
		SessionId: sessionID,
	})
	if err == nil {
		t.Fatal("expected GetSession to return error after destroy, got nil")
	}
	if code := status.Code(err); code != codes.NotFound {
		t.Errorf("expected NotFound after destroy, got %v", code)
	}
}

func TestDestroySession_NotFound(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()

	_, err := client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
		SessionId: "nonexistent-uuid",
		Force:     true,
	})
	if err == nil {
		t.Fatal("expected error for nonexistent session ID, got nil")
	}
	if code := status.Code(err); code != codes.NotFound {
		t.Errorf("expected NotFound, got %v", code)
	}
}
