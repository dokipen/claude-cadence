package pty

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

const defaultBufferSize = 1 << 20 // 1 MB

// PTYConfig holds configuration for PTYManager.
type PTYConfig struct {
	// BufferSize is the ring buffer capacity in bytes. Defaults to 1 MB.
	BufferSize int
}

// session holds per-session PTY state.
type session struct {
	id      string
	cmd     *exec.Cmd
	master  *os.File     // PTY master
	rb      *RingBuffer
	writers []io.Writer  // active WS writers (stub for future broadcast)
	done    chan struct{} // closed when PTY read goroutine exits
	mu      sync.Mutex
}

// PTYManager manages PTY sessions.
type PTYManager struct {
	sessions map[string]*session
	mu       sync.RWMutex
	cfg      PTYConfig
}

// NewPTYManager creates a PTYManager with the given config.
func NewPTYManager(cfg PTYConfig) *PTYManager {
	if cfg.BufferSize == 0 {
		cfg.BufferSize = defaultBufferSize
	}
	return &PTYManager{
		sessions: make(map[string]*session),
		cfg:      cfg,
	}
}

// Create starts a new PTY session. id must be unique. command is a slice of
// args (not a shell string). cols and rows of 0 default to 80x24.
func (m *PTYManager) Create(id, workdir string, command []string, env []string, cols, rows uint16) error {
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	if len(command) == 0 {
		return errors.New("pty: command must not be empty")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[id]; exists {
		return fmt.Errorf("pty: session %q already exists", id)
	}

	cmd := exec.Command(command[0], command[1:]...)
	cmd.Dir = workdir
	if env != nil {
		cmd.Env = env
	}

	master, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return fmt.Errorf("pty: start: %w", err)
	}

	sess := &session{
		id:     id,
		cmd:    cmd,
		master: master,
		rb:     NewRingBuffer(m.cfg.BufferSize),
		done:   make(chan struct{}),
	}
	m.sessions[id] = sess

	// Read goroutine: fan PTY output to ring buffer and active writers.
	go func() {
		defer close(sess.done)
		buf := make([]byte, 4096)
		for {
			n, readErr := master.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				_, _ = sess.rb.Write(chunk)
				sess.mu.Lock()
				for _, w := range sess.writers {
					_, _ = w.Write(chunk)
				}
				sess.mu.Unlock()
			}
			if readErr != nil {
				return
			}
		}
	}()

	return nil
}

// Get returns the internal session by ID. Returns an error if not found.
func (m *PTYManager) Get(id string) (*session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sess, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("pty: session %q not found", id)
	}
	return sess, nil
}

// PID returns the PID of the child process for the given session.
func (m *PTYManager) PID(id string) (int, error) {
	sess, err := m.Get(id)
	if err != nil {
		return 0, err
	}
	if sess.cmd.Process == nil {
		return 0, fmt.Errorf("pty: session %q has no process", id)
	}
	return sess.cmd.Process.Pid, nil
}

// Destroy terminates the PTY session and cleans up its resources.
func (m *PTYManager) Destroy(id string) error {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("pty: session %q not found", id)
	}
	delete(m.sessions, id)
	m.mu.Unlock()

	if sess.cmd.Process != nil {
		_ = sess.cmd.Process.Kill()
	}
	_ = sess.master.Close()
	_ = sess.cmd.Wait() // reap the child
	<-sess.done         // wait for read goroutine to exit
	return nil
}

// ReadBuffer returns a snapshot of the ring buffer for the given session.
// Used as a drop-in replacement for tmux.CapturePane.
func (m *PTYManager) ReadBuffer(id string) ([]byte, error) {
	sess, err := m.Get(id)
	if err != nil {
		return nil, err
	}
	return sess.rb.Snapshot(), nil
}

// resizeMsg is the JSON payload for ttyd resize frames.
type resizeMsg struct {
	Columns uint16 `json:"columns"`
	Rows    uint16 `json:"rows"`
}

// writerFunc is a function that implements io.Writer.
type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }

// ServeTerminal handles a WebSocket terminal connection for an existing session.
// It speaks the ttyd binary framing protocol (same as the existing ttyd implementation)
// so Terminal.tsx requires no changes during this phase.
//
// Frame format:
//   - Server->Client text frame: byte '0' + raw terminal bytes
//   - Client->Server text frame: byte '0' + input bytes (write to PTY)
//   - Client->Server text frame: byte '1' + JSON resize {"columns":C,"rows":R}
//
// A new connection displaces any prior active connection on the same session.
func (m *PTYManager) ServeTerminal(ctx context.Context, id string, conn *websocket.Conn) error {
	sess, err := m.Get(id)
	if err != nil {
		return err
	}

	writeFrame := func(data []byte) error {
		msg := make([]byte, len(data)+1)
		msg[0] = '0'
		copy(msg[1:], data)
		return conn.Write(ctx, websocket.MessageText, msg)
	}

	// Use a pointer to a writerFunc so we can compare by pointer identity later.
	wp := new(writerFunc)
	*wp = func(p []byte) (int, error) {
		if err := writeFrame(p); err != nil {
			return 0, err
		}
		return len(p), nil
	}

	// Register this writer, displacing any prior active connection.
	sess.mu.Lock()
	sess.writers = []io.Writer{wp}
	sess.mu.Unlock()
	defer func() {
		sess.mu.Lock()
		sess.writers = nil
		sess.mu.Unlock()
	}()

	// Replay ring buffer to give the client recent context.
	if snapshot := sess.rb.Snapshot(); len(snapshot) > 0 {
		_ = writeFrame(snapshot) // best-effort
	}

	// Read loop: process input and resize frames from the client.
	for {
		_, data, readErr := conn.Read(ctx)
		if readErr != nil {
			return nil // client disconnected — not an error
		}
		if len(data) == 0 {
			continue
		}
		switch data[0] {
		case '0': // input to PTY
			_, _ = sess.master.Write(data[1:])
		case '1': // resize
			var resize resizeMsg
			if jsonErr := json.Unmarshal(data[1:], &resize); jsonErr == nil {
				if resize.Columns > 0 && resize.Rows > 0 {
					_ = pty.Setsize(sess.master, &pty.Winsize{
						Rows: resize.Rows,
						Cols: resize.Columns,
					})
				}
			}
		}
	}
}
