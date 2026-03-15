package session

import (
	"log/slog"
	"time"
)

// Cleaner periodically destroys stale stopped sessions.
type Cleaner struct {
	manager  *Manager
	ttl      time.Duration
	interval time.Duration
	stopCh   chan struct{}
	doneCh   chan struct{}
}

// NewCleaner creates a Cleaner that will destroy stopped sessions older than ttl,
// checking every interval.
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
func (c *Cleaner) Stop() {
	close(c.stopCh)
	<-c.doneCh
}

func (c *Cleaner) run() {
	defer close(c.doneCh)

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
		// Reconcile to get current state.
		c.manager.reconcile(sess)

		if sess.State != StateStopped {
			continue
		}
		if sess.StoppedAt.IsZero() {
			continue
		}
		if now.Sub(sess.StoppedAt) < c.ttl {
			continue
		}

		slog.Info("destroying stale session",
			"id", sess.ID,
			"name", sess.Name,
			"stopped_at", sess.StoppedAt,
			"age", now.Sub(sess.StoppedAt).String(),
		)

		if err := c.manager.Destroy(sess.ID, true); err != nil {
			slog.Warn("failed to destroy stale session",
				"id", sess.ID,
				"error", err,
			)
		}
	}
}
