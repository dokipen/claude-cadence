package hub

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRegisterTerminalRelay_StaleCleanupDoesNotClobberLiveRegistration(t *testing.T) {
	sessionUUID := uuid.MustParse("12345678-1234-1234-1234-123456789abc")

	a := &ConnectedAgent{
		terminalChannels: make(map[uuid.UUID]*terminalRelay),
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

// TestTerminalRelayCloseIsIdempotent verifies that a relay torn down by the
// hub (CloseTerminalChannels on disconnect, or CloseTerminalChannel on a
// relay-end frame) can still be cleaned up by its owner without a
// double-close panic, and vice versa.
func TestTerminalRelayCloseIsIdempotent(t *testing.T) {
	a := &ConnectedAgent{
		Name:             "test",
		terminalChannels: make(map[uuid.UUID]*terminalRelay),
	}

	sessA := uuid.New()
	chA, cleanupA := a.RegisterTerminalRelay(sessA)
	a.CloseTerminalChannels()
	if _, open := <-chA; open {
		t.Fatal("expected chA closed after CloseTerminalChannels")
	}
	cleanupA() // must not panic
	cleanupA() // still must not panic

	sessB := uuid.New()
	chB, cleanupB := a.RegisterTerminalRelay(sessB)
	cleanupB()
	a.CloseTerminalChannel(sessB) // already removed; no-op
	a.CloseTerminalChannels()     // must not panic
	if _, open := <-chB; open {
		t.Fatal("expected chB closed after cleanupB")
	}

	sessC := uuid.New()
	chC, cleanupC := a.RegisterTerminalRelay(sessC)
	a.CloseTerminalChannel(sessC)
	cleanupC() // must not panic
	if _, open := <-chC; open {
		t.Fatal("expected chC closed after CloseTerminalChannel")
	}
}

// TestDeliverTerminalFrame_NoRaceWithClose hammers DeliverTerminalFrame from
// one goroutine while another goroutine concurrently registers, cleans up,
// and bulk-closes relays for the same session. Sends and closes are
// serialized by terminalMu, so this must never panic with
// "send on closed channel". Run under -race.
func TestDeliverTerminalFrame_NoRaceWithClose(t *testing.T) {
	sessionUUID := uuid.New()
	a := &ConnectedAgent{
		terminalChannels: make(map[uuid.UUID]*terminalRelay),
	}

	const iterations = 2000
	payload := []byte("frame")

	var wg sync.WaitGroup
	wg.Add(2)

	// Sender: deliver frames as fast as possible.
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			a.DeliverTerminalFrame(sessionUUID, payload)
		}
	}()

	// Closer: churn registrations and closes for the same session, cycling
	// through every close path (cleanup, CloseTerminalChannel,
	// CloseTerminalChannels).
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			ch, cleanup := a.RegisterTerminalRelay(sessionUUID)
			switch i % 3 {
			case 0:
				cleanup()
			case 1:
				a.CloseTerminalChannel(sessionUUID)
				cleanup()
			case 2:
				a.CloseTerminalChannels()
				cleanup()
			}
			// Drain so a closed, non-empty channel is observed as closed.
			for range ch {
			}
		}
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out: goroutines did not finish (deadlock?)")
	}

	a.terminalMu.Lock()
	n := len(a.terminalChannels)
	a.terminalMu.Unlock()
	if n != 0 {
		t.Errorf("expected no relays left registered, got %d", n)
	}
}
