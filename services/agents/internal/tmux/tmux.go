package tmux

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Client wraps tmux CLI operations using a dedicated socket.
type Client struct {
	socketName string
}

// NewClient creates a new tmux client using the given socket name.
func NewClient(socketName string) *Client {
	return &Client{socketName: socketName}
}

// SocketName returns the tmux socket name.
func (c *Client) SocketName() string {
	return c.socketName
}

// baseArgs returns the common tmux flags for this client's socket, suppressing user config.
func (c *Client) baseArgs() []string {
	return []string{"-L", c.socketName, "-f", "/dev/null"}
}

// NewSession creates a new tmux session. If command is non-empty, it is used as
// the initial command for the session (the session exits when the command exits).
// Returns error if the session already exists.
func (c *Client) NewSession(name string, workdir string, command string) error {
	args := append(c.baseArgs(), "new-session", "-d", "-s", name, "-c", workdir)
	if command != "" {
		args = append(args, command)
	}
	// Chain set-option in the same tmux invocation so mouse mode is set before
	// the server can exit (relevant when the session command is short-lived).
	args = append(args, ";", "set-option", "-g", "mouse", "on")
	cmd := exec.Command("tmux", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("tmux new-session: %w: %s", err, string(output))
	}
	return nil
}

// HasSession checks if a tmux session exists.
func (c *Client) HasSession(name string) bool {
	cmd := exec.Command("tmux", append(c.baseArgs(), "has-session", "-t", name)...)
	return cmd.Run() == nil
}

// KillSession destroys a tmux session.
func (c *Client) KillSession(name string) error {
	cmd := exec.Command("tmux", append(c.baseArgs(), "kill-session", "-t", name)...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("tmux kill-session: %w: %s", err, string(output))
	}
	return nil
}

// SendKeys sends a command string to a tmux session.
func (c *Client) SendKeys(name string, keys string) error {
	cmd := exec.Command("tmux", append(c.baseArgs(), "send-keys", "-t", name, keys, "Enter")...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("tmux send-keys: %w: %s", err, string(output))
	}
	return nil
}

// SetEnv sets an environment variable in a tmux session.
func (c *Client) SetEnv(name string, key string, value string) error {
	cmd := exec.Command("tmux", append(c.baseArgs(), "set-environment", "-t", name, key, value)...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("tmux set-environment: %w: %s", err, string(output))
	}
	return nil
}

// GetPanePID returns the PID of the process running in the session's pane.
func (c *Client) GetPanePID(name string) (int, error) {
	cmd := exec.Command("tmux", append(c.baseArgs(), "list-panes", "-t", name, "-F", "#{pane_pid}")...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("tmux list-panes: %w: %s", err, string(output))
	}
	pidStr := strings.TrimSpace(string(output))
	// Take only the first line in case of multiple panes.
	if lines := strings.Split(pidStr, "\n"); len(lines) > 0 {
		pidStr = strings.TrimSpace(lines[0])
	}
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return 0, fmt.Errorf("parsing pane PID %q: %w", pidStr, err)
	}
	return pid, nil
}

// CapturePane captures the visible content of a tmux pane.
func (c *Client) CapturePane(name string) (string, error) {
	cmd := exec.Command("tmux", append(c.baseArgs(), "capture-pane", "-t", name, "-p")...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("tmux capture-pane: %w: %s", err, string(output))
	}
	return string(output), nil
}

// CleanupStaleSocket removes the tmux socket file if no server is responding on it.
// This handles the case where a previous agentd process left a stale socket behind.
// The socket path is resolved using the same logic tmux uses internally.
func (c *Client) CleanupStaleSocket() error {
	// Resolve socket path: tmux uses $TMUX_TMPDIR if set, otherwise os.TempDir().
	tmpdir := os.Getenv("TMUX_TMPDIR")
	if tmpdir == "" {
		tmpdir = os.TempDir()
	}
	socketPath := filepath.Join(tmpdir, fmt.Sprintf("tmux-%d", os.Getuid()), c.socketName)

	// If socket doesn't exist, nothing to clean. Use Lstat to avoid following symlinks.
	info, err := os.Lstat(socketPath)
	if os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("stat tmux socket %s: %w", socketPath, err)
	}

	// Refuse to remove anything that isn't a socket to prevent accidental deletion
	// of regular files or symlinks that may have been placed at this path.
	if info.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("refusing to remove non-socket file at %s", socketPath)
	}

	// Probe whether a tmux server is responding on this socket.
	cmd := exec.Command("tmux", append(c.baseArgs(), "list-sessions")...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		outStr := string(output)
		if strings.Contains(outStr, "no server running") || strings.Contains(outStr, "error connecting") {
			// Socket is stale — no server behind it.
			if removeErr := os.Remove(socketPath); removeErr != nil {
				return fmt.Errorf("remove stale tmux socket %s: %w", socketPath, removeErr)
			}
			return nil
		}
		return fmt.Errorf("probe tmux server: %w: %s", err, string(output))
	}

	// Server is responding — leave the socket alone.
	return nil
}

// ListSessions returns names of all tmux sessions on this socket.
func (c *Client) ListSessions() ([]string, error) {
	cmd := exec.Command("tmux", append(c.baseArgs(), "list-sessions", "-F", "#{session_name}")...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// If no server is running, tmux exits with error. Return empty list.
		if strings.Contains(string(output), "no server running") ||
			strings.Contains(string(output), "no sessions") {
			return nil, nil
		}
		return nil, fmt.Errorf("tmux list-sessions: %w: %s", err, string(output))
	}
	raw := strings.TrimSpace(string(output))
	if raw == "" {
		return nil, nil
	}
	return strings.Split(raw, "\n"), nil
}
