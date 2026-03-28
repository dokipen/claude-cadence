package session

import (
	"encoding/json"
	"fmt"
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
		PTYSlavePath:    "/dev/pts/42",
		// Ephemeral fields — must NOT appear in JSON.
		WaitingForInput: true,
		IdleSince:       &now,
		PromptContext:   "$ git status\nnothing to commit",
		PromptType:      "shell",
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
	if got.PTYSlavePath != sess.PTYSlavePath {
		t.Errorf("PTYSlavePath: got %q, want %q", got.PTYSlavePath, sess.PTYSlavePath)
	}

	// Ephemeral fields must NOT be persisted: they should be zero after reload.
	if got.WaitingForInput {
		t.Error("WaitingForInput should not be persisted (expected false after reload)")
	}
	if got.IdleSince != nil {
		t.Error("IdleSince should not be persisted (expected nil after reload)")
	}
	if got.PromptContext != "" {
		t.Errorf("PromptContext should not be persisted (expected empty after reload, got %q)", got.PromptContext)
	}
	if got.PromptType != "" {
		t.Errorf("PromptType should not be persisted (expected empty after reload, got %q)", got.PromptType)
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
	if strings.Contains(string(raw), "prompt_context") {
		t.Error("JSON should not contain 'prompt_context'")
	}
	if strings.Contains(string(raw), "prompt_type") {
		t.Error("JSON should not contain 'prompt_type'")
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

func TestLoadAll_DeletesTmpFiles(t *testing.T) {
	dir := t.TempDir()

	// Write a .json.tmp file (simulate unclean shutdown orphan).
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

	// The tmp file is not a real session — no sessions should be loaded.
	if len(sessions) != 0 {
		t.Errorf("LoadAll returned %d sessions for tmp file, want 0", len(sessions))
	}

	// The tmp file must be deleted from disk.
	if _, statErr := os.Stat(tmpPath); !os.IsNotExist(statErr) {
		t.Errorf("expected tmp file to be deleted after LoadAll, but it still exists")
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

func TestRestoreFromPersister_DuplicateName(t *testing.T) {
	dir := t.TempDir()

	// Create two sessions with different IDs but the same name.
	sess1 := makeSession(StateStopped)
	sess2 := makeSession(StateStopped)
	sess2.Name = sess1.Name // same name, different IDs

	writeSessionFile(t, dir, sess1)
	writeSessionFile(t, dir, sess2)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	m := newManagerWithStore(store, map[string]bool{}, map[int]bool{})

	// RestoreFromPersister must return nil — skipping a duplicate is a
	// recovery behavior, not a fatal error.
	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister returned unexpected error: %v", err)
	}

	// Exactly one session should be stored for this name — the duplicate
	// must have been rejected, not silently inserted.
	all := store.List()
	if len(all) != 1 {
		t.Errorf("store contains %d sessions, want 1 (duplicate name should be skipped)", len(all))
	}

	// The single stored session must be retrievable by name.
	_, ok := store.GetByName(sess1.Name)
	if !ok {
		t.Errorf("GetByName(%q) returned false, want true", sess1.Name)
	}
}


func TestRestoreFromPersister_InvalidName(t *testing.T) {
	dir := t.TempDir()

	// Session with an invalid name (contains a space and control character).
	invalid := makeSession(StateStopped)
	invalid.Name = "bad name\x01"

	// Session with a valid name — must still be restored correctly.
	valid := makeSession(StateStopped)

	writeSessionFile(t, dir, invalid)
	writeSessionFile(t, dir, valid)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	m := newManagerWithStore(store, map[string]bool{}, map[int]bool{})

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister returned unexpected error: %v", err)
	}

	all := store.List()
	if len(all) != 1 {
		t.Errorf("store contains %d sessions, want 1 (invalid name should be skipped)", len(all))
	}

	if _, ok := store.Get(valid.ID); !ok {
		t.Errorf("valid session %q not found in store", valid.ID)
	}
	if _, ok := store.Get(invalid.ID); ok {
		t.Errorf("session with invalid name %q must not be in store", invalid.Name)
	}
}

func TestRestoreFromPersister_NameTooLong(t *testing.T) {
	dir := t.TempDir()

	// Session with a name of 256 characters — valid chars but over the length cap.
	tooLong := makeSession(StateStopped)
	tooLong.Name = strings.Repeat("a", 256)

	// Session with a valid name — must still be restored correctly.
	valid := makeSession(StateStopped)

	writeSessionFile(t, dir, tooLong)
	writeSessionFile(t, dir, valid)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	m := newManagerWithStore(store, map[string]bool{}, map[int]bool{})

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister returned unexpected error: %v", err)
	}

	all := store.List()
	if len(all) != 1 {
		t.Errorf("store contains %d sessions, want 1 (too-long name should be skipped)", len(all))
	}

	if _, ok := store.Get(valid.ID); !ok {
		t.Errorf("valid session %q not found in store", valid.ID)
	}
	if _, ok := store.Get(tooLong.ID); ok {
		t.Errorf("session with 256-char name must not be in store")
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

// --- Bug reproduction tests for issue #366: sessions lost on agentd restart ---

// TestRestoreFromPersister_Creating_StatePersisted reproduces Bug 1:
// A StateCreating session reconciled to StateError during RestoreFromPersister
// must be written back to disk. Because TryAdd does not call the persister,
// a second restart would reload the session as StateCreating instead of StateError.
func TestRestoreFromPersister_Creating_StatePersisted(t *testing.T) {
	dir := t.TempDir()

	// Write a StateCreating session directly to disk (simulating a crash mid-create).
	sess := makeSession(StateCreating)
	sess.AgentPID = 0
	writeSessionFile(t, dir, sess)

	// First "boot": restore from persister. This should reconcile to StateError.
	p1, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister p1: %v", err)
	}

	store1 := NewStoreWithPersister(p1)
	m1 := newManagerWithStore(store1, map[string]bool{}, map[int]bool{})

	if err := m1.RestoreFromPersister(p1); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	// Confirm the in-memory state is StateError.
	got, ok := store1.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateError {
		t.Fatalf("expected in-memory state StateError, got %v", got.State)
	}

	// Flush all pending writes to disk.
	p1.Stop()

	// Second "boot": reload files from disk. The file should now show StateError.
	p2, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister p2: %v", err)
	}
	defer p2.Stop()

	sessions, err := p2.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll after second boot: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session on disk, got %d", len(sessions))
	}

	// BUG: TryAdd never calls the persister, so the file still has StateCreating.
	// This assertion will FAIL until the bug is fixed.
	if sessions[0].State != StateError {
		t.Errorf("on-disk state = %v, want StateError (bug: reconciled state not persisted)", sessions[0].State)
	}
}

// TestRestoreFromPersister_Running_DeadProcess_StatePersisted reproduces Bug 1
// for the StateRunning→StateStopped transition: after a second restart the
// session should still be StateStopped, not re-appear as StateRunning.
func TestRestoreFromPersister_Running_DeadProcess_StatePersisted(t *testing.T) {
	dir := t.TempDir()

	// Write a StateRunning session with a dead PID.
	sess := makeSession(StateRunning)
	sess.AgentPID = 999999 // assumed dead
	writeSessionFile(t, dir, sess)

	// First "boot": restore. Dead PID → StateStopped.
	p1, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister p1: %v", err)
	}

	store1 := NewStoreWithPersister(p1)
	alivePIDs := map[int]bool{} // 999999 is dead
	m1 := newManagerWithStore(store1, map[string]bool{}, alivePIDs)

	if err := m1.RestoreFromPersister(p1); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	// Confirm in-memory state is StateStopped.
	got, ok := store1.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateStopped {
		t.Fatalf("expected in-memory state StateStopped, got %v", got.State)
	}

	// Flush all pending writes.
	p1.Stop()

	// Second "boot": reload. File must reflect StateStopped.
	p2, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister p2: %v", err)
	}
	defer p2.Stop()

	sessions, err := p2.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll after second boot: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session on disk, got %d", len(sessions))
	}

	// BUG: TryAdd never calls the persister, so the file still has StateRunning.
	// This assertion will FAIL until the bug is fixed.
	if sessions[0].State != StateStopped {
		t.Errorf("on-disk state = %v, want StateStopped (bug: reconciled state not persisted)", sessions[0].State)
	}
}

// TestRestoreFromPersister_Running_AliveProcess_SurvivesGet reproduces Bug 2:
// A StateRunning session with a live process is correctly restored as StateRunning,
// but the first call to manager.Get() immediately transitions it to StateStopped
// because reconcile() checks ptyHasSession first — which returns false after a
// restart since there is no PTY handle.
func TestRestoreFromPersister_Running_AliveProcess_SurvivesGet(t *testing.T) {
	dir := t.TempDir()

	// Write a StateRunning session with an "alive" PID.
	sess := makeSession(StateRunning)
	sess.AgentPID = 42
	writeSessionFile(t, dir, sess)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStoreWithPersister(p)
	// Process 42 is alive, but there is no PTY handle after restart.
	alivePIDs := map[int]bool{42: true}
	ptySessions := map[string]bool{} // no PTY — simulates post-restart state
	m := newManagerWithStore(store, ptySessions, alivePIDs)

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	// After restore the session should be StateRunning in memory.
	inStore, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if inStore.State != StateRunning {
		t.Fatalf("expected in-memory state StateRunning after restore, got %v", inStore.State)
	}

	// Now call Get — this triggers reconcile(). With the bug, reconcile() sees
	// ptyHasSession==false and immediately sets state to StateStopped, undoing
	// the restore.
	//
	// BUG: this assertion will FAIL until Bug 2 is fixed.
	retrieved, err := m.Get(sess.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if retrieved.State != StateRunning {
		t.Errorf("after Get, state = %v, want StateRunning (bug: reconcile() kills restored sessions with no PTY)", retrieved.State)
	}
}

// TestRestoreFromPersister_Creating_NonZeroPID_KillsProcess reproduces Bug 3:
// A StateCreating session with a non-zero AgentPID may have an orphaned process
// still running. RestoreFromPersister must kill that process, but currently it
// only marks the session as StateError without sending any signal.
func TestRestoreFromPersister_Creating_NonZeroPID_KillsProcess(t *testing.T) {
	dir := t.TempDir()

	// Write a StateCreating session with a non-zero PID (process may be alive).
	sess := makeSession(StateCreating)
	sess.AgentPID = 42
	writeSessionFile(t, dir, sess)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	// PID 42 is alive.
	alivePIDs := map[int]bool{42: true}
	m := newManagerWithStore(store, map[string]bool{}, alivePIDs)

	// Track whether killProcess was called and with which PID.
	var killedPID int
	m.killProcess = func(pid int) error {
		killedPID = pid
		return nil
	}

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	// BUG: RestoreFromPersister never calls killProcess, so killedPID remains 0.
	// This assertion will FAIL until Bug 3 is fixed.
	if killedPID != 42 {
		t.Errorf("killProcess called with PID %d, want 42 (bug: orphaned process not killed during StateCreating restore)", killedPID)
	}
}

// TestRestoreFromPersister_Running_AlivePID_PTYReconnected tests that when a
// running session has an alive PID and a non-empty PTYSlavePath, RestoreFromPersister
// calls ptyReconnect and, on success, leaves restoredFromDisk as false (PTY is live).
func TestRestoreFromPersister_Running_AlivePID_PTYReconnected(t *testing.T) {
	dir := t.TempDir()

	sess := makeSession(StateRunning)
	sess.AgentPID = 999
	sess.PTYSlavePath = "/dev/pts/7"

	// Write JSON manually so PTYSlavePath is included even before sessionRecord
	// gains the field (the fix will add it; until then this raw JSON simulates
	// what the fixed persister would have written).
	rawJSON := []byte(`{"id":"` + sess.ID + `","name":"` + sess.Name + `","agent_profile":"default","state":2,"created_at":"` + sess.CreatedAt.Format("2006-01-02T15:04:05.999999999Z07:00") + `","stopped_at":"0001-01-01T00:00:00Z","agent_pid":999,"pty_slave_path":"/dev/pts/7"}`)
	if err := os.WriteFile(filepath.Join(dir, sess.ID+".json"), rawJSON, 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	alivePIDs := map[int]bool{999: true}
	m := newManagerWithStore(store, map[string]bool{}, alivePIDs)

	var reconnectCalledID string
	var reconnectCalledPath string
	m.ptyReconnect = func(id, slavePath string) error {
		reconnectCalledID = id
		reconnectCalledPath = slavePath
		return nil
	}

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	if reconnectCalledID != sess.ID {
		t.Errorf("ptyReconnect called with id %q, want %q", reconnectCalledID, sess.ID)
	}
	if reconnectCalledPath != "/dev/pts/7" {
		t.Errorf("ptyReconnect called with slavePath %q, want %q", reconnectCalledPath, "/dev/pts/7")
	}

	got, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateRunning {
		t.Errorf("State = %v, want StateRunning", got.State)
	}
	// PTY reconnect succeeded: restoredFromDisk must be false (PTY handle is live).
	if got.restoredFromDisk {
		t.Error("restoredFromDisk = true, want false (ptyReconnect succeeded, PTY is live)")
	}
}

// TestRestoreFromPersister_Running_AlivePID_PTYReconnectFails tests that when a
// running session has an alive PID and PTYSlavePath, but ptyReconnect returns an
// error (e.g. slave device gone), the session stays Running and restoredFromDisk
// falls back to true so the existing guard in reconcile() protects the session.
func TestRestoreFromPersister_Running_AlivePID_PTYReconnectFails(t *testing.T) {
	dir := t.TempDir()

	sess := makeSession(StateRunning)
	sess.AgentPID = 999
	sess.PTYSlavePath = "/dev/pts/7"

	rawJSON := []byte(`{"id":"` + sess.ID + `","name":"` + sess.Name + `","agent_profile":"default","state":2,"created_at":"` + sess.CreatedAt.Format("2006-01-02T15:04:05.999999999Z07:00") + `","stopped_at":"0001-01-01T00:00:00Z","agent_pid":999,"pty_slave_path":"/dev/pts/7"}`)
	if err := os.WriteFile(filepath.Join(dir, sess.ID+".json"), rawJSON, 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	alivePIDs := map[int]bool{999: true}
	m := newManagerWithStore(store, map[string]bool{}, alivePIDs)

	reconnectAttempted := false
	m.ptyReconnect = func(id, slavePath string) error {
		reconnectAttempted = true
		return fmt.Errorf("slave device gone: %s", slavePath)
	}

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	if !reconnectAttempted {
		t.Error("ptyReconnect was not called; expected reconnect attempt even if it fails")
	}

	got, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateRunning {
		t.Errorf("State = %v, want StateRunning (process alive; failing reconnect must not kill session)", got.State)
	}
	// Reconnect failed: fall back to restoredFromDisk guard so reconcile() won't
	// incorrectly stop the session due to missing PTY handle.
	if !got.restoredFromDisk {
		t.Error("restoredFromDisk = false, want true (ptyReconnect failed; guard must be active)")
	}
}

// TestRestoreFromPersister_Running_AlivePID_NoSlavePath tests that when a running
// session has an alive PID but no PTYSlavePath (legacy session with no path saved),
// ptyReconnect is NOT called and restoredFromDisk is set true preserving existing
// legacy behavior.
func TestRestoreFromPersister_Running_AlivePID_NoSlavePath(t *testing.T) {
	dir := t.TempDir()

	sess := makeSession(StateRunning)
	sess.AgentPID = 999
	// PTYSlavePath is intentionally empty (legacy session).
	writeSessionFile(t, dir, sess)

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	alivePIDs := map[int]bool{999: true}
	m := newManagerWithStore(store, map[string]bool{}, alivePIDs)

	reconnectCalled := false
	m.ptyReconnect = func(id, slavePath string) error {
		reconnectCalled = true
		return nil
	}

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	if reconnectCalled {
		t.Error("ptyReconnect was called but should not be for a session with empty PTYSlavePath")
	}

	got, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateRunning {
		t.Errorf("State = %v, want StateRunning", got.State)
	}
	// Legacy session: no slave path, fall back to restoredFromDisk guard.
	if !got.restoredFromDisk {
		t.Error("restoredFromDisk = false, want true for legacy session with no PTYSlavePath")
	}
}

// TestRestoreFromPersister_Running_DeadPID_NoReconnect tests that when a running
// session has a dead PID, ptyReconnect is NOT called (process is gone, reconnect
// would be pointless) and the session transitions to StateStopped as before.
func TestRestoreFromPersister_Running_DeadPID_NoReconnect(t *testing.T) {
	dir := t.TempDir()

	sess := makeSession(StateRunning)
	sess.AgentPID = 999
	sess.PTYSlavePath = "/dev/pts/7"

	rawJSON := []byte(`{"id":"` + sess.ID + `","name":"` + sess.Name + `","agent_profile":"default","state":2,"created_at":"` + sess.CreatedAt.Format("2006-01-02T15:04:05.999999999Z07:00") + `","stopped_at":"0001-01-01T00:00:00Z","agent_pid":999,"pty_slave_path":"/dev/pts/7"}`)
	if err := os.WriteFile(filepath.Join(dir, sess.ID+".json"), rawJSON, 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}
	defer p.Stop()

	store := NewStore()
	alivePIDs := map[int]bool{} // 999 is dead
	m := newManagerWithStore(store, map[string]bool{}, alivePIDs)

	reconnectCalled := false
	m.ptyReconnect = func(id, slavePath string) error {
		reconnectCalled = true
		return nil
	}

	if err := m.RestoreFromPersister(p); err != nil {
		t.Fatalf("RestoreFromPersister: %v", err)
	}

	if reconnectCalled {
		t.Error("ptyReconnect was called but must not be when the process is dead")
	}

	got, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session not found in store after restore")
	}
	if got.State != StateStopped {
		t.Errorf("State = %v, want StateStopped (process dead)", got.State)
	}
}
