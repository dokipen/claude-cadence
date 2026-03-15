package ttyd

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
)

// Client manages ttyd processes for tmux sessions.
type Client struct {
	mu        sync.Mutex
	enabled   bool
	basePort  int
	maxPorts  int
	nextPort  int
	freePorts []int
	// sessionID -> process info
	procs map[string]*procInfo
}

type procInfo struct {
	pid  int
	port int
}

// NewClient creates a new ttyd Client.
// If enabled is false, all operations are no-ops.
// maxPorts limits the port range to [basePort, basePort+maxPorts).
func NewClient(enabled bool, basePort, maxPorts int) *Client {
	return &Client{
		enabled:  enabled,
		basePort: basePort,
		maxPorts: maxPorts,
		nextPort: basePort,
		procs:    make(map[string]*procInfo),
	}
}

// ErrPortsExhausted is returned when all ports in the configured range are in use.
var ErrPortsExhausted = errors.New("all ttyd ports are in use")

// Start launches a ttyd process for the given tmux session.
// Returns the websocket URL, or empty string if ttyd is disabled.
func (c *Client) Start(sessionID, tmuxSocketName, tmuxSessionName string) (string, error) {
	if !c.enabled {
		return "", nil
	}

	c.mu.Lock()
	var port int
	if n := len(c.freePorts); n > 0 {
		port = c.freePorts[n-1]
		c.freePorts = c.freePorts[:n-1]
	} else if c.nextPort < c.basePort+c.maxPorts {
		port = c.nextPort
		c.nextPort++
	} else {
		c.mu.Unlock()
		return "", ErrPortsExhausted
	}
	c.mu.Unlock()

	// ttyd -i 127.0.0.1 -p <port> -W tmux -L <socket> attach-session -t <session>
	cmd := exec.Command("ttyd",
		"-i", "127.0.0.1",
		"-p", fmt.Sprintf("%d", port),
		"-W",
		"tmux", "-L", tmuxSocketName, "attach-session", "-t", tmuxSessionName,
	)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("starting ttyd: %w", err)
	}

	c.mu.Lock()
	c.procs[sessionID] = &procInfo{
		pid:  cmd.Process.Pid,
		port: port,
	}
	c.mu.Unlock()

	slog.Info("ttyd started", "session", sessionID, "port", port, "pid", cmd.Process.Pid)

	url := fmt.Sprintf("ws://127.0.0.1:%d", port)
	return url, nil
}

// Stop kills the ttyd process for the given session.
func (c *Client) Stop(sessionID string) {
	if !c.enabled {
		return
	}

	c.mu.Lock()
	info, ok := c.procs[sessionID]
	if ok {
		delete(c.procs, sessionID)
		c.freePorts = append(c.freePorts, info.port)
	}
	c.mu.Unlock()

	if !ok {
		return
	}

	proc, err := os.FindProcess(info.pid)
	if err != nil {
		slog.Warn("ttyd process not found", "pid", info.pid, "error", err)
		return
	}

	if err := proc.Signal(os.Interrupt); err != nil {
		slog.Warn("failed to signal ttyd, trying kill", "pid", info.pid, "error", err)
		_ = proc.Kill()
	}

	slog.Info("ttyd stopped", "session", sessionID, "pid", info.pid)
}

// Port returns the port assigned to a session, or 0 if not found.
func (c *Client) Port(sessionID string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if info, ok := c.procs[sessionID]; ok {
		return info.port
	}
	return 0
}
