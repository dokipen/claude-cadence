package hub

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestBackoff(t *testing.T) {
	tests := []struct {
		name    string
		attempt int
		base    time.Duration
		minWant time.Duration
		maxWant time.Duration
	}{
		{
			name:    "attempt 0 with 1s base",
			attempt: 0,
			base:    time.Second,
			minWant: 750 * time.Millisecond,
			maxWant: 1250 * time.Millisecond,
		},
		{
			name:    "attempt 1 with 1s base",
			attempt: 1,
			base:    time.Second,
			minWant: 1500 * time.Millisecond,
			maxWant: 2500 * time.Millisecond,
		},
		{
			name:    "attempt 2 with 1s base",
			attempt: 2,
			base:    time.Second,
			minWant: 3 * time.Second,
			maxWant: 5 * time.Second,
		},
		{
			name:    "high attempt caps at 30s",
			attempt: 10,
			base:    time.Second,
			minWant: 22500 * time.Millisecond, // 30s * 0.75
			maxWant: 37500 * time.Millisecond, // 30s * 1.25
		},
		{
			name:    "zero base uses 1s default",
			attempt: 0,
			base:    0,
			minWant: 750 * time.Millisecond,
			maxWant: 1250 * time.Millisecond,
		},
		{
			name:    "negative base uses 1s default",
			attempt: 0,
			base:    -5 * time.Second,
			minWant: 750 * time.Millisecond,
			maxWant: 1250 * time.Millisecond,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for i := 0; i < 100; i++ {
				got := backoff(tt.attempt, tt.base)
				if got < tt.minWant || got > tt.maxWant {
					t.Fatalf("iteration %d: backoff(%d, %v) = %v, want in [%v, %v]",
						i, tt.attempt, tt.base, got, tt.minWant, tt.maxWant)
				}
			}
		})
	}
}

func TestRegisterRelaySession_NormalizesUUIDKey(t *testing.T) {
	// uppercaseID is a valid UUID in non-canonical (uppercase) form.
	// uuid.Parse accepts it, but uuid.UUID.String() returns the lowercase form.
	const uppercaseID = "550E8400-E29B-41D4-A716-446655440000"

	c := &Client{
		relayCh:     make(map[string]chan []byte),
		relayCancel: make(map[string]context.CancelFunc),
	}

	// relayCancel is a no-op; we only care about channel dispatch here.
	relayCancel := func() {}

	inputCh, cleanup := c.RegisterRelaySession(uppercaseID, relayCancel)
	defer cleanup()

	// Build a binary frame for the same session. encodeTerminalFrame accepts a
	// uuid.UUID value whose bytes are identical regardless of the string form
	// used to parse it. dispatchBinaryFrame will call sessionUUID.String() to
	// produce the canonical lowercase lookup key.
	parsed, err := uuid.Parse(uppercaseID)
	if err != nil {
		t.Fatalf("uuid.Parse(%q) unexpected error: %v", uppercaseID, err)
	}
	want := []byte("hello relay")
	frame := encodeTerminalFrame(parsed, want)

	// dispatchBinaryFrame decodes the frame and looks up the canonical lowercase
	// key. Before the fix, RegisterRelaySession stores the raw uppercase key, so
	// the lookup misses and the payload is never delivered.
	c.dispatchBinaryFrame(frame)

	select {
	case got, ok := <-inputCh:
		if !ok {
			t.Fatal("channel closed unexpectedly")
		}
		if string(got) != string(want) {
			t.Fatalf("got payload %q, want %q", got, want)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for payload: RegisterRelaySession stored uppercase key but dispatchBinaryFrame looks up lowercase canonical key")
	}
}

func TestRegisterRelaySession_StaleCleanupDoesNotClobberLiveRegistration(t *testing.T) {
	c := &Client{
		relayCh:     make(map[string]chan []byte),
		relayCancel: make(map[string]context.CancelFunc),
	}

	const sessionID = "12345678-1234-1234-1234-123456789abc"

	// First registration (stale).
	_, cleanup1 := c.RegisterRelaySession(sessionID, func() {})

	// Second registration for the same session (live replacement).
	ch2, cleanup2 := c.RegisterRelaySession(sessionID, func() {})

	// Stale cleanup must not remove the live channel.
	cleanup1()

	// Send a terminal frame for the session and assert ch2 still receives it.
	parsed, err := uuid.Parse(sessionID)
	if err != nil {
		t.Fatalf("uuid.Parse: %v", err)
	}
	want := []byte("live relay payload")
	frame := encodeTerminalFrame(parsed, want)
	c.dispatchBinaryFrame(frame)

	select {
	case got, ok := <-ch2:
		if !ok {
			t.Fatal("ch2 closed unexpectedly after stale cleanup")
		}
		if string(got) != string(want) {
			t.Fatalf("ch2 payload mismatch: got %q, want %q", got, want)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for payload on ch2: stale cleanup may have clobbered the live registration")
	}

	// cleanup2 must remove the map entries.
	cleanup2()

	c.relayChMu.Lock()
	_, chExists := c.relayCh[parsed.String()]
	_, cancelExists := c.relayCancel[parsed.String()]
	c.relayChMu.Unlock()
	if chExists {
		t.Fatal("relayCh entry still present after cleanup2()")
	}
	if cancelExists {
		t.Fatal("relayCancel entry still present after cleanup2()")
	}
}
