package hub

import (
	"testing"
	"time"
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
