package e2e_test

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

func TestCreateSession_Success(t *testing.T) {
	name := uniqueSessionName(t)

	sess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Cleanup(func() {
		testMgr.Destroy(sess.ID, true)
	})

	if sess.ID == "" {
		t.Error("expected non-empty session ID")
	}
	if sess.Name != name {
		t.Errorf("expected name %q, got %q", name, sess.Name)
	}
	if sess.State != session.StateRunning {
		t.Errorf("expected state RUNNING, got %v", sess.State)
	}
	if sess.AgentProfile != "sleeper" {
		t.Errorf("expected agent_profile %q, got %q", "sleeper", sess.AgentProfile)
	}
}

func TestCreateSession_DuplicateName(t *testing.T) {
	name := uniqueSessionName(t)

	sess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("first Create: %v", err)
	}

	t.Cleanup(func() {
		testMgr.Destroy(sess.ID, true)
	})

	_, err = testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err == nil {
		t.Fatal("expected error on duplicate name, got nil")
	}
	var sessErr *session.Error
	if !errors.As(err, &sessErr) || sessErr.Code != session.ErrAlreadyExists {
		t.Errorf("expected ErrAlreadyExists, got %v", err)
	}
}

func TestCreateSession_InvalidProfile(t *testing.T) {
	_, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "nonexistent",
		SessionName:  uniqueSessionName(t),
	})
	if err == nil {
		t.Fatal("expected error for unknown profile, got nil")
	}
	var sessErr *session.Error
	if !errors.As(err, &sessErr) || sessErr.Code != session.ErrNotFound {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestCreateSession_AutoName(t *testing.T) {
	sess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  "",
	})
	if err != nil {
		t.Fatalf("Create with empty name: %v", err)
	}

	t.Cleanup(func() {
		testMgr.Destroy(sess.ID, true)
	})

	if sess.Name == "" {
		t.Error("expected auto-generated non-empty session name")
	}
}

func TestGetSession_Running(t *testing.T) {
	name := uniqueSessionName(t)

	sess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Cleanup(func() {
		testMgr.Destroy(sess.ID, true)
	})

	got, err := testMgr.Get(sess.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.State != session.StateRunning {
		t.Errorf("expected state RUNNING, got %v", got.State)
	}
}

func TestGetSession_Stopped(t *testing.T) {
	name := uniqueSessionName(t)

	sess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "fast-exit",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Cleanup(func() {
		testMgr.Destroy(sess.ID, true)
	})

	// Poll until the session transitions to STOPPED (process exits).
	deadline := time.Now().Add(5 * time.Second)
	var lastState session.SessionState
	for time.Now().Before(deadline) {
		got, err := testMgr.Get(sess.ID)
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		lastState = got.State
		if lastState == session.StateStopped {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Errorf("expected state STOPPED within 5s, last state was %v", lastState)
}

func TestGetSession_NotFound(t *testing.T) {
	_, err := testMgr.Get("nonexistent-uuid")
	if err == nil {
		t.Fatal("expected error for nonexistent session ID, got nil")
	}
	var sessErr *session.Error
	if !errors.As(err, &sessErr) || sessErr.Code != session.ErrNotFound {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestListSessions_Empty(t *testing.T) {
	// Use a profile filter that would only match sessions with a fake profile
	// that does not exist, ensuring an empty result even if other tests created sessions.
	sessions, err := testMgr.List("no-such-profile-xyz")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestListSessions_Multiple(t *testing.T) {
	name1 := uniqueSessionName(t)
	name2 := uniqueSessionName(t)

	sess1, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  name1,
	})
	if err != nil {
		t.Fatalf("Create 1: %v", err)
	}
	t.Cleanup(func() {
		testMgr.Destroy(sess1.ID, true)
	})

	sess2, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  name2,
	})
	if err != nil {
		t.Fatalf("Create 2: %v", err)
	}
	t.Cleanup(func() {
		testMgr.Destroy(sess2.ID, true)
	})

	sessions, err := testMgr.List("")
	if err != nil {
		t.Fatalf("List: %v", err)
	}

	found := make(map[string]bool)
	for _, s := range sessions {
		if s.ID == sess1.ID || s.ID == sess2.ID {
			found[s.ID] = true
		}
	}
	if !found[sess1.ID] {
		t.Errorf("session %q not found in list", sess1.ID)
	}
	if !found[sess2.ID] {
		t.Errorf("session %q not found in list", sess2.ID)
	}
}

func TestListSessions_FilterByProfile(t *testing.T) {
	sleeperName := uniqueSessionName(t)
	echoName := uniqueSessionName(t)

	sleeperSess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  sleeperName,
	})
	if err != nil {
		t.Fatalf("Create sleeper: %v", err)
	}
	t.Cleanup(func() {
		testMgr.Destroy(sleeperSess.ID, true)
	})

	echoSess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "echo-and-exit",
		SessionName:  echoName,
	})
	if err != nil {
		t.Fatalf("Create echo-and-exit: %v", err)
	}
	t.Cleanup(func() {
		testMgr.Destroy(echoSess.ID, true)
	})

	sessions, err := testMgr.List("sleeper")
	if err != nil {
		t.Fatalf("List with filter: %v", err)
	}

	foundSleeper := false
	foundEcho := false
	for _, s := range sessions {
		if s.ID == sleeperSess.ID {
			foundSleeper = true
		}
		if s.ID == echoSess.ID {
			foundEcho = true
		}
	}
	if !foundSleeper {
		t.Errorf("sleeper session %q not found in filtered list", sleeperSess.ID)
	}
	if foundEcho {
		t.Errorf("echo-and-exit session %q should not appear in sleeper-filtered list", echoSess.ID)
	}
}

func TestDestroySession_Force(t *testing.T) {
	name := uniqueSessionName(t)

	sess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := testMgr.Destroy(sess.ID, true); err != nil {
		t.Fatalf("Destroy: %v", err)
	}

	_, err = testMgr.Get(sess.ID)
	if err == nil {
		t.Fatal("expected Get to return error after destroy, got nil")
	}
	var sessErr *session.Error
	if !errors.As(err, &sessErr) || sessErr.Code != session.ErrNotFound {
		t.Errorf("expected ErrNotFound after destroy, got %v", err)
	}
}

func TestDestroySession_NotFound(t *testing.T) {
	err := testMgr.Destroy("nonexistent-uuid", true)
	if err == nil {
		t.Fatal("expected error for nonexistent session ID, got nil")
	}
	var sessErr *session.Error
	if !errors.As(err, &sessErr) || sessErr.Code != session.ErrNotFound {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

// newTestManagerWithPTY creates an isolated Manager plus its PTYManager so that
// the test can reach the ring buffer and ServeTerminal directly.
func newTestManagerWithPTY(t *testing.T) (*session.Manager, *pty.PTYManager) {
	t.Helper()
	profiles := map[string]config.Profile{
		"echo-and-exit": {Command: "bash -c 'echo hello && sleep 1'"},
		"fast-exit":     {Command: "true"},
		"sleeper":       {Command: "sleep 3600"},
	}
	store := session.NewStore()
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	mgr := session.NewManager(store, ptyMgr, nil, nil, profiles, 0)
	return mgr, ptyMgr
}

// TestReconnect_RingBufferReplayed verifies that a WebSocket client connecting
// after output has been produced receives the ring buffer contents replayed.
func TestReconnect_RingBufferReplayed(t *testing.T) {
	mgr, ptyMgr := newTestManagerWithPTY(t)

	name := uniqueSessionName(t)
	sess, err := mgr.Create(session.CreateRequest{
		AgentProfile: "echo-and-exit",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() { mgr.Destroy(sess.ID, true) })

	// Poll until "hello" appears in the ring buffer.
	deadline := time.Now().Add(5 * time.Second)
	var lastBuf []byte
	for time.Now().Before(deadline) {
		lastBuf, err = ptyMgr.ReadBuffer(sess.ID)
		if err == nil && strings.Contains(string(lastBuf), "hello") {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !strings.Contains(string(lastBuf), "hello") {
		t.Fatalf("timed out waiting for 'hello' in ring buffer; last buf: %q", string(lastBuf))
	}

	// Start a minimal HTTP server that serves ServeTerminal for this session.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/terminal", func(w http.ResponseWriter, r *http.Request) {
		conn, acceptErr := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if acceptErr != nil {
			return
		}
		defer conn.CloseNow()
		_ = ptyMgr.ServeTerminal(r.Context(), sess.ID, conn)
	})
	httpSrv := &http.Server{Handler: mux}
	go httpSrv.Serve(ln)
	t.Cleanup(func() { httpSrv.Close() })

	wsURL := "ws://" + ln.Addr().String() + "/ws/terminal"

	// Connect a WebSocket client and collect output until "hello" arrives or
	// the context times out.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsConn, _, dialErr := websocket.Dial(ctx, wsURL, nil)
	if dialErr != nil {
		t.Fatalf("websocket.Dial: %v", dialErr)
	}
	defer wsConn.CloseNow()

	var received strings.Builder
	for {
		_, data, readErr := wsConn.Read(ctx)
		if readErr != nil {
			break
		}
		if len(data) > 1 && data[0] == '0' {
			received.Write(data[1:])
		}
		if strings.Contains(received.String(), "hello") {
			break
		}
	}

	if !strings.Contains(received.String(), "hello") {
		t.Errorf("expected 'hello' replayed via WebSocket, got: %q", received.String())
	}
}

// TestCleaner_PTYDestroyedAfterSessionStop verifies that after a fast-exit
// session stops and the Cleaner runs, the PTY session is no longer accessible.
func TestCleaner_PTYDestroyedAfterSessionStop(t *testing.T) {
	mgr, ptyMgr := newTestManagerWithPTY(t)

	name := uniqueSessionName(t)
	sess, err := mgr.Create(session.CreateRequest{
		AgentProfile: "fast-exit",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() { mgr.Destroy(sess.ID, true) })

	// Poll until the session transitions to stopped.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		got, getErr := mgr.Get(sess.ID)
		if getErr != nil {
			t.Fatalf("Get: %v", getErr)
		}
		if got.State == session.StateStopped {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	got, _ := mgr.Get(sess.ID)
	if got.State != session.StateStopped {
		t.Fatalf("expected session STOPPED within 5s, got state %d", got.State)
	}

	// Start a cleaner with zero TTL and a short interval so it fires quickly.
	cleanerInterval := 100 * time.Millisecond
	cleaner := session.NewCleaner(mgr, 0, cleanerInterval, 0, 0)
	cleaner.Start()
	defer cleaner.Stop()

	// Wait for the cleaner to run and destroy the session (and thus the PTY).
	deadline = time.Now().Add(3 * time.Second)
	sessionDestroyed := false
	for time.Now().Before(deadline) {
		_, getErr := mgr.Get(sess.ID)
		if getErr != nil {
			sessionDestroyed = true
			break
		}
		time.Sleep(cleanerInterval / 2)
	}

	if !sessionDestroyed {
		t.Fatal("expected session to be destroyed by cleaner within 3s")
	}

	// Verify the PTY is also gone — ReadBuffer should fail.
	_, ptyErr := ptyMgr.ReadBuffer(sess.ID)
	if ptyErr == nil {
		t.Error("expected PTY to be destroyed after cleaner ran, but ReadBuffer succeeded")
	}
}
