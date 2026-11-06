package session

import (
	"reflect"
	"testing"
)

func TestLiveSessions(t *testing.T) {
	in := []*Session{
		{ID: "a", Name: "one", State: StateRunning},
		{ID: "b", State: StateCreating},
		{ID: "c", Name: "gone", State: StateStopped},
		{ID: "d", State: StateError},
		nil,
	}
	got := LiveSessions(in)
	want := []string{"one (a)", "b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got := LiveSessions(nil); len(got) != 0 {
		t.Fatalf("expected none, got %v", got)
	}
}
