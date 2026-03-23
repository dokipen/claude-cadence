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

// defaultBufferSize is 1 byte less than 1 MB so that a ttyd replay frame
// (1-byte type prefix + buffer contents) fits within the hub proxy's
// MaxMessageSize (1 << 20) read limit.
const defaultBufferSize = 1<<20 - 1

const maxResizeDimension uint16 = 500

// PTYConfig holds configuration for PTYManager.
type PTYConfig struct {
	// BufferSize is the ring buffer capacity in bytes. Defaults to (1<<20)-1
	// to leave room for the ttyd frame prefix within the hub proxy's 1 MB limit.
	BufferSize int
	// MaxSessions is the maximum number of concurrent sessions. Zero means unlimited.
	MaxSessions int
}

// session holds per-session PTY state.
type session struct {
	id      string
	cmd     *exec.Cmd
	master  *os.File     // PTY master
	rb      *RingBuffer
	writers []io.Writer  // active WS writers (stub for future broadcast)
	done    chan struct{} // closed when PTY read goroutine exits AND cmd.Wait() has returned
	waitOnce sync.Once   // ensures cmd.Wait() is called exactly once
	waitErr  error       // result of cmd.Wait(), set by waitOnce
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
	if cols > maxResizeDimension {
		cols = maxResizeDimension
	}
	if rows > maxResizeDimension {
		rows = maxResizeDimension
	}
	if len(command) == 0 {
		return errors.New("pty: command must not be empty")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[id]; exists {
		return fmt.Errorf("pty: session %q already exists", id)
	}
	if m.cfg.MaxSessions > 0 && len(m.sessions) >= m.cfg.MaxSessions {
		return fmt.Errorf("pty: max sessions reached (%d)", m.cfg.MaxSessions)
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
	// When the child exits, the slave PTY fd closes and master.Read returns
	// EIO. We call cmd.Wait() here to reap the child so it does not become
	// a zombie — otherwise syscall.Kill(pid, 0) would still succeed and the
	// session.Manager reconciler would never mark the session as stopped.
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
				// Reap the child before signalling done. waitOnce ensures
				// Destroy's cmd.Wait() call is a harmless no-op if it races.
				sess.waitOnce.Do(func() { sess.waitErr = sess.cmd.Wait() })
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
	<-sess.done // wait for read goroutine to exit (it calls cmd.Wait via waitOnce)
	sess.waitOnce.Do(func() { sess.waitErr = sess.cmd.Wait() }) // no-op if goroutine already reaped
	return nil
}

// WaitError returns the error from cmd.Wait() for the given session, or an
// error if the session is not found or has not yet exited. Callers should
// wait until the session is no longer running before calling this.
func (m *PTYManager) WaitError(id string) (error, error) {
	m.mu.RLock()
	sess, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("pty: session %q not found", id)
	}
	select {
	case <-sess.done:
		return sess.waitErr, nil
	default:
		return nil, fmt.Errorf("pty: session %q has not exited", id)
	}
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
		return conn.Write(ctx, websocket.MessageBinary, msg)
	}

	wf := writerFunc(func(p []byte) (int, error) {
		if err := writeFrame(p); err != nil {
			return 0, err
		}
		return len(p), nil
	})

	// Capture snapshot and register writer atomically under sess.mu.
	// This prevents bytes written between snapshot capture and writer registration
	// from being missed or duplicated: the PTY read goroutine blocks on sess.mu
	// after writing to the ring buffer, so the snapshot and registration are
	// seen atomically relative to the fan-out path.
	sess.mu.Lock()
	snapshot := sess.rb.Snapshot()
	sess.writers = []io.Writer{wf}
	sess.mu.Unlock()
	defer func() {
		sess.mu.Lock()
		sess.writers = nil
		sess.mu.Unlock()
	}()

	// Replay buffered output to give the client recent context.
	if len(snapshot) > 0 {
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
					if resize.Columns > maxResizeDimension {
						resize.Columns = maxResizeDimension
					}
					if resize.Rows > maxResizeDimension {
						resize.Rows = maxResizeDimension
					}
					_ = pty.Setsize(sess.master, &pty.Winsize{
						Rows: resize.Rows,
						Cols: resize.Columns,
					})
				}
			}
		}
	}
}
