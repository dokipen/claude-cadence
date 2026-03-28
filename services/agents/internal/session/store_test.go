package session

import (
	"fmt"
	"sync"
	"testing"
)

func TestStore_TryAdd_UnderCap(t *testing.T) {
	store := NewStore()
	cap := 5
	// Add cap-1 sessions directly.
	for i := 0; i < cap-1; i++ {
		store.Add(&Session{ID: "existing-" + string(rune('0'+i))})
	}

	// TryAdd one more should succeed (still one slot free).
	sess := &Session{ID: "new-session"}
	if err := store.TryAdd(sess, cap); err != nil {
		t.Fatalf("TryAdd() = %v, want nil (under cap)", err)
	}
	if _, ok := store.Get("new-session"); !ok {
		t.Error("expected new session to be present in store after TryAdd")
	}
}

func TestStore_TryAdd_AtCap(t *testing.T) {
	store := NewStore()
	cap := 3
	// Fill store to exactly the cap.
	for i := 0; i < cap; i++ {
		store.Add(&Session{ID: "existing-" + string(rune('0'+i))})
	}

	// TryAdd should now be rejected.
	sess := &Session{ID: "overflow-session"}
	err := store.TryAdd(sess, cap)
	if err == nil {
		t.Fatal("TryAdd() = nil, want ErrResourceExhausted")
	}
	sesErr, ok := err.(*Error)
	if !ok || sesErr.Code != ErrResourceExhausted {
		t.Errorf("TryAdd() error = %v, want *Error{Code: ErrResourceExhausted}", err)
	}
	// Session must NOT have been inserted.
	if _, ok := store.Get("overflow-session"); ok {
		t.Error("expected rejected session to NOT be present in store")
	}
}

func TestStore_TryAdd_NoCap(t *testing.T) {
	store := NewStore()
	// maxSessions == 0 means unlimited.
	for i := 0; i < 50; i++ {
		sess := &Session{ID: fmt.Sprintf("sess-%d", i)}
		if err := store.TryAdd(sess, 0); err != nil {
			t.Fatalf("TryAdd() with maxSessions=0 returned error at i=%d: %v", i, err)
		}
	}
}

func TestStore_TryAdd_ConcurrentBoundary(t *testing.T) {
	const goroutines = 20
	const maxSessions = 10

	store := NewStore()
	var wg sync.WaitGroup
	results := make([]error, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		i := i
		go func() {
			defer wg.Done()
			sess := &Session{ID: "concurrent-" + string(rune('a'+i))}
			results[i] = store.TryAdd(sess, maxSessions)
		}()
	}
	wg.Wait()

	var succeeded, failed int
	for _, err := range results {
		if err == nil {
			succeeded++
		} else {
			sesErr, ok := err.(*Error)
			if !ok || sesErr.Code != ErrResourceExhausted {
				t.Errorf("unexpected error type: %v", err)
			}
			failed++
		}
	}

	if succeeded != maxSessions {
		t.Errorf("succeeded = %d, want %d", succeeded, maxSessions)
	}
	if failed != goroutines-maxSessions {
		t.Errorf("failed = %d, want %d", failed, goroutines-maxSessions)
	}
	// Verify the store actually contains exactly maxSessions entries.
	if got := len(store.List()); got != maxSessions {
		t.Errorf("store.List() len = %d, want %d", got, maxSessions)
	}
}

func TestStore_NameIndex_AddThenGetByName(t *testing.T) {
	store := NewStore()
	sess := &Session{ID: "sess-1", Name: "my-agent"}
	store.Add(sess)

	got, ok := store.GetByName("my-agent")
	if !ok {
		t.Fatalf("GetByName(%q) = _, false; want true", "my-agent")
	}
	if got.ID != "sess-1" {
		t.Errorf("GetByName(%q).ID = %q, want %q", "my-agent", got.ID, "sess-1")
	}
}

func TestStore_NameIndex_TryAdd_DuplicateNameRejected(t *testing.T) {
	store := NewStore()
	first := &Session{ID: "sess-1", Name: "duplicate-name"}
	if err := store.TryAdd(first, 0); err != nil {
		t.Fatalf("TryAdd() first session = %v, want nil", err)
	}

	second := &Session{ID: "sess-2", Name: "duplicate-name"}
	err := store.TryAdd(second, 0)
	if err == nil {
		t.Fatal("TryAdd() duplicate name = nil, want ErrAlreadyExists")
	}
	sesErr, ok := err.(*Error)
	if !ok || sesErr.Code != ErrAlreadyExists {
		t.Errorf("TryAdd() duplicate name error = %v, want *Error{Code: ErrAlreadyExists}", err)
	}
	// The second session must NOT have been inserted.
	if _, ok := store.Get("sess-2"); ok {
		t.Error("expected rejected session to NOT be present in store after duplicate-name TryAdd")
	}
}

func TestStore_NameIndex_DeleteRemovesName(t *testing.T) {
	store := NewStore()
	sess := &Session{ID: "sess-1", Name: "to-delete"}
	store.Add(sess)

	deleted := store.Delete("sess-1")
	if !deleted {
		t.Fatal("Delete() = false, want true")
	}

	if _, ok := store.GetByName("to-delete"); ok {
		t.Error("GetByName() returned true after session was deleted; want false")
	}
}

func TestStore_NameIndex_UpdateNameConsistency(t *testing.T) {
	store := NewStore()
	sess := &Session{ID: "sess-1", Name: "old-name"}
	store.Add(sess)

	ok, err := store.Update("sess-1", func(s *Session) {
		s.Name = "new-name"
	})
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("Update() = false, want true")
	}

	if _, ok := store.GetByName("old-name"); ok {
		t.Error("GetByName(old-name) = true after rename; want false")
	}
	got, ok := store.GetByName("new-name")
	if !ok {
		t.Fatalf("GetByName(new-name) = _, false after rename; want true")
	}
	if got.ID != "sess-1" {
		t.Errorf("GetByName(new-name).ID = %q, want %q", got.ID, "sess-1")
	}
}

func TestStore_NameIndex_GetByName_UnknownName(t *testing.T) {
	store := NewStore()

	if _, ok := store.GetByName("nonexistent"); ok {
		t.Error("GetByName(nonexistent) = _, true on empty store; want false")
	}

	store.Add(&Session{ID: "sess-1", Name: "known-name"})
	if _, ok := store.GetByName("other-name"); ok {
		t.Error("GetByName(other-name) = _, true; want false for unknown name")
	}
}

func TestStore_Update_RenameToExistingNameReturnsError(t *testing.T) {
	store := NewStore()
	store.Add(&Session{ID: "sess-1", Name: "alpha"})
	store.Add(&Session{ID: "sess-2", Name: "beta"})

	ok, err := store.Update("sess-1", func(s *Session) {
		s.Name = "beta"
	})
	if err == nil {
		t.Fatal("Update() rename to existing name = nil error, want ErrAlreadyExists")
	}
	sesErr, ok2 := err.(*Error)
	if !ok2 || sesErr.Code != ErrAlreadyExists {
		t.Errorf("Update() error = %v, want *Error{Code: ErrAlreadyExists}", err)
	}
	if sesErr != nil && sesErr.Message != `session name "beta" is already in use` {
		t.Errorf("Update() error message = %q, want %q", sesErr.Message, `session name "beta" is already in use`)
	}
	if ok {
		t.Error("Update() = true on name collision, want false")
	}

	// sess-1 must still be reachable by its original name (mutation rolled back).
	got1, found1 := store.GetByName("alpha")
	if !found1 {
		t.Fatal("GetByName(alpha) = _, false after collision; want true (rollback expected)")
	}
	if got1.ID != "sess-1" {
		t.Errorf("GetByName(alpha).ID = %q, want sess-1", got1.ID)
	}
	if got1.Name != "alpha" {
		t.Errorf("sess-1.Name = %q after rollback, want alpha", got1.Name)
	}

	// sess-2 index must be intact.
	got2, found2 := store.GetByName("beta")
	if !found2 {
		t.Fatal("GetByName(beta) = _, false after collision; want true (index not corrupted)")
	}
	if got2.ID != "sess-2" {
		t.Errorf("GetByName(beta).ID = %q, want sess-2", got2.ID)
	}
}

// --- State machine tests ---

func TestSessionState_String(t *testing.T) {
	cases := []struct {
		state SessionState
		want  string
	}{
		{StateCreating, "creating"},
		{StateRunning, "running"},
		{StateStopped, "stopped"},
		{StateError, "error"},
		{StateDestroying, "destroying"},
		{SessionState(99), "unknown(99)"},
	}
	for _, tc := range cases {
		if got := tc.state.String(); got != tc.want {
			t.Errorf("SessionState(%d).String() = %q, want %q", int(tc.state), got, tc.want)
		}
	}
}

func TestStore_Transition_ValidPaths(t *testing.T) {
	cases := []struct {
		from SessionState
		to   SessionState
	}{
		{StateCreating, StateRunning},
		{StateCreating, StateStopped},
		{StateCreating, StateError},
		{StateCreating, StateDestroying},
		{StateRunning, StateStopped},
		{StateRunning, StateDestroying},
		{StateStopped, StateDestroying},
		{StateError, StateDestroying},
	}
	for _, tc := range cases {
		t.Run(tc.from.String()+"→"+tc.to.String(), func(t *testing.T) {
			store := NewStore()
			store.Add(&Session{ID: "s", State: tc.from})
			if err := store.Transition("s", tc.to); err != nil {
				t.Errorf("Transition(%s→%s) = %v, want nil", tc.from, tc.to, err)
			}
			got, _ := store.Get("s")
			if got.State != tc.to {
				t.Errorf("state after Transition = %s, want %s", got.State, tc.to)
			}
		})
	}
}

func TestStore_Transition_InvalidPaths(t *testing.T) {
	cases := []struct {
		from SessionState
		to   SessionState
	}{
		{StateRunning, StateCreating},
		{StateRunning, StateError},
		{StateStopped, StateCreating},
		{StateStopped, StateRunning},
		{StateStopped, StateError},
		{StateError, StateCreating},
		{StateError, StateRunning},
		{StateError, StateStopped},
		{StateDestroying, StateCreating},
		{StateDestroying, StateRunning},
		{StateDestroying, StateStopped},
		{StateDestroying, StateError},
		{StateDestroying, StateDestroying},
	}
	for _, tc := range cases {
		t.Run(tc.from.String()+"→"+tc.to.String(), func(t *testing.T) {
			store := NewStore()
			store.Add(&Session{ID: "s", State: tc.from})
			err := store.Transition("s", tc.to)
			if err == nil {
				t.Fatalf("Transition(%s→%s) = nil, want *InvalidTransitionError", tc.from, tc.to)
			}
			if _, ok := err.(*InvalidTransitionError); !ok {
				t.Errorf("Transition(%s→%s) error type = %T, want *InvalidTransitionError", tc.from, tc.to, err)
			}
			// State must be unchanged.
			got, _ := store.Get("s")
			if got.State != tc.from {
				t.Errorf("state after rejected Transition = %s, want %s (unchanged)", got.State, tc.from)
			}
		})
	}
}

func TestStore_Transition_NotFound(t *testing.T) {
	store := NewStore()
	err := store.Transition("nonexistent", StateRunning)
	if err == nil {
		t.Fatal("Transition on missing session = nil, want *Error{Code: ErrNotFound}")
	}
	sessErr, ok := err.(*Error)
	if !ok || sessErr.Code != ErrNotFound {
		t.Errorf("Transition error = %v (%T), want *Error{Code: ErrNotFound}", err, err)
	}
}

func TestStore_Transition_AppliesAdditionalFields(t *testing.T) {
	store := NewStore()
	store.Add(&Session{ID: "s", State: StateCreating})
	err := store.Transition("s", StateError, func(s *Session) {
		s.ErrorMessage = "boom"
	})
	if err != nil {
		t.Fatalf("Transition() = %v, want nil", err)
	}
	got, _ := store.Get("s")
	if got.State != StateError {
		t.Errorf("state = %s, want error", got.State)
	}
	if got.ErrorMessage != "boom" {
		t.Errorf("ErrorMessage = %q, want %q", got.ErrorMessage, "boom")
	}
}

func TestStore_Transition_CallbackCannotOverrideState(t *testing.T) {
	// A callback that tries to overwrite State must be silently corrected by
	// the re-assertion in Transition.
	store := NewStore()
	store.Add(&Session{ID: "s", State: StateCreating})
	err := store.Transition("s", StateRunning, func(s *Session) {
		s.State = StateError // attempt to override — must be ignored
	})
	if err != nil {
		t.Fatalf("Transition() = %v, want nil", err)
	}
	got, _ := store.Get("s")
	if got.State != StateRunning {
		t.Errorf("state = %s after callback override attempt, want running (re-assertion must win)", got.State)
	}
}

func TestStore_Transition_QueuesPersister(t *testing.T) {
	const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	dir := t.TempDir()
	p, err := NewPersister(dir)
	if err != nil {
		t.Fatalf("NewPersister: %v", err)
	}

	store := NewStoreWithPersister(p)
	store.Add(&Session{ID: id, Name: "sess", State: StateCreating})
	if err := store.Transition(id, StateRunning); err != nil {
		t.Fatalf("Transition() = %v, want nil", err)
	}

	p.Stop() // flush pending writes

	// Re-read from disk to verify the persisted state.
	sessions, err := p.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("LoadAll: got %d sessions, want 1", len(sessions))
	}
	if sessions[0].State != StateRunning {
		t.Errorf("persisted state = %s, want running", sessions[0].State)
	}
}
