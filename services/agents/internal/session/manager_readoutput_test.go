package session

import (
	"strings"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
)

// newReadOutputTestManager creates a Manager wired with the given PTYManager
// for ReadOutput tests.
func newReadOutputTestManager(ptyManager *pty.PTYManager) *Manager {
	store := NewStore()
	return NewManager(store, ptyManager, nil, nil, map[string]config.Profile{}, 0)
}

// waitForContent polls ptyMgr.ReadBuffer until substr appears or the deadline
// is exceeded, then returns the raw buffer.
func waitForContent(t *testing.T, ptyMgr *pty.PTYManager, sessID, substr string) []byte {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		buf, err := ptyMgr.ReadBuffer(sessID)
		if err != nil {
			t.Fatalf("ReadBuffer failed: %v", err)
		}
		if strings.Contains(string(buf), substr) {
			return buf
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %q in PTY buffer; got: %q", substr, string(buf))
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestReadOutput_CRLFNormalization verifies that \r\n line endings produced by
// the PTY are normalised to \n so no \r artifacts appear in the output.
func TestReadOutput_CRLFNormalization(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	sessID := "readoutput-crlf"

	// PTYs convert \n to \r\n on output; just write a simple multi-line script
	// and confirm no \r survives ReadOutput.
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", "printf 'alpha\\nbeta\\ngamma\\n'; sleep 3600"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTY Create failed: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	waitForContent(t, ptyMgr, sessID, "gamma")

	m := newReadOutputTestManager(ptyMgr)
	out, err := m.ReadOutput(sessID, 50)
	if err != nil {
		t.Fatalf("ReadOutput error: %v", err)
	}

	if strings.Contains(out, "\r") {
		t.Errorf("ReadOutput output still contains \\r: %q", out)
	}
}

// TestReadOutput_TrailingEmptyLinesDropped verifies that blank lines at the
// end of the buffer are not included in the returned output.
func TestReadOutput_TrailingEmptyLinesDropped(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	sessID := "readoutput-trailing"

	// Emit content followed by several blank lines.
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", "printf 'content\\n\\n\\n\\n'; sleep 3600"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTY Create failed: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	// Wait until the trailing blank lines have also been flushed to the buffer.
	// printf 'content\n\n\n\n' emits all bytes in one call, but the PTY layer
	// may deliver them in multiple reads, so poll until at least two consecutive
	// newlines follow "content".
	waitForContent(t, ptyMgr, sessID, "content\r\n\r\n")

	m := newReadOutputTestManager(ptyMgr)
	out, err := m.ReadOutput(sessID, 50)
	if err != nil {
		t.Fatalf("ReadOutput error: %v", err)
	}

	if strings.HasSuffix(out, "\n") {
		t.Errorf("ReadOutput output ends with blank line(s): %q", out)
	}
	if out == "" {
		t.Error("ReadOutput returned empty string; expected at least 'content'")
	}
}

// TestReadOutput_LastNLines_Truncation verifies that when more than N lines are
// present, only the last N are returned.
func TestReadOutput_LastNLines_Truncation(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	sessID := "readoutput-lastn"

	// Write 20 numbered lines.
	script := `for i in $(seq 1 20); do printf "line%d\n" "$i"; done; sleep 3600`
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", script},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTY Create failed: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	waitForContent(t, ptyMgr, sessID, "line20")

	m := newReadOutputTestManager(ptyMgr)
	out, err := m.ReadOutput(sessID, 5)
	if err != nil {
		t.Fatalf("ReadOutput error: %v", err)
	}

	t.Run("contains_last_lines", func(t *testing.T) {
		for _, want := range []string{"line16", "line17", "line18", "line19", "line20"} {
			if !strings.Contains(out, want) {
				t.Errorf("expected %q in last-5 output, got: %q", want, out)
			}
		}
	})

	t.Run("excludes_early_lines", func(t *testing.T) {
		// Split on newlines and check exact line values to avoid substring
		// false positives (e.g. "line1" matching "line16").
		lineSet := make(map[string]bool)
		for _, l := range strings.Split(out, "\n") {
			lineSet[strings.TrimSpace(l)] = true
		}
		for _, notWant := range []string{"line1", "line2", "line3", "line4", "line5",
			"line6", "line7", "line8", "line9", "line10",
			"line11", "line12", "line13", "line14", "line15"} {
			if lineSet[notWant] {
				t.Errorf("unexpected line %q in last-5 output, got: %q", notWant, out)
			}
		}
	})
}

// TestReadOutput_ANSIStrip_AllBranches verifies that every ANSI/VT escape
// sequence category handled by ansiEscapeRe is stripped from the output.
func TestReadOutput_ANSIStrip_AllBranches(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	sessID := "readoutput-ansi"

	// One line per ansiEscapeRe branch:
	//   CSI sequence      \033[32mtext\033[0m
	//   OSC sequence      \033]0;title\007
	//   Two-byte ESC      \033=   (keypad application mode)
	//   Charset designator \033(B  (US ASCII charset)
	script := `printf '\033[32mcolortext\033[0m\n'
printf '\033]0;mytitle\007osc_line\n'
printf '\033=twobyte\n'
printf '\033(Bcharset\n'
printf 'plaintext\n'
sleep 3600`
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", script},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTY Create failed: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	waitForContent(t, ptyMgr, sessID, "plaintext")

	m := newReadOutputTestManager(ptyMgr)
	out, err := m.ReadOutput(sessID, 50)
	if err != nil {
		t.Fatalf("ReadOutput error: %v", err)
	}

	t.Run("no_ESC_bytes_remain", func(t *testing.T) {
		if strings.ContainsRune(out, '\x1b') {
			t.Errorf("ESC byte remains in output: %q", out)
		}
	})

	t.Run("text_content_preserved", func(t *testing.T) {
		for _, want := range []string{"colortext", "plaintext"} {
			if !strings.Contains(out, want) {
				t.Errorf("expected %q to survive ANSI strip, got: %q", want, out)
			}
		}
	})
}

// TestReadOutput_OSCSequence_NoNewlineArtifacts verifies that an OSC sequence
// whose body contains a literal newline does not leave stray ESC or BEL bytes
// in the output after ReadOutput processes it.
//
// The PTY will convert the \n inside the OSC body to \r\n; after CRLF
// normalisation the line is split at that point, so the OSC sequence body is
// truncated at \n rather than spanning lines.  The \x07 BEL terminator then
// falls on the next line and must be stripped by the control-character branch.
func TestReadOutput_OSCSequence_NoNewlineArtifacts(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	sessID := "readoutput-osc-newline"

	// Emit an OSC window-title sequence whose body contains a literal \n,
	// followed by visible text on the same logical "line".
	// printf interprets \033 as ESC, \007 as BEL, \n as newline.
	script := `printf '\033]0;title\npart2\007some visible text\n'; sleep 3600`
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", script},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTY Create failed: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	waitForContent(t, ptyMgr, sessID, "some visible text")

	m := newReadOutputTestManager(ptyMgr)
	out, err := m.ReadOutput(sessID, 50)
	if err != nil {
		t.Fatalf("ReadOutput error: %v", err)
	}

	t.Run("no_ESC_bytes", func(t *testing.T) {
		if strings.ContainsRune(out, '\x1b') {
			t.Errorf("ESC byte remains in output: %q", out)
		}
	})

	t.Run("no_BEL_bytes", func(t *testing.T) {
		if strings.ContainsRune(out, '\x07') {
			t.Errorf("BEL byte remains in output: %q", out)
		}
	})

	t.Run("visible_text_present", func(t *testing.T) {
		if !strings.Contains(out, "some visible text") {
			t.Errorf("expected %q in output, got: %q", "some visible text", out)
		}
	})
}

// TestReadOutput_LinesLimit verifies that a lines=2 request returns exactly 2
// lines from a 10-line buffer.
func TestReadOutput_LinesLimit(t *testing.T) {
	ptyMgr := pty.NewPTYManager(pty.PTYConfig{BufferSize: 65536})
	sessID := "readoutput-limit"

	script := `for i in $(seq 1 10); do printf "item%d\n" "$i"; done; sleep 3600`
	err := ptyMgr.Create(sessID, t.TempDir(),
		[]string{"sh", "-c", script},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("PTY Create failed: %v", err)
	}
	t.Cleanup(func() { ptyMgr.Destroy(sessID) })

	waitForContent(t, ptyMgr, sessID, "item10")

	m := newReadOutputTestManager(ptyMgr)
	out, err := m.ReadOutput(sessID, 2)
	if err != nil {
		t.Fatalf("ReadOutput error: %v", err)
	}

	lines := strings.Split(out, "\n")
	// Filter out empty strings that result from splitting (shouldn't happen after
	// trailing-empty-line trimming, but be defensive).
	var nonEmpty []string
	for _, l := range lines {
		if l != "" {
			nonEmpty = append(nonEmpty, l)
		}
	}

	t.Run("exactly_two_lines", func(t *testing.T) {
		if len(nonEmpty) != 2 {
			t.Errorf("expected 2 non-empty lines, got %d: %q", len(nonEmpty), out)
		}
	})

	t.Run("last_two_items", func(t *testing.T) {
		if !strings.Contains(out, "item9") || !strings.Contains(out, "item10") {
			t.Errorf("expected item9 and item10 in output, got: %q", out)
		}
	})
}
