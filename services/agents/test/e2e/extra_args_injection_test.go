package e2e_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

func TestCreateSession_ExtraArgsNullByte(t *testing.T) {
	_, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "echo-args",
		SessionName:  uniqueSessionName(t),
		ExtraArgs:    []string{"hello\x00world"},
	})
	if err == nil {
		t.Fatal("expected error for null byte in ExtraArgs, got nil")
	}
	var sessErr *session.Error
	if !errors.As(err, &sessErr) || sessErr.Code != session.ErrInvalidArgument {
		t.Errorf("expected ErrInvalidArgument, got %v", err)
	}
}

func TestCreateSession_ExtraArgsInjection(t *testing.T) {
	name := uniqueSessionName(t)

	// Create a temp file path that the injection would create if unescaped.
	markerFile := filepath.Join(t.TempDir(), "injection-marker")

	// This payload, if unsanitized and sent to a shell via the PTY manager,
	// would create the marker file. With proper escaping it should be treated
	// as a literal string argument to echo.
	payload := "safe; touch " + markerFile

	sess, err := testMgr.Create(session.CreateRequest{
		AgentProfile: "echo-args",
		SessionName:  name,
		ExtraArgs:    []string{payload},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Cleanup(func() {
		testMgr.Destroy(sess.ID, true)
	})

	if sess.ID == "" {
		t.Error("expected non-empty session ID")
	}

	// Wait for the command to execute in the PTY.
	time.Sleep(1 * time.Second)

	// The marker file must NOT exist — if it does, the injection succeeded.
	if _, err := os.Stat(markerFile); err == nil {
		t.Fatalf("SECURITY: injection marker file was created at %s — ExtraArgs were not properly sanitized", markerFile)
	}
}
