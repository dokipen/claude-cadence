package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/google/uuid"
)

// newManagerWithStore creates a Manager with a specific store and injectable
// PTY and process liveness functions, for tests that need to control the store.
func newManagerWithStore(store *Store, ptySessions map[string]bool, alivePIDs map[int]bool) *Manager {
	m := NewManager(store, nil, nil, nil, map[string]config.Profile{}, 0)
	m.ptyHasSession = func(id string) bool { return ptySessions[id] }
	m.processAlive = func(pid int) bool { return alivePIDs[pid] }
	return m
}

// makeSession creates a minimal Session with a new UUID and the given state.
func makeSession(state SessionState) *Session {
	return &Session{
		ID:           uuid.New().String(),
		Name:         "test-" + uuid.New().String()[:8],
		AgentProfile: "default",
		State:        state,
		CreatedAt:    time.Now().Truncate(time.Millisecond),
	}
}

// writeSessionFile directly writes a session file to dir (bypassing the
// Persister queue), useful for pre-populating test directories.
func writeSessionFile(t *testing.T, dir string, sess *Session) {
	t.Helper()
	data, err := json.Marshal(sessionToRecord(*sess))
	if err != nil {
		t.Fatalf("writeSessionFile: marshal: %v", err)
	}
	path := filepath.Join(dir, sess.ID+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatalf("writeSessionFile: write: %v", err)
	}
}

// countJSONFiles counts *.json files (excluding *.json.tmp) in dir.
func countJSONFiles(t *testing.T, dir string) int {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("countJSONFiles: ReadDir: %v", err)
	}
	n := 0
	for _, e := range entries {
		name := e.Name()
		if strings.HasSuffix(name, ".json") && !strings.HasSuffix(name, ".json.tmp") {
			n++
		}
	}
	return n
}

// --- Persister unit tests ---

func TestPersister_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}

	now := time.Now().Truncate(time.Millisecond)
	stoppedAt := now.Add(-1 * time.Minute)
	sess := &Session{
		ID:              uuid.New().String(),
		Name:            "round-trip-test",
		AgentProfile:    "my-profile",
		State:           StateStopped,
		CreatedAt:       now,
		StoppedAt:       stoppedAt,
		ErrorMessage:    "",
		AgentPID:        1234,
		WebsocketURL:    "ws://example.com/ws",
		WorktreePath:    "/tmp/worktree",
		RepoURL:         "https://github.com/example/repo",
		BaseRef:         "main",
		// Ephemeral fields — must NOT appear in JSON.
		WaitingForInput: true,
		IdleSince:       &now,
	}

	p.queue(*sess)
	p.Stop()

	sessions, err := p.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("LoadAll returned %d sessions, want 1", len(sessions))
	}

	got := sessions[0]

	if got.ID != sess.ID {
		t.Errorf("ID: got %q, want %q", got.ID, sess.ID)
	}
	if got.Name != sess.Name {
		t.Errorf("Name: got %q, want %q", got.Name, sess.Name)
	}
	if got.AgentProfile != sess.AgentProfile {
		t.Errorf("AgentProfile: got %q, want %q", got.AgentProfile, sess.AgentProfile)
	}
	if got.State != sess.State {
		t.Errorf("State: got %v, want %v", got.State, sess.State)
	}
	if !got.CreatedAt.Equal(sess.CreatedAt) {
		t.Errorf("CreatedAt: got %v, want %v", got.CreatedAt, sess.CreatedAt)
	}
	if !got.StoppedAt.Equal(sess.StoppedAt) {
		t.Errorf("StoppedAt: got %v, want %v", got.StoppedAt, sess.StoppedAt)
	}
	if got.AgentPID != sess.AgentPID {
		t.Errorf("AgentPID: got %d, want %d", got.AgentPID, sess.AgentPID)
	}
	if got.WebsocketURL != sess.WebsocketURL {
		t.Errorf("WebsocketURL: got %q, want %q", got.WebsocketURL, sess.WebsocketURL)
	}
	if got.WorktreePath != sess.WorktreePath {
		t.Errorf("WorktreePath: got %q, want %q", got.WorktreePath, sess.WorktreePath)
	}
	if got.RepoURL != sess.RepoURL {
		t.Errorf("RepoURL: got %q, want %q", got.RepoURL, sess.RepoURL)
	}
	if got.BaseRef != sess.BaseRef {
		t.Errorf("BaseRef: got %q, want %q", got.BaseRef, sess.BaseRef)
	}

	// Ephemeral fields must NOT be persisted: they should be zero after reload.
	if got.WaitingForInput {
		t.Error("WaitingForInput should not be persisted (expected false after reload)")
	}
	if got.IdleSince != nil {
		t.Error("IdleSince should not be persisted (expected nil after reload)")
	}

	// Verify the raw JSON does not contain the ephemeral field names.
	path := filepath.Join(dir, sess.ID+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if strings.Contains(string(raw), "waiting_for_input") {
		t.Error("JSON should not contain 'waiting_for_input'")
	}
	if strings.Contains(string(raw), "idle_since") {
		t.Error("JSON should not contain 'idle_since'")
	}
}

func TestPersister_Delete(t *testing.T) {
	dir := t.TempDir()

	// First persister: save a session.
	p1, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	sess := makeSession(StateStopped)
	p1.queue(*sess)
	p1.Stop()

	// Verify file exists.
	sessions, err := p1.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll after save: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session after save, got %d", len(sessions))
	}

	// Second persister on same dir: delete the session.
	p2, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister (second): %v", err)
	}
	p2.queueDelete(sess.ID)
	p2.Stop()

	// Verify no sessions remain.
	sessions, err = p2.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll after delete: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions after delete, got %d", len(sessions))
	}
}

func TestPersister_LoadAll_SkipsCorruptFiles(t *testing.T) {
	dir := t.TempDir()

	// Write a corrupt JSON file directly.
	corruptPath := filepath.Join(dir, uuid.New().String()+".json")
	if err := os.WriteFile(corruptPath, []byte("{not valid json!!!"), 0600); err != nil {
		t.Fatalf("WriteFile corrupt: %v", err)
	}

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	sessions, err := p.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll returned error for corrupt file, want nil: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("LoadAll returned %d sessions for corrupt file, want 0", len(sessions))
	}
}

func TestPersister_LoadAll_SkipsTmpFiles(t *testing.T) {
	dir := t.TempDir()

	// Write a .json.tmp file (orphaned atomic write).
	tmpPath := filepath.Join(dir, uuid.New().String()+".json.tmp")
	sess := makeSession(StateStopped)
	data, _ := json.Marshal(sessionToRecord(*sess))
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		t.Fatalf("WriteFile tmp: %v", err)
	}

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	sessions, err := p.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("LoadAll returned %d sessions for tmp file, want 0", len(sessions))
	}
}

func TestPersister_LoadAll_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	sessions, err := p.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll on empty dir: %v", err)
	}
	if sessions != nil {
		t.Errorf("LoadAll on empty dir returned %v, want nil", sessions)
	}
}

func TestPersister_Stop_FlushesQueue(t *testing.T) {
	dir := t.TempDir()
	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}

	const n = 50
	for i := 0; i < n; i++ {
		p.queue(*makeSession(StateStopped))
	}
	p.Stop()

	count := countJSONFiles(t, dir)
	if count != n {
		t.Errorf("expected %d files after flushing queue, got %d", n, count)
	}
}

func TestPersister_OrderingPreserved(t *testing.T) {
	dir := t.TempDir()
	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}

	sess := makeSession(StateStopped)
	// Queue a save immediately followed by a delete — ordering must be preserved.
	p.queue(*sess)
	p.queueDelete(sess.ID)
	p.Stop()

	// The delete was enqueued after the save, so the file must NOT exist.
	path := filepath.Join(dir, sess.ID+".json")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("expected file to not exist after queue(save)+queueDelete, but Stat returned: %v", err)
	}
}

// --- Store integration tests ---

func TestStore_PersistsOnAdd(t *testing.T) {
	dir := t.TempDir()
	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}

	store := NewStoreWithPersister(p)
	sess := makeSession(StateRunning)
	store.Add(sess)
	p.Stop()

	sessions, err := p.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 persisted session after Add, got %d", len(sessions))
	}
	if sessions[0].ID != sess.ID {
		t.Errorf("persisted session ID = %q, want %q", sessions[0].ID, sess.ID)
	}
}

func TestStore_PersistsOnUpdate(t *testing.T) {
	dir := t.TempDir()
	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}

	store := NewStoreWithPersister(p)
	sess := makeSession(StateCreating)
	store.Add(sess)

	// Update state to Running.
	store.Update(sess.ID, func(s *Session) {
		s.State = StateRunning
		s.AgentPID = 999
	})
	p.Stop()

	sessions, err := p.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].State != StateRunning {
		t.Errorf("persisted state = %v, want StateRunning", sessions[0].State)
	}
	if sessions[0].AgentPID != 999 {
		t.Errorf("persisted AgentPID = %d, want 999", sessions[0].AgentPID)
	}
}

func TestStore_DeleteRemovesFile(t *testing.T) {
	dir := t.TempDir()
	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}

	store := NewStoreWithPersister(p)
	sess := makeSession(StateStopped)
	store.Add(sess)

	// Flush the add before deleting so the file exists on disk.
	// We do this by stopping and re-creating the persister (simpler than polling).
	p.Stop()

	p2, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister p2: %v", err)
	}
	store2 := NewStoreWithPersister(p2)

	// Rebuild store2 with the session so Delete can find it.
	loaded, err := p2.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	for _, s := range loaded {
		store2.sessions[s.ID] = s // direct map write, same package
	}

	store2.Delete(sess.ID)
	p2.Stop()

	sessions, err := p2.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll after delete: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions after Delete, got %d", len(sessions))
	}
}

// --- Manager RestoreFromPersister tests ---

func TestRestoreFromPersister_Running_ProcessDead(t *testing.T) {
	dir := t.TempDir()

	sess := makeSession(StateRunning)
	sess.AgentPID = 999
	writeSessionFile(t, dir, sess)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	alivePIDs := map[int]bool{} // 999 is dead
	m := newManagerWithStore(store, map[string]bool{}, alivePIDs)

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	got, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateStopped {
		t.Errorf("State = %v, want StateStopped", got.State)
	}
	if got.StoppedAt.IsZero() {
		t.Error("StoppedAt should be non-zero after process-dead reconciliation")
	}
}

func TestRestoreFromPersister_Running_ProcessAlive(t *testing.T) {
	dir := t.TempDir()

	sess := makeSession(StateRunning)
	sess.AgentPID = 999
	writeSessionFile(t, dir, sess)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	alivePIDs := map[int]bool{999: true}
	m := newManagerWithStore(store, map[string]bool{}, alivePIDs)

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	got, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateRunning {
		t.Errorf("State = %v, want StateRunning", got.State)
	}
}

func TestRestoreFromPersister_Creating(t *testing.T) {
	dir := t.TempDir()

	// All StateCreating sessions become StateError on restore regardless of PID:
	// the daemon has no PTY handle to reconnect to, so the session is unrecoverable.
	sess := makeSession(StateCreating)
	sess.AgentPID = 0
	writeSessionFile(t, dir, sess)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	m := newManagerWithStore(store, map[string]bool{}, map[int]bool{})

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	got, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateError {
		t.Errorf("State = %v, want StateError", got.State)
	}
	if !strings.Contains(got.ErrorMessage, "daemon restart") {
		t.Errorf("ErrorMessage = %q, want it to contain 'daemon restart'", got.ErrorMessage)
	}
}

func TestRestoreFromPersister_Destroying(t *testing.T) {
	dir := t.TempDir()

	sess := makeSession(StateDestroying)
	writeSessionFile(t, dir, sess)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	m := newManagerWithStore(store, map[string]bool{}, map[int]bool{})

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	// Session must NOT be in the store.
	if _, ok := store.Get(sess.ID); ok {
		t.Error("StateDestroying session should not be in store after restore")
	}

	// JSON file must be deleted from disk.
	path := filepath.Join(dir, sess.ID+".json")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("expected JSON file to be deleted for StateDestroying session, Stat returned: %v", err)
	}
}

func TestRestoreFromPersister_Stopped(t *testing.T) {
	dir := t.TempDir()

	sess := makeSession(StateStopped)
	sess.StoppedAt = time.Now().Add(-10 * time.Minute)
	writeSessionFile(t, dir, sess)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	m := newManagerWithStore(store, map[string]bool{}, map[int]bool{})

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	got, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("StateStopped session should be in store after restore")
	}
	if got.State != StateStopped {
		t.Errorf("State = %v, want StateStopped", got.State)
	}
}

func TestRestoreFromPersister_Nil(t *testing.T) {
	store := NewStore()
	m := newManagerWithStore(store, map[string]bool{}, map[int]bool{})

	// Must not panic and must return nil.
	if err := m.RestoreFromPersister(nil); err != nil {
		t.Errorf("RestoreFromPersister(nil) = %v, want nil", err)
	}
}

// --- Integration test: daemon restart simulation ---

func TestDaemonRestart_Simulation(t *testing.T) {
	dir := t.TempDir()

	// Phase 1: Simulate running daemon with 3 sessions.
	p1, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister p1: %v", err)
	}

	store1 := NewStoreWithPersister(p1)
	// We don't need manager1 for creates here; Add directly for simplicity.

	sessRunning := makeSession(StateRunning)
	sessRunning.AgentPID = 42
	store1.Add(sessRunning)

	sessStopped := makeSession(StateStopped)
	sessStopped.StoppedAt = time.Now().Add(-30 * time.Minute)
	store1.Add(sessStopped)

	sessError := makeSession(StateError)
	sessError.ErrorMessage = "something broke"
	store1.Add(sessError)

	// Flush all writes.
	p1.Stop()

	// Verify 3 JSON files exist.
	count := countJSONFiles(t, dir)
	if count != 3 {
		t.Fatalf("expected 3 JSON files after p1.Stop(), got %d", count)
	}

	// Phase 2: Simulate daemon restart — process 42 is now dead.
	p2, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister p2: %v", err)
	}

	store2 := NewStoreWithPersister(p2)
	alivePIDs := map[int]bool{} // PID 42 is dead
	m2 := newManagerWithStore(store2, map[string]bool{}, alivePIDs)

	if err := m2.RestoreFromPersister(p2); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	// All 3 sessions should be in the store.
	allSessions := store2.List()
	if len(allSessions) != 3 {
		t.Fatalf("expected 3 sessions in store after restore, got %d", len(allSessions))
	}

	// The originally-Running session (PID 42, now dead) must be StateStopped.
	restoredRunning, ok := store2.Get(sessRunning.ID)
	if !ok {
		t.Fatalf("running session (pid=42) not found in store2 after restore")
	}
	if restoredRunning.State != StateStopped {
		t.Errorf("running session (pid=42) State = %v after restart, want StateStopped", restoredRunning.State)
	}

	// The Stopped and Error sessions must remain unchanged.
	restoredStopped, ok := store2.Get(sessStopped.ID)
	if !ok {
		t.Fatal("stopped session not found in store2 after restore")
	}
	if restoredStopped.State != StateStopped {
		t.Errorf("stopped session State = %v, want StateStopped", restoredStopped.State)
	}

	restoredError, ok := store2.Get(sessError.ID)
	if !ok {
		t.Fatal("error session not found in store2 after restore")
	}
	if restoredError.State != StateError {
		t.Errorf("error session State = %v, want StateError", restoredError.State)
	}

	p2.Stop()
}
