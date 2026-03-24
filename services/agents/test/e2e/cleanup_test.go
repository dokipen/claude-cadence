package e2e_test

import (
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

// newTestManager creates an isolated Manager with its own Store for test isolation.
func newTestManager(t *testing.T) (*session.Manager, *session.Store) {
	t.Helper()
	profiles := map[string]config.Profile{
		"sleeper":   {Command: "sleep 3600"},
		"fast-exit": {Command: "true"},
	}
	store := session.NewStore()
	ptyManager := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	mgr := session.NewManager(store, ptyManager, nil, nil, profiles, 0)
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
	cleaner := session.NewCleaner(mgr, 0, 100*time.Millisecond, 0, 0)
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
	cleaner := session.NewCleaner(mgr, 0, 100*time.Millisecond, 0, 0)
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
