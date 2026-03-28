package session

import (
	"bytes"
	"strings"
	"testing"
)

// buildFakeOutput builds ~1 MB of realistic PTY output: lines containing ANSI
// color codes, text, and a trailing newline. The result mirrors what
// RingBuffer.Snapshot() returns before ReadOutput processes it.
func buildFakeOutput() []byte {
	// One line ~80 bytes with ANSI color codes, similar to real terminal output.
	line := "\x1b[32mINFO\x1b[0m  2024/01/15 12:34:56 agent running session-id-12345678\r\n"
	lineLen := len(line)
	// Target ~1 MB.
	targetBytes := 1 << 20
	count := targetBytes / lineLen
	var buf bytes.Buffer
	buf.Grow(count * lineLen)
	for i := 0; i < count; i++ {
		buf.WriteString(line)
	}
	return buf.Bytes()
}

// BenchmarkReadOutput_Current benchmarks the original approach:
// ANSI-strip the full ~1 MB buffer, then split into lines and slice the tail.
func BenchmarkReadOutput_Current(b *testing.B) {
	raw := buildFakeOutput()
	const tailLines = 50
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		normalized := bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
		clean := ansiEscapeRe.ReplaceAll(normalized, nil)
		all := strings.Split(string(clean), "\n")
		for len(all) > 0 && all[len(all)-1] == "" {
			all = all[:len(all)-1]
		}
		if len(all) > tailLines {
			all = all[len(all)-tailLines:]
		}
		_ = strings.Join(all, "\n")
	}
}

// BenchmarkReadOutput_Optimized benchmarks the new approach:
// split into lines and slice the tail first, then ANSI-strip only the small
// joined string (~4 KB instead of ~1 MB).
func BenchmarkReadOutput_Optimized(b *testing.B) {
	raw := buildFakeOutput()
	const tailLines = 50
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		normalized := bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
		all := strings.Split(string(normalized), "\n")
		for len(all) > 0 && all[len(all)-1] == "" {
			all = all[:len(all)-1]
		}
		if len(all) > tailLines {
			all = all[len(all)-tailLines:]
		}
		tail := strings.Join(all, "\n")
		_ = ansiEscapeRe.ReplaceAllString(tail, "")
	}
}
