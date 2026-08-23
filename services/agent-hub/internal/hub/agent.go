package hub

import (
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// AgentStatus represents the connection status of an agent.
type AgentStatus string

const (
	StatusOnline  AgentStatus = "online"
	StatusOffline AgentStatus = "offline"
)

// terminalChannelBufSize is the buffer size for per-session terminal relay channels.
// 256 entries absorbs larger PTY output bursts (e.g. cat of a large file) without
// dropping frames or blocking the read loop.
const terminalChannelBufSize = 256

// ConnectedAgent represents a registered agentd instance.
// All mutable fields (Status, LastSeen, conn, pending) are protected by mu.
// terminalChannels and terminalMu are independent to avoid lock ordering issues.
type ConnectedAgent struct {
	Name       string                 `json:"name"`
	Profiles   map[string]ProfileInfo `json:"profiles"`
	TtydConfig TtydInfo               `json:"ttyd"`

	mu                     sync.Mutex
	status                 AgentStatus
	lastSeen               time.Time
	conn                   *websocket.Conn
	pending                map[string]chan *Response
	consecutiveRPCFailures int

	terminalMu       sync.Mutex
	terminalChannels map[uuid.UUID]*terminalRelay
}

// terminalRelay is one registered relay channel. The close-once guard makes
// closing idempotent across all closers (the registration's cleanup func,
// CloseTerminalChannel, and CloseTerminalChannels), so a relay that the hub
// tore down on disconnect can still be cleaned up by its owner without a
// double-close panic.
type terminalRelay struct {
	ch        chan []byte
	closeOnce sync.Once
}

func (r *terminalRelay) close() {
	r.closeOnce.Do(func() { close(r.ch) })
}

// NewConnectedAgent creates a new agent entry.
func NewConnectedAgent(name string, conn *websocket.Conn, params *RegisterParams) *ConnectedAgent {
	return &ConnectedAgent{
		Name:             name,
		Profiles:         params.Profiles,
		status:           StatusOnline,
		TtydConfig:       params.Ttyd,
		lastSeen:         time.Now(),
		conn:             conn,
		pending:          make(map[string]chan *Response),
		terminalChannels: make(map[uuid.UUID]*terminalRelay),
	}
}

// Conn returns the agent's WebSocket connection.
func (a *ConnectedAgent) Conn() *websocket.Conn {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.conn
}

// Status returns the agent's current status.
func (a *ConnectedAgent) Status() AgentStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.status
}

// LastSeen returns the agent's last-seen timestamp.
func (a *ConnectedAgent) LastSeen() time.Time {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.lastSeen
}

// SetStatus sets the agent's status.
func (a *ConnectedAgent) SetStatus(s AgentStatus) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.status = s
}

// incRPCFailures increments the consecutive RPC failure counter and returns the new value.
func (a *ConnectedAgent) incRPCFailures() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.consecutiveRPCFailures++
	return a.consecutiveRPCFailures
}

// resetRPCFailures resets the consecutive RPC failure counter to zero.
func (a *ConnectedAgent) resetRPCFailures() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.consecutiveRPCFailures = 0
}

// Touch updates the agent's last-seen timestamp.
func (a *ConnectedAgent) Touch() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lastSeen = time.Now()
}

// RegisterTerminalRelay creates a buffered channel for terminal frames for the
// given session. Returns the receive channel and a cleanup function that
// removes the registration and closes the channel. Calling the cleanup
// function more than once is safe.
func (a *ConnectedAgent) RegisterTerminalRelay(sessionID uuid.UUID) (<-chan []byte, func()) {
	relay := &terminalRelay{ch: make(chan []byte, terminalChannelBufSize)}

	a.terminalMu.Lock()
	a.terminalChannels[sessionID] = relay
	a.terminalMu.Unlock()

	cleanup := func() {
		a.terminalMu.Lock()
		// Only delete if the map still points to OUR relay.
		if a.terminalChannels[sessionID] == relay {
			delete(a.terminalChannels, sessionID)
		}
		a.terminalMu.Unlock()
		// Idempotent: safe even if CloseTerminalChannel(s) already closed it.
		relay.close()
	}
	return relay.ch, cleanup
}

// DeliverTerminalFrame routes a decoded frame payload to the channel registered
// for sessionID. Returns false if no relay is registered for that session.
func (a *ConnectedAgent) DeliverTerminalFrame(sessionID uuid.UUID, payload []byte) bool {
	a.terminalMu.Lock()
	relay, ok := a.terminalChannels[sessionID]
	a.terminalMu.Unlock()

	if !ok {
		return false
	}
	ch := relay.ch

	// Copy payload so the caller's buffer can be reused.
	buf := make([]byte, len(payload))
	copy(buf, payload)

	select {
	case ch <- buf:
		return true
	default:
		// Channel full — drop the frame rather than blocking the read loop.
		slog.Warn("terminal relay channel full, dropping frame",
			"session_id", sessionID,
			"payload_len", len(payload),
		)
		return false
	}
}

// CloseTerminalChannel closes the relay channel for a single session and removes
// it from the map. Safe to call when no relay is registered for the session.
func (a *ConnectedAgent) CloseTerminalChannel(sessionID uuid.UUID) {
	a.terminalMu.Lock()
	defer a.terminalMu.Unlock()
	if relay, ok := a.terminalChannels[sessionID]; ok {
		relay.close()
		delete(a.terminalChannels, sessionID)
	}
}

// CloseTerminalChannels closes all terminal relay channels and clears the map.
// This unblocks any relay goroutines waiting on the channels, causing them to
// see ok=false and clean up.
func (a *ConnectedAgent) CloseTerminalChannels() {
	a.terminalMu.Lock()
	defer a.terminalMu.Unlock()

	for id, relay := range a.terminalChannels {
		relay.close()
		delete(a.terminalChannels, id)
	}
}
