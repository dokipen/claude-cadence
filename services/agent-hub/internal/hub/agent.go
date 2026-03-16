package hub

import (
	"sync"
	"time"

	"github.com/coder/websocket"
)

// AgentStatus represents the connection status of an agent.
type AgentStatus string

const (
	StatusOnline  AgentStatus = "online"
	StatusOffline AgentStatus = "offline"
)

// ConnectedAgent represents a registered agentd instance.
// All mutable fields (Status, LastSeen, conn, pending) are protected by mu.
type ConnectedAgent struct {
	Name       string                 `json:"name"`
	Profiles   map[string]ProfileInfo `json:"profiles"`
	TtydConfig TtydInfo               `json:"ttyd"`

	mu       sync.Mutex
	status   AgentStatus
	lastSeen time.Time
	conn     *websocket.Conn
	pending  map[string]chan *Response
}

// NewConnectedAgent creates a new agent entry.
func NewConnectedAgent(name string, conn *websocket.Conn, params *RegisterParams) *ConnectedAgent {
	return &ConnectedAgent{
		Name:       name,
		Profiles:   params.Profiles,
		status:     StatusOnline,
		TtydConfig: params.Ttyd,
		lastSeen:   time.Now(),
		conn:       conn,
		pending:    make(map[string]chan *Response),
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

// Touch updates the agent's last-seen timestamp.
func (a *ConnectedAgent) Touch() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lastSeen = time.Now()
}
