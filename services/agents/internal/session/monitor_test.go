package session

import (
	"crypto/sha256"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
)

// newMonitorTestManager creates a Manager wired with a real PTYManager for
// monitor tests. The PTYManager is used by Monitor.check() via pty.ReadBuffer.
func newMonitorTestManager(ptyManager *pty.PTYManager) *Manager {
	store := NewStore()
	m := &Manager{
		store:    store,
		pty:      ptyManager,
		profiles: nil,
		ptyHasSession: func(id string) bool {
			_, err := ptyManager.PID(id)
			return err == nil
		},
		processAlive: func(pid int) bool { return true },
	}
	return m
}

// seedSnapshot inserts a snapshot into the monitor's internal map,
// simulating that content was first seen at firstSeen.
func seedSnapshot(m *Monitor, sessionID string, content string, firstSeen time.Time) {
	hash := sha256.Sum256([]byte(content))
	m.snapshots[sessionID] = &sessionSnapshot{
		contentHash: hash,
		firstSeen:   firstSeen,
	}
}

// TestMonitor_WaitingForInput_SetAfterIdleThreshold verifies that
// WaitingForInput becomes true after content is stable with a prompt
// pattern for at least idleThreshold.
func TestMonitor_WaitingForInput_SetAfterIdleThreshold(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})

	// Create a PTY session that holds a shell prompt.
	sessID := "monitor-test-idle"
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", "printf 'some output\\n> '; sleep 3600"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTYManager.Create: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	// Poll until the prompt appears in the ring buffer.
	deadline := time.Now().Add(5 * time.Second)
	var lastBuf []byte
	for time.Now().Before(deadline) {
		lastBuf, _ = ptyMgr.ReadBuffer(sessID)
		if len(lastBuf) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(lastBuf) == 0 {
		t.Fatal("timed out waiting for PTY output")
	}

	mgr := newMonitorTestManager(ptyMgr)
	// Add a running session to the store.
	sess := &Session{
		ID:    sessID,
		Name:  "test-idle",
		State: StateRunning,
	}
	mgr.store.Add(sess)

	mon := NewMonitor(mgr, ptyMgr, time.Second)

	// Pre-seed snapshot so the content appears "old enough" to cross the threshold.
	// We use the actual current buffer content so the hash matches what check() will see.
	buf, _ := ptyMgr.ReadBuffer(sessID)
	seedSnapshot(mon, sessID, string(buf), time.Now().Add(-(idleThreshold + time.Second)))

	// Run check() — content unchanged, prompt present, past threshold.
	mon.check()

	updated, ok := mgr.store.Get(sessID)
	if !ok {
		t.Fatal("session not found in store")
	}
	if !updated.WaitingForInput {
		t.Error("expected WaitingForInput=true after idle threshold with prompt, got false")
	}
	if updated.IdleSince == nil {
		t.Error("expected IdleSince to be set, got nil")
	}
}

// TestMonitor_WaitingForInput_ClearedOnContentChange verifies that
// WaitingForInput is cleared when content changes.
func TestMonitor_WaitingForInput_ClearedOnContentChange(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})

	sessID := "monitor-test-clear"
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", "printf 'line1\\n'; sleep 3600"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTYManager.Create: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	// Wait for initial output.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		buf, _ := ptyMgr.ReadBuffer(sessID)
		if len(buf) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	mgr := newMonitorTestManager(ptyMgr)
	idleSince := time.Now().Add(-time.Minute)
	sess := &Session{
		ID:              sessID,
		Name:            "test-clear",
		State:           StateRunning,
		WaitingForInput: true,
		IdleSince:       &idleSince,
	}
	mgr.store.Add(sess)

	mon := NewMonitor(mgr, ptyMgr, time.Second)

	// Seed snapshot with OLD content (different hash from current buffer).
	seedSnapshot(mon, sessID, "old-content-that-will-not-match", time.Now().Add(-time.Minute))

	// Run check() — content differs from snapshot, so WaitingForInput should clear.
	mon.check()

	updated, ok := mgr.store.Get(sessID)
	if !ok {
		t.Fatal("session not found in store")
	}
	if updated.WaitingForInput {
		t.Error("expected WaitingForInput=false after content change, got true")
	}
	if updated.IdleSince != nil {
		t.Error("expected IdleSince=nil after content change, got non-nil")
	}
}

// TestMonitor_NoPrompt_NeverSetsWaitingForInput verifies that content
// without a prompt pattern never sets WaitingForInput even after idleThreshold.
func TestMonitor_NoPrompt_NeverSetsWaitingForInput(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})

	sessID := "monitor-test-noprompt"
	// This command outputs text with no prompt pattern and sleeps.
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", "printf 'just some output without prompt'; sleep 3600"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTYManager.Create: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	// Wait for output to appear.
	deadline := time.Now().Add(5 * time.Second)
	var lastBuf []byte
	for time.Now().Before(deadline) {
		lastBuf, _ = ptyMgr.ReadBuffer(sessID)
		if len(lastBuf) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(lastBuf) == 0 {
		t.Fatal("timed out waiting for PTY output")
	}

	mgr := newMonitorTestManager(ptyMgr)
	sess := &Session{
		ID:    sessID,
		Name:  "test-noprompt",
		State: StateRunning,
	}
	mgr.store.Add(sess)

	mon := NewMonitor(mgr, ptyMgr, time.Second)

	// Seed snapshot with matching content but well past the idle threshold.
	buf, _ := ptyMgr.ReadBuffer(sessID)
	content := string(buf)
	// Verify the content does NOT match a prompt pattern before proceeding.
	lastLine := lastNonEmptyLine(content)
	if promptPatterns.MatchString(lastLine) {
		t.Skipf("PTY output last line %q unexpectedly matches a prompt; skipping", lastLine)
	}

	seedSnapshot(mon, sessID, content, time.Now().Add(-(idleThreshold + time.Second)))

	mon.check()

	updated, ok := mgr.store.Get(sessID)
	if !ok {
		t.Fatal("session not found in store")
	}
	if updated.WaitingForInput {
		t.Error("expected WaitingForInput=false for content without prompt pattern, got true")
	}
}

// TestMonitor_SnapshotPruned_WhenSessionRemoved verifies that snapshots for
// sessions no longer present in the store are pruned by check().
func TestMonitor_SnapshotPruned_WhenSessionRemoved(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})

	mgr := newMonitorTestManager(ptyMgr)
	mon := NewMonitor(mgr, ptyMgr, time.Second)

	// Plant a snapshot for a session that does NOT exist in the store.
	staleID := "stale-session-id"
	seedSnapshot(mon, staleID, "some content", time.Now().Add(-time.Hour))

	if _, exists := mon.snapshots[staleID]; !exists {
		t.Fatal("pre-condition: stale snapshot was not seeded")
	}

	// Also add a real running session with a live PTY so check() has something
	// to iterate (the stale session is NOT in the store).
	liveID := "monitor-test-live"
	err := ptyMgr.Create(liveID, t.TempDir(),
		[]string{"sh", "-c", "sleep 3600"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTYManager.Create: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(liveID) })

	liveSess := &Session{
		ID:    liveID,
		Name:  "live",
		State: StateRunning,
	}
	mgr.store.Add(liveSess)

	// Run check() — the stale session is not in the store, so its snapshot
	// must be pruned.
	mon.check()

	if _, exists := mon.snapshots[staleID]; exists {
		t.Error("expected stale snapshot to be pruned by check(), but it still exists")
	}
}

// TestMonitor_StartStop verifies the monitor goroutine starts and stops cleanly.
func TestMonitor_StartStop(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	mgr := newMonitorTestManager(ptyMgr)
	mon := NewMonitor(mgr, ptyMgr, 10*time.Millisecond)
	mon.Start()
	time.Sleep(50 * time.Millisecond)
	mon.Stop() // must return promptly without blocking
}

// TestLastNonEmptyLine exercises the lastNonEmptyLine helper.
func TestLastNonEmptyLine(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"simple last line", "line1\nline2\nline3", "line3"},
		{"trailing newlines stripped", "line1\nline2\n\n\n", "line2"},
		{"single line no newline", "hello", "hello"},
		{"single line with newline", "hello\n", "hello"},
		{"whitespace-only last line", "line1\n   \t\r\n", "line1"},
		{"prompt at end", "some output\n> ", ">"},
		{"empty string", "", ""},
		{"only newlines", "\n\n\n", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := lastNonEmptyLine(tt.input)
			if got != tt.want {
				t.Errorf("lastNonEmptyLine(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// TestPromptPatterns verifies the promptPatterns regexp matches expected
// patterns and does not match non-prompt lines.
func TestPromptPatterns(t *testing.T) {
	matching := []struct {
		name  string
		input string
	}{
		{"question mark", "Continue?"},
		{"greater-than prompt", ">"},
		{"greater-than with space", "> "},
		{"dollar prompt", "user@host $ "},
		{"hash prompt", "root# "},
		{"(y/n) prompt", "Proceed (y/n)"},
		{"(Y/n) prompt", "Overwrite? (Y/n)"},
		{"(yes/no) prompt", "Are you sure? (yes/no)"},
		{"unicode arrow prompt", "❯"},
	}
	for _, tt := range matching {
		t.Run("matches/"+tt.name, func(t *testing.T) {
			if !promptPatterns.MatchString(tt.input) {
				t.Errorf("promptPatterns should match %q but did not", tt.input)
			}
		})
	}

	notMatching := []struct {
		name  string
		input string
	}{
		{"plain text", "Processing..."},
		{"error message", "Error: something went wrong"},
		{"empty", ""},
	}
	for _, tt := range notMatching {
		t.Run("no-match/"+tt.name, func(t *testing.T) {
			if promptPatterns.MatchString(tt.input) {
				t.Errorf("promptPatterns should not match %q but did", tt.input)
			}
		})
	}
}

// TestStripANSI verifies that stripANSI removes all supported escape sequences
// while leaving plain text unchanged.
func TestStripANSI(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "plain text passthrough",
			input: "hello world",
			want:  "hello world",
		},
		{
			name:  "CSI color sequence",
			input: "\x1b[31mred text\x1b[0m",
			want:  "red text",
		},
		{
			name:  "CSI bold sequence",
			input: "\x1b[1mbold\x1b[22m",
			want:  "bold",
		},
		{
			name:  "CSI multi-param sequence",
			input: "\x1b[1;32mgreen bold\x1b[0m",
			want:  "green bold",
		},
		{
			name:  "CSI private-mode sequence (hide cursor)",
			input: "\x1b[?25ltext\x1b[?25h",
			want:  "text",
		},
		{
			name:  "OSC sequence terminated by BEL",
			input: "\x1b]0;window title\x07normal",
			want:  "normal",
		},
		{
			name:  "OSC sequence terminated by ST",
			input: "\x1b]2;title\x1b\\after",
			want:  "after",
		},
		{
			name:  "charset designator G0",
			input: "\x1b(Bplain",
			want:  "plain",
		},
		{
			name:  "charset designator G1",
			input: "\x1b)0plain",
			want:  "plain",
		},
		{
			name:  "mixed sequences and text",
			input: "\x1b[1mHello\x1b[0m, \x1b[32mworld\x1b[0m!",
			want:  "Hello, world!",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripANSI(tt.input)
			if got != tt.want {
				t.Errorf("stripANSI(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// TestLastNLines verifies that lastNLines returns the last n non-empty lines
// and correctly skips blank/whitespace-only lines.
func TestLastNLines(t *testing.T) {
	tests := []struct {
		name  string
		input string
		n     int
		want  string
	}{
		{
			name:  "empty input",
			input: "",
			n:     5,
			want:  "",
		},
		{
			name:  "fewer lines than N",
			input: "line1\nline2",
			n:     5,
			want:  "line1\nline2",
		},
		{
			name:  "exactly N lines",
			input: "line1\nline2\nline3",
			n:     3,
			want:  "line1\nline2\nline3",
		},
		{
			name:  "more than N lines returns last N",
			input: "line1\nline2\nline3\nline4\nline5",
			n:     3,
			want:  "line3\nline4\nline5",
		},
		{
			name:  "empty lines are skipped",
			input: "line1\n\n\nline2\n\nline3",
			n:     5,
			want:  "line1\nline2\nline3",
		},
		{
			name:  "whitespace-only lines are skipped",
			input: "line1\n   \n\t\nline2",
			n:     5,
			want:  "line1\nline2",
		},
		{
			name:  "empty lines skipped before taking last N",
			input: "a\nb\nc\n\nd\n\ne",
			n:     3,
			want:  "c\nd\ne",
		},
		{
			name:  "all blank lines",
			input: "\n\n\n",
			n:     5,
			want:  "",
		},
		{
			name:  "n=1 returns last non-empty line",
			input: "first\nsecond\nthird",
			n:     1,
			want:  "third",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := lastNLines(tt.input, tt.n)
			if got != tt.want {
				t.Errorf("lastNLines(%q, %d) = %q, want %q", tt.input, tt.n, got, tt.want)
			}
		})
	}
}

// TestClassifyPromptType verifies that classifyPromptType returns the correct
// prompt type string for each supported pattern.
func TestClassifyPromptType(t *testing.T) {
	tests := []struct {
		name    string
		context string
		want    string
	}{
		// yesno variants
		{
			name:    "yesno lowercase (y/n)",
			context: "Do you want to continue? (y/n)",
			want:    "yesno",
		},
		{
			name:    "yesno mixed (Y/n)",
			context: "Overwrite file? (Y/n)",
			want:    "yesno",
		},
		{
			name:    "yesno bracket lowercase [y/N]",
			context: "Accept changes [y/N]",
			want:    "yesno",
		},
		{
			name:    "yesno bracket mixed [Y/n]",
			context: "Proceed [Y/n]",
			want:    "yesno",
		},
		{
			name:    "yesno long form (yes/no)",
			context: "Continue? (yes/no)",
			want:    "yesno",
		},
		{
			name:    "yesno in middle line takes priority",
			context: "Some preamble\nAccept? (y/n)\n❯ option1",
			want:    "yesno",
		},
		// select variant
		{
			name:    "select with unicode arrow",
			context: "Pick one:\n❯ option1\n  option2",
			want:    "select",
		},
		{
			name:    "select arrow on its own line",
			context: "❯",
			want:    "select",
		},
		// text variants
		{
			name:    "text prompt ending with question mark",
			context: "What is your name?",
			want:    "text",
		},
		{
			name:    "text prompt ending with question mark and space",
			context: "What is your name? ",
			want:    "text",
		},
		{
			name:    "text prompt ending with greater-than",
			context: "Enter value >",
			want:    "text",
		},
		{
			name:    "text prompt ending with greater-than and space",
			context: "Enter value > ",
			want:    "text",
		},
		// shell variants
		{
			name:    "shell prompt ending with dollar sign",
			context: "user@host:~$",
			want:    "shell",
		},
		{
			name:    "shell prompt ending with dollar and space",
			context: "user@host:~$ ",
			want:    "shell",
		},
		{
			name:    "shell prompt ending with hash",
			context: "root@host:~#",
			want:    "shell",
		},
		{
			name:    "shell prompt ending with hash and space",
			context: "root@host:~# ",
			want:    "shell",
		},
		// empty / no match
		{
			name:    "plain text no matching pattern",
			context: "Processing files...",
			want:    "",
		},
		{
			name:    "empty string",
			context: "",
			want:    "",
		},
		{
			name:    "multi-line plain text no match",
			context: "Starting job\nRunning step 1\nDone",
			want:    "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyPromptType(tt.context)
			if got != tt.want {
				t.Errorf("classifyPromptType(%q) = %q, want %q", tt.context, got, tt.want)
			}
		})
	}
}
