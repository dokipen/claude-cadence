package session

import (
	"crypto/sha256"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/tmux"
)

// promptPatterns matches common Claude Code input prompts.
var promptPatterns = regexp.MustCompile(
	`(\?\s*$|>\s*$|\(y/n\)\s*$|\(Y/n\)\s*$|\(yes/no\)\s*$|❯|[$#]\s*$)`,
)

// idleThreshold is how long content must be unchanged with a prompt before
// marking the session as waiting for input.
const idleThreshold = 10 * time.Second

// sessionSnapshot tracks the last observed pane content for change detection.
type sessionSnapshot struct {
	contentHash [sha256.Size]byte
	firstSeen   time.Time
}

// Monitor periodically checks running sessions for idle input prompts.
type Monitor struct {
	manager   *Manager
	tmux      *tmux.Client
	interval  time.Duration
	stopCh    chan struct{}
	doneCh    chan struct{}
	once      sync.Once
	snapshots map[string]*sessionSnapshot
}

// NewMonitor creates a Monitor that checks sessions every interval.
func NewMonitor(manager *Manager, tmuxClient *tmux.Client, interval time.Duration) *Monitor {
	return &Monitor{
		manager:   manager,
		tmux:      tmuxClient,
		interval:  interval,
		stopCh:    make(chan struct{}),
		doneCh:    make(chan struct{}),
		snapshots: make(map[string]*sessionSnapshot),
	}
}

// Start begins the background monitoring loop.
func (m *Monitor) Start() {
	go m.run()
}

// Stop signals the monitor to stop and waits for it to finish.
func (m *Monitor) Stop() {
	m.once.Do(func() { close(m.stopCh) })
	<-m.doneCh
}

func (m *Monitor) run() {
	defer close(m.doneCh)

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.check()
		}
	}
}

func (m *Monitor) check() {
	// Use store.List directly instead of Manager.List to avoid reconcile()
	// calling tmux HasSession + isProcessAlive per session — the monitor
	// already inspects tmux panes and only cares about running sessions.
	// This method runs on a single goroutine so TOCTOU between the
	// sess.WaitingForInput read and the subsequent store.Update is safe.
	sessions := m.manager.store.List()
	now := time.Now()

	// Track which session IDs are still active for snapshot cleanup.
	activeIDs := make(map[string]bool, len(sessions))

	for _, sess := range sessions {
		if sess.State != StateRunning {
			continue
		}
		activeIDs[sess.ID] = true

		content, err := m.tmux.CapturePane(sess.TmuxSession)
		if err != nil {
			slog.Debug("failed to capture pane", "session", sess.Name, "error", err)
			continue
		}

		contentHash := sha256.Sum256([]byte(content))
		snap, exists := m.snapshots[sess.ID]

		if !exists || snap.contentHash != contentHash {
			// Content changed — update snapshot, clear waiting state.
			m.snapshots[sess.ID] = &sessionSnapshot{
				contentHash: contentHash,
				firstSeen:   now,
			}
			if sess.WaitingForInput {
				m.manager.store.Update(sess.ID, func(s *Session) {
					s.WaitingForInput = false
					s.IdleSince = nil
				})
			}
			continue
		}

		// Content unchanged — check if it matches a prompt pattern.
		lastLine := lastNonEmptyLine(content)
		if lastLine == "" || !promptPatterns.MatchString(lastLine) {
			// No prompt detected, clear waiting state if set.
			if sess.WaitingForInput {
				m.manager.store.Update(sess.ID, func(s *Session) {
					s.WaitingForInput = false
					s.IdleSince = nil
				})
			}
			continue
		}

		// Prompt detected and content unchanged — check idle threshold.
		idleDuration := now.Sub(snap.firstSeen)
		if idleDuration >= idleThreshold && !sess.WaitingForInput {
			idleSince := snap.firstSeen
			m.manager.store.Update(sess.ID, func(s *Session) {
				s.WaitingForInput = true
				s.IdleSince = &idleSince
			})
			slog.Info("session waiting for input",
				"session", sess.Name,
				"idle_since", idleSince,
			)
		}
	}

	// Clean up snapshots for sessions that no longer exist.
	for id := range m.snapshots {
		if !activeIDs[id] {
			delete(m.snapshots, id)
		}
	}
}

// lastNonEmptyLine returns the last line with non-whitespace content.
// Uses backward scanning to avoid allocating a []string slice.
func lastNonEmptyLine(s string) string {
	s = strings.TrimRight(s, "\n")
	for {
		i := strings.LastIndexByte(s, '\n')
		line := strings.TrimRight(s[i+1:], " \t\r")
		if line != "" {
			return line
		}
		if i < 0 {
			return ""
		}
		s = s[:i]
	}
}
