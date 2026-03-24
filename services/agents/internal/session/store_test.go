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

	updated := store.Update("sess-1", func(s *Session) {
		s.Name = "new-name"
	})
	if !updated {
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
