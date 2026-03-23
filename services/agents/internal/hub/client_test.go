package hub

import (
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
		relayCh: make(map[string]chan []byte),
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
