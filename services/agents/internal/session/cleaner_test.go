package session

import (
	"testing"
	"time"
)

// newTestManager creates a Manager wired with fake tmux and process liveness
// functions, suitable for unit tests that don't need real tmux or syscall.
func newTestManager(tmuxSessions map[string]bool, alivePIDs map[int]bool) *Manager {
	store := NewStore()
	m := &Manager{
		store:          store,
		tmuxHasSession: func(name string) bool { return tmuxSessions[name] },
		processAlive:   func(pid int) bool { return alivePIDs[pid] },
	}
	return m
}

func TestCleaner_ImmediateDestroyOnProcessExit(t *testing.T) {
	// Session is Running with a dead PID and an existing tmux session.
	// Cleaner should destroy it immediately (not wait for TTL).
	tmuxSessions := map[string]bool{"tmux-1": true}
	alivePIDs := map[int]bool{} // PID 42 is not alive

	m := newTestManager(tmuxSessions, alivePIDs)
	sess := &Session{
		ID:          "sess-1",
		Name:        "test-1",
		State:       StateRunning,
		TmuxSession: "tmux-1",
		AgentPID:    42,
		CreatedAt:   time.Now().Add(-5 * time.Minute),
		StoppedAt:   time.Time{}, // not stopped yet
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup()

	// Session should be gone from the store.
	if _, ok := m.store.Get("sess-1"); ok {
		t.Error("expected session to be destroyed, but it still exists in the store")
	}
}

func TestCleaner_ImmediateDestroyOnTmuxGone(t *testing.T) {
	// Session is Running but the tmux session is gone (e.g., daemon restart killed it).
	// Cleaner should destroy it immediately.
	tmuxSessions := map[string]bool{} // tmux-1 is gone
	alivePIDs := map[int]bool{42: true}

	m := newTestManager(tmuxSessions, alivePIDs)
	sess := &Session{
		ID:          "sess-2",
		Name:        "test-2",
		State:       StateRunning,
		TmuxSession: "tmux-1",
		AgentPID:    42,
		CreatedAt:   time.Now().Add(-5 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-2"); ok {
		t.Error("expected session to be destroyed when tmux session is gone, but it still exists")
	}
}

func TestCleaner_ImmediateDestroyOnCreatingProcessExit(t *testing.T) {
	// Session is in StateCreating (not yet fully running) but process died.
	tmuxSessions := map[string]bool{"tmux-3": true}
	alivePIDs := map[int]bool{} // PID 99 not alive

	m := newTestManager(tmuxSessions, alivePIDs)
	sess := &Session{
		ID:          "sess-3",
		Name:        "test-3",
		State:       StateCreating,
		TmuxSession: "tmux-3",
		AgentPID:    99,
		CreatedAt:   time.Now().Add(-1 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-3"); ok {
		t.Error("expected StateCreating session with dead process to be destroyed")
	}
}

func TestCleaner_SkipsRunningSessionWithAliveProcess(t *testing.T) {
	// Session is Running with an alive PID — should NOT be destroyed.
	tmuxSessions := map[string]bool{"tmux-4": true}
	alivePIDs := map[int]bool{100: true}

	m := newTestManager(tmuxSessions, alivePIDs)
	sess := &Session{
		ID:          "sess-4",
		Name:        "test-4",
		State:       StateRunning,
		TmuxSession: "tmux-4",
		AgentPID:    100,
		CreatedAt:   time.Now().Add(-5 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-4"); !ok {
		t.Error("expected running session with alive process to NOT be destroyed")
	}
}

func TestCleaner_DestroysStoppedSessionPastTTL(t *testing.T) {
	// Session is already Stopped and has been for longer than the TTL.
	// Cleaner should destroy it.
	m := newTestManager(nil, nil)
	stoppedAt := time.Now().Add(-2 * time.Hour)
	sess := &Session{
		ID:        "sess-5",
		Name:      "test-5",
		State:     StateStopped,
		CreatedAt: stoppedAt.Add(-10 * time.Minute),
		StoppedAt: stoppedAt,
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-5"); ok {
		t.Error("expected stale stopped session to be destroyed past TTL")
	}
}

func TestCleaner_SkipsStoppedSessionWithinTTL(t *testing.T) {
	// Session is Stopped but within the TTL — should NOT be destroyed.
	m := newTestManager(nil, nil)
	sess := &Session{
		ID:        "sess-6",
		Name:      "test-6",
		State:     StateStopped,
		CreatedAt: time.Now().Add(-30 * time.Minute),
		StoppedAt: time.Now().Add(-10 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-6"); !ok {
		t.Error("expected stopped session within TTL to NOT be destroyed")
	}
}

func TestCleaner_DestroysErrorSessionPastTTL(t *testing.T) {
	// Session is in StateError and older than the TTL — should be destroyed.
	m := newTestManager(nil, nil)
	sess := &Session{
		ID:        "sess-7",
		Name:      "test-7",
		State:     StateError,
		CreatedAt: time.Now().Add(-3 * time.Hour),
		// StoppedAt is zero (error sessions may not set it) — falls back to CreatedAt
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-7"); ok {
		t.Error("expected stale error session to be destroyed past TTL")
	}
}

func TestCleaner_SkipsErrorSessionWithinTTL(t *testing.T) {
	// Session is in StateError but within the TTL — should NOT be destroyed.
	m := newTestManager(nil, nil)
	sess := &Session{
		ID:        "sess-8",
		Name:      "test-8",
		State:     StateError,
		CreatedAt: time.Now().Add(-30 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-8"); !ok {
		t.Error("expected error session within TTL to NOT be destroyed")
	}
}

func TestCleaner_EmptyStoreNoOp(t *testing.T) {
	// Empty store should not panic.
	m := newTestManager(nil, nil)
	cleaner := NewCleaner(m, time.Hour, time.Minute)
	cleaner.cleanup() // must not panic
}

func TestCleaner_StartStop(t *testing.T) {
	// Start and Stop should not block or panic.
	m := newTestManager(nil, nil)
	cleaner := NewCleaner(m, time.Hour, 10*time.Millisecond)
	cleaner.Start()
	cleaner.Stop() // must return promptly
}
