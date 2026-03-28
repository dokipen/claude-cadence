package logparse

import (
	"context"
	"encoding/json"
	"os"
	"runtime"
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

func TestParseLineHubTimeout(t *testing.T) {
	line := makeLine("heartbeat timeout", "agent", "worker-1")
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventHubTimeout {
		t.Errorf("type = %q, want %q", ev.Type, EventHubTimeout)
	}
	if ev.Agent != "worker-1" {
		t.Errorf("agent = %q, want %q", ev.Agent, "worker-1")
	}
}

func TestParseLineAgentOffline(t *testing.T) {
	line := makeLine("agent marked offline", "agent", "worker-2")
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventAgentOffline {
		t.Errorf("type = %q, want %q", ev.Type, EventAgentOffline)
	}
	if ev.Agent != "worker-2" {
		t.Errorf("agent = %q, want %q", ev.Agent, "worker-2")
	}
}

func TestParseLineAgentConnClosed(t *testing.T) {
	line := makeLine("agent connection closed", "agent", "worker-3", "error", "connection reset by peer")
	ev, ok := parseLine(line, since)
	if !ok {
		t.Fatal("expected parseLine to return ok=true")
	}
	if ev.Type != EventAgentConnClosed {
		t.Errorf("type = %q, want %q", ev.Type, EventAgentConnClosed)
	}
	if ev.Agent != "worker-3" {
		t.Errorf("agent = %q, want %q", ev.Agent, "worker-3")
	}
	if ev.Error != "connection reset by peer" {
		t.Errorf("error = %q, want %q", ev.Error, "connection reset by peer")
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
		"time":  old.Format(time.RFC3339Nano),
		"level": "INFO",
		"msg":   "heartbeat timeout",
		"agent": "worker-1",
	}
	data, _ := json.Marshal(m)
	_, ok := parseLine(data, since)
	if ok {
		t.Error("expected parseLine to return ok=false for event before since")
	}
}

func TestParseLogsFromFile(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "agent-hub-*.log")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	lines := [][]byte{
		makeLine("heartbeat timeout", "agent", "worker-1"),
		makeLine("agent marked offline", "agent", "worker-2"),
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
	if events[0].Type != EventHubTimeout {
		t.Errorf("events[0].Type = %q, want %q", events[0].Type, EventHubTimeout)
	}
	if events[1].Type != EventAgentOffline {
		t.Errorf("events[1].Type = %q, want %q", events[1].Type, EventAgentOffline)
	}
}

func TestParseLogsNoLogSource(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("journald path, skipping on Linux")
	}
	events, err := ParseLogs(context.Background(), "", time.Now().Add(-1*time.Hour))
	if err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}
	if events != nil {
		t.Fatalf("expected nil events, got: %v", events)
	}
}
