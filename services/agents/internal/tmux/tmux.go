package tmux

import (
	"fmt"
	"os/exec"
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
