package e2e_test

import (
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
	"github.com/dokipen/claude-cadence/services/agents/internal/tmux"
	"github.com/dokipen/claude-cadence/services/agents/internal/ttyd"
)

const testSocket = "agentd-test"

// newTestManager creates an isolated Manager with its own Store for test isolation.
func newTestManager(t *testing.T) (*session.Manager, *session.Store) {
	t.Helper()
	profiles := map[string]config.Profile{
		"sleeper":   {Command: "sleep 3600"},
		"fast-exit": {Command: "true"},
	}
	store := session.NewStore()
	tmuxClient := tmux.NewClient(testSocket)
	ttydClient := ttyd.NewClient(false, 0, 100, "", "")
	mgr := session.NewManager(store, tmuxClient, ttydClient, nil, nil, profiles)
	return mgr, store
}

func TestCleanup_StaleSessionDestroyed(t *testing.T) {
	mgr, _ := newTestManager(t)

	// Create a fast-exit session that will quickly stop.
	name := uniqueSessionName(t)
	sess, err := mgr.Create(session.CreateRequest{
		AgentProfile: "fast-exit",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Cleanup(func() {
		// Best-effort cleanup in case test fails before destroy.
		mgr.Destroy(sess.ID, true)
	})

	// Wait for session to stop (fast-exit should exit quickly).
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		got, err := mgr.Get(sess.ID)
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		if got.State == session.StateStopped {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}

	// Verify it's stopped.
	got, err := mgr.Get(sess.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.State != session.StateStopped {
		t.Fatalf("expected STOPPED, got %d", got.State)
	}

	// Start a cleaner with a very short TTL (the session just stopped, so set TTL to 0).
	cleaner := session.NewCleaner(mgr, 0, 100*time.Millisecond)
	cleaner.Start()
	defer cleaner.Stop()

	// Wait for the cleaner to run and destroy the stale session.
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, err := mgr.Get(sess.ID)
		if err != nil {
			// Session was destroyed — success.
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Error("expected stale session to be destroyed by cleaner within 3s")
}

func TestCleanup_RunningSessionNotDestroyed(t *testing.T) {
	mgr, _ := newTestManager(t)

	name := uniqueSessionName(t)
	sess, err := mgr.Create(session.CreateRequest{
		AgentProfile: "sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Cleanup(func() {
		mgr.Destroy(sess.ID, true)
	})

	// Start a cleaner with zero TTL — should NOT destroy running sessions.
	cleaner := session.NewCleaner(mgr, 0, 100*time.Millisecond)
	cleaner.Start()

	// Let the cleaner run a few cycles.
	time.Sleep(500 * time.Millisecond)
	cleaner.Stop()

	// Session should still exist and be running.
	got, err := mgr.Get(sess.ID)
	if err != nil {
		t.Fatalf("expected session to still exist, got error: %v", err)
	}
	if got.State != session.StateRunning {
		t.Errorf("expected RUNNING, got %d", got.State)
	}
}

func TestRecoverSessions_RediscoversRunning(t *testing.T) {
	// Create a tmux session directly (simulating a daemon restart with orphaned sessions).
	name := uniqueSessionName(t)
	cmd := exec.Command("tmux", "-L", testSocket, "new-session", "-d", "-s", name, "sleep", "3600")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to create tmux session: %v: %s", err, out)
	}

	t.Cleanup(func() {
		exec.Command("tmux", "-L", testSocket, "kill-session", "-t", name).Run()
	})

	// Create a fresh manager (simulating restart — empty store).
	mgr, store := newTestManager(t)

	// The store should be empty.
	if sessions := store.List(); len(sessions) != 0 {
		t.Fatalf("expected empty store, got %d sessions", len(sessions))
	}

	// Recover sessions.
	recovered, err := mgr.RecoverSessions()
	if err != nil {
		t.Fatalf("RecoverSessions: %v", err)
	}
	if recovered < 1 {
		t.Fatalf("expected at least 1 recovered session, got %d", recovered)
	}

	// Find our session in the store by name.
	sess, ok := store.GetByName(name)
	if !ok {
		t.Fatalf("expected recovered session %q in store", name)
	}
	if sess.State != session.StateRunning {
		t.Errorf("expected RUNNING for recovered session, got %d", sess.State)
	}
}

func TestRecoverSessions_RediscoversStopped(t *testing.T) {
	// Create a tmux session with a sleep process, then kill the process.
	// This leaves the tmux session alive but with a dead process — the stopped state.
	name := uniqueSessionName(t)
	cmd := exec.Command("tmux", "-L", testSocket, "new-session", "-d", "-s", name, "sleep", "3600")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to create tmux session: %v: %s", err, out)
	}

	// Set remain-on-exit so the tmux session persists after the process is killed.
	exec.Command("tmux", "-L", testSocket, "set-option", "-t", name, "remain-on-exit", "on").Run()

	t.Cleanup(func() {
		exec.Command("tmux", "-L", testSocket, "kill-session", "-t", name).Run()
	})

	// Get the pane PID and kill it, leaving the tmux session orphaned.
	pidOut, err := exec.Command("tmux", "-L", testSocket, "list-panes", "-t", name, "-F", "#{pane_pid}").Output()
	if err != nil {
		t.Fatalf("failed to get pane PID: %v", err)
	}

	// Kill the sleep process. Use SIGKILL to ensure it dies immediately.
	pidStr := strings.TrimSpace(string(pidOut))
	killCmd := exec.Command("kill", "-9", pidStr)
	if out, err := killCmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to kill process %s: %v: %s", pidStr, err, out)
	}

	// Wait briefly for the process to die.
	time.Sleep(500 * time.Millisecond)

	// Verify the tmux session still exists.
	if !tmuxSessionExists(testSocket, name) {
		t.Skip("tmux session was auto-destroyed after process kill; skipping")
	}

	// Create a fresh manager.
	mgr, store := newTestManager(t)

	recovered, err := mgr.RecoverSessions()
	if err != nil {
		t.Fatalf("RecoverSessions: %v", err)
	}
	if recovered < 1 {
		t.Fatalf("expected at least 1 recovered session, got %d", recovered)
	}

	sess, ok := store.GetByName(name)
	if !ok {
		t.Fatalf("expected recovered session %q in store", name)
	}
	if sess.State != session.StateStopped {
		t.Errorf("expected STOPPED for recovered session with dead process, got %d", sess.State)
	}
	if sess.StoppedAt.IsZero() {
		t.Error("expected non-zero StoppedAt for stopped recovered session")
	}
}
