package hub

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/logparse"
)

func TestGetDiagnostics_HappyPath(t *testing.T) {
	d := newTestDispatcher()
	ctx := context.Background()

	result, rpcErr := d.GetDiagnostics(ctx, json.RawMessage(`{"since_minutes": 60}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpcError: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}

	var out diagnosticsResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}

	// events and session slices must be non-nil (not JSON null).
	if out.Events == nil {
		t.Error("expected non-nil events slice")
	}
	if out.Sessions.Running == nil {
		t.Error("expected non-nil Sessions.Running slice")
	}
	if out.Sessions.Stopped == nil {
		t.Error("expected non-nil Sessions.Stopped slice")
	}
	if out.Sessions.Error == nil {
		t.Error("expected non-nil Sessions.Error slice")
	}
	if out.Sessions.Creating == nil {
		t.Error("expected non-nil Sessions.Creating slice")
	}

	// Summary must reflect the since_minutes we passed.
	if out.Summary.SinceMinutes != 60 {
		t.Errorf("expected SinceMinutes=60, got %d", out.Summary.SinceMinutes)
	}
}

func TestGetDiagnostics_ContextCancellation(t *testing.T) {
	d := newTestDispatcher()

	// Use an already-cancelled context.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	// GetDiagnostics should complete quickly (log parsing respects ctx cancellation).
	// It must not block longer than ~100ms regardless.
	result, rpcErr := d.GetDiagnostics(ctx, json.RawMessage(`{"since_minutes": 60}`))
	elapsed := time.Since(start)

	if elapsed > 500*time.Millisecond {
		t.Errorf("GetDiagnostics took too long with cancelled context: %v", elapsed)
	}

	// Either an rpcError is returned, or a result with empty events is returned.
	// Both are acceptable — the key requirement is that it returns promptly.
	if rpcErr != nil {
		// An error response is fine.
		return
	}

	// If it returned a result, it should be a valid diagnosticsResult.
	var out diagnosticsResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	// With cancelled context, log parsing may have failed; events should still be non-nil.
	if out.Events == nil {
		t.Error("expected non-nil events slice even on cancelled context")
	}
}

func TestGetDiagnostics_DefaultSinceMinutes(t *testing.T) {
	d := newTestDispatcher()
	ctx := context.Background()

	// Pass empty params — since_minutes should default to 10080 (7 days).
	result, rpcErr := d.GetDiagnostics(ctx, json.RawMessage(`{}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpcError: code=%d msg=%s", rpcErr.Code, rpcErr.Message)
	}

	var out diagnosticsResult
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}

	const defaultSinceMinutes = 10080 // 7 days
	if out.Summary.SinceMinutes != defaultSinceMinutes {
		t.Errorf("expected SinceMinutes=%d (default), got %d", defaultSinceMinutes, out.Summary.SinceMinutes)
	}
}

// Ensure the logparse package types are referenced so the import is used.
var _ = logparse.DiagnosticEvent{}
