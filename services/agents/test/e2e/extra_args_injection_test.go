package e2e_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	agentsv1 "github.com/dokipen/claude-cadence/services/agents/gen/agents/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCreateSession_ExtraArgsNullByte(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()

	_, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "echo-args",
		SessionName:  uniqueSessionName(t),
		ExtraArgs:    []string{"hello\x00world"},
	})
	if err == nil {
		t.Fatal("expected error for null byte in ExtraArgs, got nil")
	}
	if code := status.Code(err); code != codes.InvalidArgument {
		t.Errorf("expected InvalidArgument, got %v", code)
	}
}

func TestCreateSession_ExtraArgsInjection(t *testing.T) {
	client := newTestClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	// Create a temp file path that the injection would create if unescaped.
	markerFile := filepath.Join(t.TempDir(), "injection-marker")

	// This payload, if unsanitized and sent to a shell via the PTY manager,
	// would create the marker file. With proper escaping it should be treated
	// as a literal string argument to echo.
	payload := "safe; touch " + markerFile

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "echo-args",
		SessionName:  name,
		ExtraArgs:    []string{payload},
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	sess := resp.GetSession()
	if sess.GetId() == "" {
		t.Error("expected non-empty session ID")
	}

	// Wait for the command to execute in the PTY.
	time.Sleep(1 * time.Second)

	// The marker file must NOT exist — if it does, the injection succeeded.
	if _, err := os.Stat(markerFile); err == nil {
		t.Fatalf("SECURITY: injection marker file was created at %s — ExtraArgs were not properly sanitized", markerFile)
	}
}
