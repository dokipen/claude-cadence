package session

import (
	"testing"
	"time"
)

// newTestManager creates a Manager wired with fake PTY and process liveness
// functions, suitable for unit tests that don't need a real PTY or syscall.
// ptySessions maps session IDs to whether they are "alive" in the PTY manager.
func newTestManager(ptySessions map[string]bool, alivePIDs map[int]bool) *Manager {
	store := NewStore()
	m := &Manager{
		store:         store,
		ptyHasSession: func(id string) bool { return ptySessions[id] },
		processAlive:  func(pid int) bool { return alivePIDs[pid] },
	}
	return m
}

func TestCleaner_ImmediateDestroyOnProcessExit(t *testing.T) {
	// Session is Running with a dead PID and an existing PTY session.
	// Cleaner should destroy it immediately (not wait for TTL).
	ptySessions := map[string]bool{"sess-1": true}
	alivePIDs := map[int]bool{} // PID 42 is not alive

	m := newTestManager(ptySessions, alivePIDs)
	sess := &Session{
		ID:       "sess-1",
		Name:     "test-1",
		State:    StateRunning,
		AgentPID: 42,
		CreatedAt:   time.Now().Add(-5 * time.Minute),
		StoppedAt:   time.Time{}, // not stopped yet
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
	cleaner.cleanup()

	// Session should be gone from the store.
	if _, ok := m.store.Get("sess-1"); ok {
		t.Error("expected session to be destroyed, but it still exists in the store")
	}
}

func TestCleaner_ImmediateDestroyOnPTYGone(t *testing.T) {
	// Session is Running but the PTY session is gone (e.g., daemon restart killed it).
	// Cleaner should destroy it immediately.
	ptySessions := map[string]bool{} // sess-2 is not in PTY manager
	alivePIDs := map[int]bool{42: true}

	m := newTestManager(ptySessions, alivePIDs)
	sess := &Session{
		ID:        "sess-2",
		Name:      "test-2",
		State:     StateRunning,
		AgentPID:  42,
		CreatedAt: time.Now().Add(-5 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-2"); ok {
		t.Error("expected session to be destroyed when PTY session is gone, but it still exists")
	}
}

func TestCleaner_ImmediateDestroyOnCreatingProcessExit(t *testing.T) {
	// Session is in StateCreating (not yet fully running) but process died.
	ptySessions := map[string]bool{"sess-3": true}
	alivePIDs := map[int]bool{} // PID 99 not alive

	m := newTestManager(ptySessions, alivePIDs)
	sess := &Session{
		ID:        "sess-3",
		Name:      "test-3",
		State:     StateCreating,
		AgentPID:  99,
		CreatedAt:   time.Now().Add(-1 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-3"); ok {
		t.Error("expected StateCreating session with dead process to be destroyed")
	}
}

func TestCleaner_SkipsRunningSessionWithAliveProcess(t *testing.T) {
	// Session is Running with an alive PID — should NOT be destroyed.
	ptySessions := map[string]bool{"sess-4": true}
	alivePIDs := map[int]bool{100: true}

	m := newTestManager(ptySessions, alivePIDs)
	sess := &Session{
		ID:       "sess-4",
		Name:     "test-4",
		State:    StateRunning,
		AgentPID: 100,
		CreatedAt:   time.Now().Add(-5 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
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

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
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

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
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

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
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

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-8"); !ok {
		t.Error("expected error session within TTL to NOT be destroyed")
	}
}

func TestCleaner_EmptyStoreNoOp(t *testing.T) {
	// Empty store should not panic.
	m := newTestManager(nil, nil)
	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
	cleaner.cleanup() // must not panic
}

func TestCleaner_StartStop(t *testing.T) {
	// Start and Stop should not block or panic.
	m := newTestManager(nil, nil)
	cleaner := NewCleaner(m, time.Hour, 10*time.Millisecond, 0, 0)
	cleaner.Start()
	cleaner.Stop() // must return promptly
}

func TestCleaner_SkipsCreatingSessionWithNoPTY(t *testing.T) {
	// Session is in StateCreating with AgentPID 0 and no PTY entry — simulating
	// the window between store.Add() and PTY creation inside manager.Create().
	// The cleaner must not touch it; destroying it here would cause mustGet()
	// to return an error when Create() later calls it.
	ptySessions := map[string]bool{} // sess-race is NOT in PTY manager yet
	alivePIDs := map[int]bool{}      // PID 0 is NOT alive

	m := newTestManager(ptySessions, alivePIDs)
	sess := &Session{
		ID:        "sess-race",
		Name:      "test-race",
		State:     StateCreating,
		AgentPID:  0,
		CreatedAt: time.Now().Add(-1 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0)
	cleaner.cleanup()

	// Session must still be present — cleaner should have skipped it entirely.
	if _, ok := m.store.Get("sess-race"); !ok {
		t.Error("expected StateCreating session with no PTY and PID 0 to be skipped by cleaner, but it was destroyed")
	}
}

func TestCleaner_SkipsCreatingSessionWithinTimeout(t *testing.T) {
	// StateCreating + PID==0, session age < TTL — must NOT be reaped.
	m := newTestManager(nil, nil)
	sess := &Session{
		ID:        "sess-ttl-within",
		Name:      "test-ttl-within",
		State:     StateCreating,
		AgentPID:  0,
		CreatedAt: time.Now().Add(-30 * time.Second), // 30s old
	}
	m.store.Add(sess)

	ttl := time.Minute // 30s old < 1m TTL
	cleaner := NewCleaner(m, time.Hour, time.Minute, ttl, 0)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-ttl-within"); !ok {
		t.Error("expected StateCreating session within TTL to NOT be reaped")
	}
}

func TestCleaner_ReapsCreatingSessionPastTimeout(t *testing.T) {
	// StateCreating + PID==0, session age > TTL — must be transitioned to StateError.
	m := newTestManager(nil, nil)
	ttl := time.Minute
	sess := &Session{
		ID:        "sess-ttl-past",
		Name:      "test-ttl-past",
		State:     StateCreating,
		AgentPID:  0,
		CreatedAt: time.Now().Add(-2 * ttl), // 2× TTL old — should be reaped
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, ttl, 0)
	cleaner.cleanup()

	// Session must still exist in store (transitioned, not deleted).
	updated, ok := m.store.Get("sess-ttl-past")
	if !ok {
		t.Fatal("expected session to remain in store after reaping, but it was deleted")
	}
	if updated.State != StateError {
		t.Errorf("session.State = %v, want StateError", updated.State)
	}
}

func TestCleaner_SkipsCreatingSessionWhenTTLDisabled(t *testing.T) {
	// StateCreating + PID==0, very old session, but creatingSessionTTL == 0 — must NOT be reaped.
	m := newTestManager(nil, nil)
	sess := &Session{
		ID:        "sess-ttl-disabled",
		Name:      "test-ttl-disabled",
		State:     StateCreating,
		AgentPID:  0,
		CreatedAt: time.Now().Add(-24 * time.Hour), // very old
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0) // 0 = TTL disabled
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-ttl-disabled"); !ok {
		t.Error("expected StateCreating session to NOT be reaped when creatingSessionTTL is disabled (0)")
	}
}

func TestCleaner_ReapsErrorSessionPastErrorTTL(t *testing.T) {
	// StateError session older than errorSessionTTL — should be destroyed.
	m := newTestManager(nil, nil)
	errorTTL := 5 * time.Minute
	sess := &Session{
		ID:        "sess-err-ttl-past",
		Name:      "test-err-ttl-past",
		State:     StateError,
		CreatedAt: time.Now().Add(-2 * errorTTL),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, errorTTL)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-err-ttl-past"); ok {
		t.Error("expected StateError session past errorSessionTTL to be destroyed")
	}
}

func TestCleaner_SkipsErrorSessionWithinErrorTTL(t *testing.T) {
	// StateError session within errorSessionTTL — should NOT be destroyed.
	m := newTestManager(nil, nil)
	errorTTL := time.Hour
	sess := &Session{
		ID:        "sess-err-ttl-within",
		Name:      "test-err-ttl-within",
		State:     StateError,
		CreatedAt: time.Now().Add(-30 * time.Minute),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, errorTTL)
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-err-ttl-within"); !ok {
		t.Error("expected StateError session within errorSessionTTL to NOT be destroyed")
	}
}

func TestCleaner_ErrorTTLDisabledFallsBackToStaleTTL(t *testing.T) {
	// errorSessionTTL == 0 (disabled): StateError falls back to stale TTL.
	// Session is past the stale TTL — should be destroyed.
	m := newTestManager(nil, nil)
	sess := &Session{
		ID:        "sess-err-ttl-disabled",
		Name:      "test-err-ttl-disabled",
		State:     StateError,
		CreatedAt: time.Now().Add(-2 * time.Hour),
	}
	m.store.Add(sess)

	cleaner := NewCleaner(m, time.Hour, time.Minute, 0, 0) // errorTTL disabled
	cleaner.cleanup()

	if _, ok := m.store.Get("sess-err-ttl-disabled"); ok {
		t.Error("expected StateError session past stale TTL to be destroyed when errorSessionTTL is disabled")
	}
}
