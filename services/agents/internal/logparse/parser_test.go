package logparse

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

// baseTime is a fixed reference time used across all test fixtures.
var baseTime = time.Date(2026, 3, 25, 10, 0, 0, 0, time.UTC)

// since is set 5 minutes before baseTime so all fixtures at baseTime are included.
var since = baseTime.Add(-5 * time.Minute)

// makeLine builds a slog JSON log line from the given key-value pairs.
// The "time" field is always set to baseTime in RFC3339Nano format.
func makeLine(msg string, kvs ...any) []byte {
	m := map[string]any{
		"time":  baseTime.Format(time.RFC3339Nano),
		"level": "INFO",
		"msg":   msg,
	}
	for i := 0; i+1 < len(kvs); i += 2 {
		k, _ := kvs[i].(string)
		m[k] = kvs[i+1]
	}
	b, _ := json.Marshal(m)
	return b
}

func TestParseLineSessionDeath(t *testing.T) {
	line := makeLine("auto-destroying session: process no longer alive",
		"id", "sess-abc",
		"name", "code-reviewer-1",
		"pid", float64(12345),
		"exit_error", "signal: killed",
	)
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventSessionDeath {
		t.Errorf("type = %q, want %q", ev.Type, EventSessionDeath)
	}
	if ev.SessionID != "sess-abc" {
		t.Errorf("session_id = %q, want %q", ev.SessionID, "sess-abc")
	}
	if ev.SessionName != "code-reviewer-1" {
		t.Errorf("session_name = %q, want %q", ev.SessionName, "code-reviewer-1")
	}
	if ev.PID != 12345 {
		t.Errorf("pid = %d, want 12345", ev.PID)
	}
	if ev.ExitError != "signal: killed" {
		t.Errorf("exit_error = %q, want %q", ev.ExitError, "signal: killed")
	}
	if ev.ExitCode != nil {
		t.Errorf("exit_code should be nil for non-zero exit, got %v", ev.ExitCode)
	}
}

func TestParseLineSessionDeathCleanExit(t *testing.T) {
	line := makeLine("auto-destroying session: process no longer alive",
		"id", "sess-xyz",
		"name", "tester-2",
		"pid", float64(99),
		"exit_code", float64(0),
	)
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventSessionDeath {
		t.Errorf("type = %q, want %q", ev.Type, EventSessionDeath)
	}
	if ev.ExitCode == nil {
		t.Fatal("exit_code should be non-nil for clean exit")
	}
	if *ev.ExitCode != 0 {
		t.Errorf("exit_code = %d, want 0", *ev.ExitCode)
	}
	if ev.ExitError != "" {
		t.Errorf("exit_error should be empty, got %q", ev.ExitError)
	}
}

func TestParseLineFastExit(t *testing.T) {
	line := makeLine("session command exited immediately",
		"session", "sess-fast",
		"error", "exit status 1",
	)
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventFastExit {
		t.Errorf("type = %q, want %q", ev.Type, EventFastExit)
	}
	if ev.SessionID != "sess-fast" {
		t.Errorf("session_id = %q, want %q", ev.SessionID, "sess-fast")
	}
	if ev.Error != "exit status 1" {
		t.Errorf("error = %q, want %q", ev.Error, "exit status 1")
	}
}

func TestParseLineStuckCreating(t *testing.T) {
	// age logged as time.Duration (int64 nanoseconds).
	ageNs := float64(5 * time.Minute)
	line := makeLine("reaping stuck StateCreating session",
		"id", "sess-stuck",
		"name", "slow-agent",
		"age", ageNs,
	)
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventStuckCreating {
		t.Errorf("type = %q, want %q", ev.Type, EventStuckCreating)
	}
	if ev.SessionID != "sess-stuck" {
		t.Errorf("session_id = %q, want %q", ev.SessionID, "sess-stuck")
	}
	if ev.Age == "" {
		t.Error("age should not be empty")
	}
}

func TestParseLineStaleTTL(t *testing.T) {
	line := makeLine("destroying stale session",
		"id", "sess-stale",
		"name", "old-session",
		"state", "stopped",
		"age", "2h0m0s",
	)
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventStaleTTL {
		t.Errorf("type = %q, want %q", ev.Type, EventStaleTTL)
	}
	if ev.SessionID != "sess-stale" {
		t.Errorf("session_id = %q, want %q", ev.SessionID, "sess-stale")
	}
	if ev.Age != "2h0m0s" {
		t.Errorf("age = %q, want %q", ev.Age, "2h0m0s")
	}
}

func TestParseLineHubDisconnect(t *testing.T) {
	line := makeLine("hub connection failed",
		"error", "dial tcp: connection refused",
	)
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventHubDisconnect {
		t.Errorf("type = %q, want %q", ev.Type, EventHubDisconnect)
	}
	if ev.Error != "dial tcp: connection refused" {
		t.Errorf("error = %q, want %q", ev.Error, "dial tcp: connection refused")
	}
}

func TestParseLineUnknownMessage(t *testing.T) {
	line := makeLine("some unrecognised log message", "key", "value")
	_, ok := parseLine(line, since)
	if ok {
		t.Error("expected parseLine to return ok=false for unknown message")
	}
}

func TestParseLineBeforeSince(t *testing.T) {
	// Timestamp is 10 minutes before since — should be filtered out.
	old := baseTime.Add(-10 * time.Minute)
	m := map[string]any{
		"time":       old.Format(time.RFC3339Nano),
		"level":      "INFO",
		"msg":        "auto-destroying session: process no longer alive",
		"id":         "old-sess",
		"name":       "old",
		"pid":        float64(1),
		"exit_error": "signal: killed",
	}
	data, _ := json.Marshal(m)
	_, ok := parseLine(data, since)
	if ok {
		t.Error("expected parseLine to return ok=false for event before since")
	}
}

func TestParseLogsFromFile(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "agentd-*.log")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	lines := [][]byte{
		makeLine("auto-destroying session: process no longer alive",
			"id", "s1", "name", "n1", "pid", float64(100), "exit_error", "signal: killed"),
		makeLine("destroying stale session",
			"id", "s2", "name", "n2", "state", "stopped", "age", "1h0m0s"),
		makeLine("unrelated log line"),
	}
	for _, l := range lines {
		f.Write(l)
		f.Write([]byte("\n"))
	}
	f.Close()

	events, err := ParseLogs(context.Background(), f.Name(), since)
	if err != nil {
		t.Fatalf("ParseLogs returned error: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2", len(events))
	}
	if events[0].Type != EventSessionDeath {
		t.Errorf("events[0].Type = %q, want %q", events[0].Type, EventSessionDeath)
	}
	if events[1].Type != EventStaleTTL {
		t.Errorf("events[1].Type = %q, want %q", events[1].Type, EventStaleTTL)
	}
}

func TestParseLogsJournaldEnvelope(t *testing.T) {
	// Test that parseLine correctly handles a plain slog JSON string
	// (the MESSAGE field after extraction from the journald envelope).
	inner := makeLine("hub connection failed", "error", "timeout")
	ev, ok := parseLine(inner, since)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if ev.Type != EventHubDisconnect {
		t.Errorf("type = %q, want %q", ev.Type, EventHubDisconnect)
	}
}
