package session

import (
	"crypto/sha256"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
)

// promptPatterns matches common Claude Code input prompts.
var promptPatterns = regexp.MustCompile(
	`(\?\s*$|>\s*$|\(y/n\)\s*$|\(Y/n\)\s*$|\(yes/no\)\s*$|❯|[$#]\s*$)`,
)

var (
	ansiEscape        = regexp.MustCompile(`\x1b(?:\[[0-9;]*[A-Za-z]|[()][0-9A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))`)
	yesnoPattern      = regexp.MustCompile(`(?i)[\[(][yn]\/[yn][\])]`)
	textPromptPattern = regexp.MustCompile(`[?]\s*$|>\s*$`)
	shellPattern      = regexp.MustCompile(`[$#]\s*$`)
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
	pty       *pty.PTYManager
	interval  time.Duration
	stopCh    chan struct{}
	doneCh    chan struct{}
	once      sync.Once
	snapshots map[string]*sessionSnapshot
}

// NewMonitor creates a Monitor that checks sessions every interval.
func NewMonitor(manager *Manager, ptyManager *pty.PTYManager, interval time.Duration) *Monitor {
	return &Monitor{
		manager:   manager,
		pty:       ptyManager,
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
	// calling pty.PID + isProcessAlive per session — the monitor
	// already inspects PTY buffers and only cares about running sessions.
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

		buf, err := m.pty.ReadBuffer(sess.ID)
		if err != nil {
			slog.Debug("failed to read PTY buffer", "session", sess.Name, "error", err)
			continue
		}
		content := string(buf)

		contentHash := sha256.Sum256([]byte(content))
		snap, exists := m.snapshots[sess.ID]

		if !exists || snap.contentHash != contentHash {
			// Content changed — update snapshot, clear waiting state.
			m.snapshots[sess.ID] = &sessionSnapshot{
				contentHash: contentHash,
				firstSeen:   now,
			}
			if sess.WaitingForInput {
				_, _ = m.manager.store.Update(sess.ID, func(s *Session) {
					s.WaitingForInput = false
					s.IdleSince = nil
					s.PromptContext = ""
					s.PromptType = ""
				})
			}
			continue
		}

		// Content unchanged — check if it matches a prompt pattern.
		lastLine := lastNonEmptyLine(content)
		if lastLine == "" || !promptPatterns.MatchString(lastLine) {
			// No prompt detected, clear waiting state if set.
			if sess.WaitingForInput {
				_, _ = m.manager.store.Update(sess.ID, func(s *Session) {
					s.WaitingForInput = false
					s.IdleSince = nil
					s.PromptContext = ""
					s.PromptType = ""
				})
			}
			continue
		}

		// Prompt detected and content unchanged — check idle threshold.
		idleDuration := now.Sub(snap.firstSeen)
		if idleDuration >= idleThreshold && !sess.WaitingForInput {
			idleSince := snap.firstSeen
			ctx := lastNLines(stripANSI(content), 15)
			promptType := classifyPromptType(ctx)
			_, _ = m.manager.store.Update(sess.ID, func(s *Session) {
				s.WaitingForInput = true
				s.IdleSince = &idleSince
				s.PromptContext = ctx
				s.PromptType = promptType
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

func stripANSI(s string) string {
	return ansiEscape.ReplaceAllString(s, "")
}

func lastNLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	var nonEmpty []string
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			nonEmpty = append(nonEmpty, l)
		}
	}
	if len(nonEmpty) > n {
		nonEmpty = nonEmpty[len(nonEmpty)-n:]
	}
	return strings.Join(nonEmpty, "\n")
}

func classifyPromptType(context string) string {
	lines := strings.Split(context, "\n")
	for _, line := range lines {
		if yesnoPattern.MatchString(line) {
			return "yesno"
		}
	}
	for _, line := range lines {
		if strings.Contains(line, "❯") {
			return "select"
		}
	}
	if len(lines) > 0 {
		last := lines[len(lines)-1]
		if textPromptPattern.MatchString(last) {
			return "text"
		}
		if shellPattern.MatchString(last) {
			return "shell"
		}
	}
	return ""
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
