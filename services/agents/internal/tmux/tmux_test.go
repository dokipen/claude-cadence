package tmux

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewSession_MouseModeEnabled(t *testing.T) {
	socketName := fmt.Sprintf("tmux-test-mouse-%d", os.Getpid())
	client := NewClient(socketName)

	workdir := t.TempDir()
	sessionName := "test-mouse-session"

	if err := client.NewSession(sessionName, workdir, "sleep 30"); err != nil {
		t.Fatalf("NewSession failed: %v", err)
	}
	defer func() {
		if err := client.KillSession(sessionName); err != nil {
			t.Logf("KillSession cleanup failed: %v", err)
		}
	}()

	cmd := exec.Command("tmux", "-L", socketName, "-f", "/dev/null", "show-options", "-g", "mouse")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("show-options failed: %v: %s", err, string(output))
	}

	if !strings.Contains(string(output), "mouse on") {
		t.Errorf("expected output to contain %q, got: %s", "mouse on", string(output))
	}
}

func TestCleanupStaleSocket_NoSocket(t *testing.T) {
	socketName := fmt.Sprintf("tmux-test-cleanup-%d", os.Getpid())
	client := NewClient(socketName)

	if err := client.CleanupStaleSocket(); err != nil {
		t.Fatalf("CleanupStaleSocket with no socket file: %v", err)
	}
}

func TestCleanupStaleSocket_StaleSocket(t *testing.T) {
	socketName := fmt.Sprintf("tmux-test-stale-%d", os.Getpid())

	// Resolve the socket dir using the same logic as the implementation.
	tmpdir := os.Getenv("TMUX_TMPDIR")
	if tmpdir == "" {
		tmpdir = os.TempDir()
	}
	socketDir := filepath.Join(tmpdir, fmt.Sprintf("tmux-%d", os.Getuid()))
	socketPath := filepath.Join(socketDir, socketName)

	// Create the socket directory if needed.
	if err := os.MkdirAll(socketDir, 0o700); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	// Create a fake socket file (regular file — no server will respond).
	if err := os.WriteFile(socketPath, []byte("stale"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	t.Cleanup(func() {
		os.Remove(socketPath)
	})

	client := NewClient(socketName)

	if err := client.CleanupStaleSocket(); err != nil {
		t.Fatalf("CleanupStaleSocket: %v", err)
	}

	// Verify the socket file was removed.
	if _, err := os.Stat(socketPath); !os.IsNotExist(err) {
		t.Errorf("expected socket file to be removed, but it still exists")
	}
}

func TestCleanupStaleSocket_LiveServer(t *testing.T) {
	socketName := fmt.Sprintf("tmux-test-live-%d", os.Getpid())
	client := NewClient(socketName)

	workdir := t.TempDir()
	sessionName := "cleanup-test"

	if err := client.NewSession(sessionName, workdir, "sleep 30"); err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	t.Cleanup(func() {
		if err := client.KillSession(sessionName); err != nil {
			t.Logf("KillSession cleanup failed: %v", err)
		}
	})

	// CleanupStaleSocket should leave the live socket alone.
	if err := client.CleanupStaleSocket(); err != nil {
		t.Fatalf("CleanupStaleSocket: %v", err)
	}

	// Verify the session still exists.
	if !client.HasSession(sessionName) {
		t.Errorf("expected session %q to still exist after CleanupStaleSocket", sessionName)
	}
}
