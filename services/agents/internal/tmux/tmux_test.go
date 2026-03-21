package tmux

import (
	"fmt"
	"os"
	"os/exec"
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
