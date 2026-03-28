// Package logparse reads agentd's structured log output and extracts diagnostic events.
//
// On Linux with no log path configured, it queries journald for the "agentd" unit.
// On macOS (or when log.path is set), it reads the configured log file directly.
package logparse

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"time"
)

// journaldUnit is the systemd unit name used for agentd log queries.
const journaldUnit = "agentd"

// EventType identifies the category of a diagnostic event.
type EventType string

const (
	// EventSessionDeath is logged when a session's process is found dead and is auto-destroyed.
	EventSessionDeath EventType = "session_death"
	// EventFastExit is logged when a session command exits immediately after launch.
	EventFastExit EventType = "fast_exit"
	// EventStuckCreating is logged when a session is reaped after being stuck in StateCreating.
	EventStuckCreating EventType = "stuck_creating"
	// EventStaleTTL is logged when a stopped session is destroyed after exceeding its TTL.
	EventStaleTTL EventType = "stale_ttl_destroy"
	// EventHubDisconnect is logged when the hub WebSocket connection fails.
	EventHubDisconnect EventType = "hub_disconnect"
)

// DiagnosticEvent is a single structured event extracted from agentd logs.
type DiagnosticEvent struct {
	Time        time.Time `json:"ts"`
	Type        EventType `json:"type"`
	SessionID   string    `json:"session_id,omitempty"`
	SessionName string    `json:"session_name,omitempty"`
	PID         int       `json:"pid,omitempty"`
	ExitError   string    `json:"exit_error,omitempty"`
	ExitCode    *int      `json:"exit_code,omitempty"`
	Age         string    `json:"age,omitempty"`
	Error       string    `json:"error,omitempty"`
}

// ParseLogs reads log entries since `since` and returns matching diagnostic events.
//
// Source selection:
//   - If logPath is non-empty, reads from the named file.
//   - If logPath is empty and the runtime is Linux, queries journald.
//   - Otherwise returns nil, nil (no log source available).
func ParseLogs(ctx context.Context, logPath string, since time.Time) ([]DiagnosticEvent, error) {
	if logPath != "" {
		return readFile(logPath, since)
	}
	if runtime.GOOS == "linux" {
		return readJournald(ctx, since)
	}
	slog.Warn("no log source available for diagnostics: set log.path in config on non-Linux hosts")
	return nil, nil
}

// readFile scans a slog JSON log file and returns events at or after `since`.
// It seeks to the end of the file and scans backwards, stopping once it finds
// a line before `since`, so only the relevant tail is processed.
func readFile(logPath string, since time.Time) ([]DiagnosticEvent, error) {
	f, err := os.Open(logPath)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat log file: %w", err)
	}

	const chunkSize = 256 * 1024 // 256 KiB
	size := fi.Size()
	offset := size

	var (
		pending []byte
		events  []DiagnosticEvent
		done    bool
	)

	for offset > 0 && !done {
		readSize := int64(chunkSize)
		if readSize > offset {
			readSize = offset
		}
		offset -= readSize

		buf := make([]byte, readSize)
		if _, err := f.ReadAt(buf, offset); err != nil {
			return nil, fmt.Errorf("read log file: %w", err)
		}

		// Prepend the leftover bytes from the previous iteration that form
		// the right half of a line split at a chunk boundary.
		chunk := append(buf, pending...)
		pending = nil

		// Split on newlines. The first element may be a partial line
		// (its left half is in the next chunk to the left) — save it.
		lines := bytes.Split(chunk, []byte("\n"))
		partial := lines[0]
		lines = lines[1:]

		// Process lines right-to-left (newest first within this chunk).
		for i := len(lines) - 1; i >= 0; i-- {
			line := bytes.TrimSpace(lines[i])
			if len(line) == 0 {
				continue
			}
			ev, ok := parseLine(line, since)
			if !ok {
				// Check if this line's timestamp is before since — if so, stop.
				var entry map[string]any
				if json.Unmarshal(line, &entry) == nil {
					if tsStr, ok := entry["time"].(string); ok {
						if ts, err := time.Parse(time.RFC3339Nano, tsStr); err == nil {
							if ts.Before(since) {
								done = true
								break
							}
						}
					}
				}
				continue
			}
			events = append(events, ev)
		}

		pending = partial
	}

	// Process the final partial line (leftmost bytes of the file, if any).
	if !done && len(bytes.TrimSpace(pending)) > 0 {
		ev, ok := parseLine(bytes.TrimSpace(pending), since)
		if ok {
			events = append(events, ev)
		}
	}

	// Events were collected newest-first; reverse to restore ascending order.
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}

	return events, nil
}

// readJournald execs journalctl and returns events at or after `since`.
func readJournald(ctx context.Context, since time.Time) ([]DiagnosticEvent, error) {
	sinceStr := since.Format("2006-01-02 15:04:05")
	cmd := exec.CommandContext(ctx, "journalctl",
		"-u", journaldUnit,
		"--since", sinceStr,
		"-o", "json",
		"--no-pager",
		"-n", "10000",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("journalctl stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("journalctl start: %w", err)
	}

	var events []DiagnosticEvent
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 1<<20), 1<<20)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var envelope map[string]any
		if err := json.Unmarshal(line, &envelope); err != nil {
			continue
		}
		msg, ok := envelope["MESSAGE"].(string)
		if !ok || len(msg) == 0 {
			continue
		}
		ev, ok := parseLine([]byte(msg), since)
		if ok {
			events = append(events, ev)
		}
	}

	if err := cmd.Wait(); err != nil {
		// journalctl exits 0 when there are no matching entries.
		return nil, fmt.Errorf("journalctl: %w", err)
	}
	return events, nil
}

// parseLine parses a single slog JSON log line and returns a DiagnosticEvent if it
// matches a known event type and its timestamp is at or after `since`.
func parseLine(data []byte, since time.Time) (DiagnosticEvent, bool) {
	var entry map[string]any
	if err := json.Unmarshal(data, &entry); err != nil {
		return DiagnosticEvent{}, false
	}

	// Parse timestamp from slog "time" field.
	tsStr, _ := entry["time"].(string)
	if tsStr == "" {
		return DiagnosticEvent{}, false
	}
	ts, err := time.Parse(time.RFC3339Nano, tsStr)
	if err != nil {
		ts, err = time.Parse(time.RFC3339, tsStr)
		if err != nil {
			return DiagnosticEvent{}, false
		}
	}
	if ts.Before(since) {
		return DiagnosticEvent{}, false
	}

	msgStr, _ := entry["msg"].(string)

	ev := DiagnosticEvent{Time: ts}

	switch msgStr {
	case "auto-destroying session: process no longer alive":
		ev.Type = EventSessionDeath
		ev.SessionID, _ = entry["id"].(string)
		ev.SessionName, _ = entry["name"].(string)
		if pid, ok := entry["pid"].(float64); ok {
			ev.PID = int(pid)
		}
		if exitErr, ok := entry["exit_error"].(string); ok {
			ev.ExitError = exitErr
		}
		if exitCode, ok := entry["exit_code"].(float64); ok {
			c := int(exitCode)
			ev.ExitCode = &c
		}

	case "session command exited immediately":
		ev.Type = EventFastExit
		// manager.go logs with "session" key (not "id").
		ev.SessionID, _ = entry["session"].(string)
		ev.Error, _ = entry["error"].(string)

	case "reaping stuck StateCreating session":
		ev.Type = EventStuckCreating
		ev.SessionID, _ = entry["id"].(string)
		ev.SessionName, _ = entry["name"].(string)
		// age is logged as time.Duration (int64 nanoseconds in JSON).
		if age, ok := entry["age"].(float64); ok {
			ev.Age = time.Duration(int64(age)).String()
		} else if age, ok := entry["age"].(string); ok {
			ev.Age = age
		}

	case "destroying stale session":
		ev.Type = EventStaleTTL
		ev.SessionID, _ = entry["id"].(string)
		ev.SessionName, _ = entry["name"].(string)
		// age is logged with .String() so it's already a string.
		ev.Age, _ = entry["age"].(string)

	case "hub connection failed":
		ev.Type = EventHubDisconnect
		ev.Error, _ = entry["error"].(string)

	default:
		return DiagnosticEvent{}, false
	}

	return ev, true
}
