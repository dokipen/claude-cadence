package hub

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRegisterTerminalRelay_StaleCleanupDoesNotClobberLiveRegistration(t *testing.T) {
	sessionUUID := uuid.MustParse("12345678-1234-1234-1234-123456789abc")

	a := &ConnectedAgent{
		terminalChannels: make(map[uuid.UUID]chan []byte),
	}

	// First registration (stale).
	_, cleanup1 := a.RegisterTerminalRelay(sessionUUID)

	// Second registration for the same session (live replacement).
	ch2, cleanup2 := a.RegisterTerminalRelay(sessionUUID)

	// Stale cleanup must not remove the live channel.
	cleanup1()

	// DeliverTerminalFrame must succeed and ch2 must receive the payload.
	payload := []byte("live terminal payload")
	if ok := a.DeliverTerminalFrame(sessionUUID, payload); !ok {
		t.Fatal("DeliverTerminalFrame returned false after stale cleanup: live channel was clobbered")
	}

	select {
	case got, ok := <-ch2:
		if !ok {
			t.Fatal("ch2 closed unexpectedly after stale cleanup")
		}
		if string(got) != string(payload) {
			t.Fatalf("ch2 payload mismatch: got %q, want %q", got, payload)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for payload on ch2")
	}

	// cleanup2 must remove the map entry: subsequent delivery must fail.
	cleanup2()

	if ok := a.DeliverTerminalFrame(sessionUUID, payload); ok {
		t.Fatal("DeliverTerminalFrame returned true after cleanup2(): channel should be gone")
	}
}
