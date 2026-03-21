package session

import (
	"log/slog"
	"sync"
	"time"
)

// Cleaner periodically destroys stale stopped sessions and immediately reaps
// sessions whose agent process has exited.
type Cleaner struct {
	manager  *Manager
	ttl      time.Duration
	interval time.Duration
	stopCh   chan struct{}
	doneCh   chan struct{}
	once     sync.Once
}

// NewCleaner creates a Cleaner that will:
//   - Immediately destroy running/creating sessions whose agent process has exited
//   - Destroy stopped/error sessions older than ttl
//
// Both checks run on every interval tick.
func NewCleaner(manager *Manager, ttl, interval time.Duration) *Cleaner {
	return &Cleaner{
		manager:  manager,
		ttl:      ttl,
		interval: interval,
		stopCh:   make(chan struct{}),
		doneCh:   make(chan struct{}),
	}
}

// Start begins the background cleanup loop. Call Stop to terminate.
func (c *Cleaner) Start() {
	go c.run()
}

// Stop signals the cleaner to stop and waits for it to finish.
// Safe to call multiple times.
func (c *Cleaner) Stop() {
	c.once.Do(func() { close(c.stopCh) })
	<-c.doneCh
}

func (c *Cleaner) run() {
	defer close(c.doneCh)

	// Run an initial cleanup pass immediately to handle sessions that became
	// stale before the daemon restarted.
	c.cleanup()

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.cleanup()
		}
	}
}

func (c *Cleaner) cleanup() {
	sessions := c.manager.store.List()
	now := time.Now()

	for _, sess := range sessions {
		originalState := sess.State

		// Reconcile updates sess in-place: Running/Creating → Stopped if process died.
		c.manager.reconcile(sess)

		switch {
		case (originalState == StateRunning || originalState == StateCreating) && sess.State == StateStopped:
			// Process just exited — destroy immediately without waiting for TTL.
			slog.Info("auto-destroying session: agent process exited",
				"id", sess.ID,
				"name", sess.Name,
				"pid", sess.AgentPID,
			)
			if err := c.manager.Destroy(sess.ID, true); err != nil {
				slog.Warn("failed to auto-destroy session",
					"id", sess.ID,
					"error", err,
				)
			}

		case sess.State == StateStopped || sess.State == StateError:
			// Session was already stopped/errored before this tick.
			// Reap it once it has been in this state longer than the TTL.
			age := ageOf(sess, now)
			if age < c.ttl {
				continue
			}
			slog.Info("destroying stale session",
				"id", sess.ID,
				"name", sess.Name,
				"state", sess.State,
				"age", age.String(),
			)
			if err := c.manager.Destroy(sess.ID, true); err != nil {
				slog.Warn("failed to destroy stale session",
					"id", sess.ID,
					"error", err,
				)
			}
		}
	}
}

// ageOf returns how long a session has been in its terminal state.
// It uses StoppedAt when set, falling back to CreatedAt for StateError
// sessions where StoppedAt may not have been recorded.
func ageOf(sess *Session, now time.Time) time.Duration {
	if !sess.StoppedAt.IsZero() {
		return now.Sub(sess.StoppedAt)
	}
	return now.Sub(sess.CreatedAt)
}
