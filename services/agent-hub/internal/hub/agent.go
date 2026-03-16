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
type ConnectedAgent struct {
	Name       string                 `json:"name"`
	Profiles   map[string]ProfileInfo `json:"profiles"`
	Status     AgentStatus            `json:"status"`
	TtydConfig TtydInfo               `json:"ttyd"`
	LastSeen   time.Time              `json:"last_seen"`

	mu      sync.Mutex
	conn    *websocket.Conn
	pending map[string]chan *Response
}

// NewConnectedAgent creates a new agent entry.
func NewConnectedAgent(name string, conn *websocket.Conn, params *RegisterParams) *ConnectedAgent {
	return &ConnectedAgent{
		Name:       name,
		Profiles:   params.Profiles,
		Status:     StatusOnline,
		TtydConfig: params.Ttyd,
		LastSeen:   time.Now(),
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

// Touch updates the agent's last-seen timestamp.
func (a *ConnectedAgent) Touch() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.LastSeen = time.Now()
}
