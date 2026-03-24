package session

import (
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// Cleaner periodically destroys stale stopped sessions and immediately reaps
// sessions whose agent process has exited.
type Cleaner struct {
	manager            *Manager
	ttl                time.Duration
	interval           time.Duration
	creatingSessionTTL time.Duration
	errorSessionTTL    time.Duration
	stopCh             chan struct{}
	doneCh             chan struct{}
	once               sync.Once
}

// NewCleaner creates a Cleaner that will:
//   - Immediately destroy running/creating sessions whose agent process has exited
//   - Destroy stopped/error sessions older than ttl
//   - Reap StateCreating sessions with no PID that have exceeded creatingSessionTTL (0 = disabled)
//   - Destroy error sessions older than errorSessionTTL (0 = use stale TTL as fallback)
//
// Both checks run on every interval tick.
func NewCleaner(manager *Manager, ttl, interval, creatingSessionTTL, errorSessionTTL time.Duration) *Cleaner {
	return &Cleaner{
		manager:            manager,
		ttl:                ttl,
		interval:           interval,
		creatingSessionTTL: creatingSessionTTL,
		errorSessionTTL:    errorSessionTTL,
		stopCh:             make(chan struct{}),
		doneCh:             make(chan struct{}),
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
		// StateCreating sessions with no PID yet are exclusively owned by the
		// Create goroutine. The PTY does not exist until Create() calls
		// pty.Create(), so reconcile() would incorrectly mark them Stopped and
		// Destroy() would remove them from the store before Create() finishes.
		// Skip them to close this race window.
		//
		// If AgentPID is non-zero the process was actually started; reconcile
		// can still detect a dead process and clean it up normally.
		if sess.State == StateCreating && sess.AgentPID == 0 {
			// Skip if no timeout configured OR session is within the timeout window.
			if c.creatingSessionTTL == 0 || time.Since(sess.CreatedAt) < c.creatingSessionTTL {
				continue
			}
			// Session stuck in StateCreating beyond timeout — transition to StateError.
			age := time.Since(sess.CreatedAt).Round(time.Second)
			errMsg := fmt.Sprintf("session stuck in creating state for %s; reaped by cleaner", age)
			slog.Warn("reaping stuck StateCreating session", "id", sess.ID, "name", sess.Name, "age", age)
			c.manager.store.Update(sess.ID, func(s *Session) {
				s.State = StateError
				s.ErrorMessage = errMsg
			})
			continue
		}

		originalState := sess.State

		// Reconcile updates sess in-place: Running/Creating → Stopped if process died.
		c.manager.reconcile(sess)

		switch {
		case (originalState == StateRunning || originalState == StateCreating) && sess.State == StateStopped:
			// Process just exited — log exit code then destroy immediately.
			logArgs := []any{"id", sess.ID, "name", sess.Name, "pid", sess.AgentPID}
			if c.manager.pty != nil {
				if waitErr, err := c.manager.pty.WaitError(sess.ID); err == nil {
					if waitErr != nil {
						logArgs = append(logArgs, "exit_error", waitErr)
					} else {
						logArgs = append(logArgs, "exit_code", 0)
					}
				}
			}
			slog.Info("auto-destroying session: process no longer alive", logArgs...)
			if err := c.manager.Destroy(sess.ID, true); err != nil {
				slog.Warn("failed to auto-destroy session",
					"id", sess.ID,
					"error", err,
				)
			}

		case sess.State == StateStopped:
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

		case sess.State == StateError:
			effectiveTTL := c.ttl
			if c.errorSessionTTL > 0 {
				effectiveTTL = c.errorSessionTTL
			}
			age := ageOf(sess, now)
			if age < effectiveTTL {
				continue
			}
			slog.Info("destroying error session",
				"id", sess.ID,
				"name", sess.Name,
				"age", age.String(),
			)
			if err := c.manager.Destroy(sess.ID, true); err != nil {
				slog.Warn("failed to destroy error session",
					"id", sess.ID,
					"error", err,
				)
			}
		}
	}
}

// ageOf returns how long a session has been in its terminal state.
// It uses StoppedAt when set, falling back to CreatedAt for StateError
// sessions where StoppedAt may not have been recorded. Returns 0 if
// neither timestamp is set to avoid spurious immediate reaping.
func ageOf(sess *Session, now time.Time) time.Duration {
	if !sess.StoppedAt.IsZero() {
		return now.Sub(sess.StoppedAt)
	}
	if !sess.CreatedAt.IsZero() {
		return now.Sub(sess.CreatedAt)
	}
	return 0
}
