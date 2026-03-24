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
