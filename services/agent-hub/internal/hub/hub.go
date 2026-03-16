package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// MaxMessageSize is the maximum allowed WebSocket message size (64 KiB).
const MaxMessageSize = 64 * 1024

// Hub manages registered agentd connections.
type Hub struct {
	mu     sync.RWMutex
	agents map[string]*ConnectedAgent

	heartbeatInterval time.Duration
	heartbeatTimeout  time.Duration
	agentTTL          time.Duration

	cancel context.CancelFunc
	done   chan struct{}
}

// New creates a new Hub.
func New(heartbeatInterval, heartbeatTimeout, agentTTL time.Duration) *Hub {
	return &Hub{
		agents:            make(map[string]*ConnectedAgent),
		heartbeatInterval: heartbeatInterval,
		heartbeatTimeout:  heartbeatTimeout,
		agentTTL:          agentTTL,
		done:              make(chan struct{}),
	}
}

// Start begins the background reaper goroutine that removes stale agents.
func (h *Hub) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go h.reaper(ctx)
}

// Stop shuts down the hub, closing all agent connections.
func (h *Hub) Stop() {
	if h.cancel != nil {
		h.cancel()
	}
	<-h.done

	h.mu.Lock()
	defer h.mu.Unlock()
	for name, agent := range h.agents {
		agent.Conn().Close(websocket.StatusGoingAway, "hub shutting down")
		delete(h.agents, name)
	}
}

// Register adds or re-registers an agent. If an agent with the same name
// already exists, the old connection is closed and replaced.
func (h *Hub) Register(name string, conn *websocket.Conn, params *RegisterParams) *ConnectedAgent {
	h.mu.Lock()
	defer h.mu.Unlock()

	if existing, ok := h.agents[name]; ok {
		slog.Warn("replacing existing agent connection", "agent", name)
		existing.Conn().Close(websocket.StatusGoingAway, "replaced by new connection")
	}

	agent := NewConnectedAgent(name, conn, params)
	h.agents[name] = agent
	slog.Info("agent registered", "agent", name, "profiles", len(params.Profiles))
	return agent
}

// MarkOffline sets an agent's status to offline without removing it.
// The reaper will clean it up after the TTL expires.
func (h *Hub) MarkOffline(name string) {
	h.mu.RLock()
	agent, ok := h.agents[name]
	h.mu.RUnlock()

	if ok {
		agent.SetStatus(StatusOffline)
		slog.Info("agent marked offline", "agent", name)
	}
}

// Get returns an agent by name.
func (h *Hub) Get(name string) (*ConnectedAgent, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	agent, ok := h.agents[name]
	return agent, ok
}

// AgentInfo is a snapshot of an agent's state for the REST API.
type AgentInfo struct {
	Name     string                 `json:"name"`
	Profiles map[string]ProfileInfo `json:"profiles"`
	Status   AgentStatus            `json:"status"`
	LastSeen time.Time              `json:"last_seen"`
}

// List returns a snapshot of all registered agents.
func (h *Hub) List() []AgentInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()

	list := make([]AgentInfo, 0, len(h.agents))
	for _, agent := range h.agents {
		list = append(list, AgentInfo{
			Name:     agent.Name,
			Profiles: agent.Profiles,
			Status:   agent.Status(),
			LastSeen: agent.LastSeen(),
		})
	}
	return list
}

// CallError is returned by Call when the agent returns a JSON-RPC error.
type CallError struct {
	RPCError *RPCError
}

func (e *CallError) Error() string {
	return e.RPCError.Message
}

// Call sends a JSON-RPC request to the agent and waits for the response.
// It returns the raw result JSON on success, or a *CallError on RPC error.
func (h *Hub) Call(ctx context.Context, agent *ConnectedAgent, method string, params any) (json.RawMessage, error) {
	if agent.Status() != StatusOnline {
		return nil, fmt.Errorf("agent offline")
	}

	id := "req-" + uuid.NewString()
	req, err := NewRequest(id, method, params)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// Register pending response channel.
	respCh := make(chan *Response, 1)
	agent.mu.Lock()
	agent.pending[id] = respCh
	agent.mu.Unlock()

	// Clean up on exit.
	defer func() {
		agent.mu.Lock()
		delete(agent.pending, id)
		agent.mu.Unlock()
	}()

	writeCtx, writeCancel := context.WithTimeout(ctx, h.heartbeatTimeout)
	err = agent.Conn().Write(writeCtx, websocket.MessageText, data)
	writeCancel()
	if err != nil {
		return nil, fmt.Errorf("write request: %w", err)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case resp := <-respCh:
		if resp.Error != nil {
			return nil, &CallError{RPCError: resp.Error}
		}
		return resp.Result, nil
	}
}

// HandleAgentConnection processes messages from a connected agent.
// It blocks until the connection is closed or an error occurs.
func (h *Hub) HandleAgentConnection(ctx context.Context, agent *ConnectedAgent) {
	agent.Conn().SetReadLimit(MaxMessageSize)

	go h.heartbeatLoop(ctx, agent)

	for {
		_, data, err := agent.Conn().Read(ctx)
		if err != nil {
			slog.Info("agent connection closed", "agent", agent.Name, "error", err)
			h.MarkOffline(agent.Name)
			return
		}

		agent.Touch()

		var msg Response
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Warn("invalid message from agent", "agent", agent.Name, "error", err)
			continue
		}

		// Route responses to pending request channels.
		if msg.ID != "" {
			agent.mu.Lock()
			if ch, ok := agent.pending[msg.ID]; ok {
				ch <- &msg
				delete(agent.pending, msg.ID)
			}
			agent.mu.Unlock()
		}
	}
}

// heartbeatLoop sends periodic ping requests to the agent.
func (h *Hub) heartbeatLoop(ctx context.Context, agent *ConnectedAgent) {
	ticker := time.NewTicker(h.heartbeatInterval)
	defer ticker.Stop()

	pingID := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingID++
			id := fmt.Sprintf("ping-%d", pingID)

			req, err := NewRequest(id, "ping", nil)
			if err != nil {
				slog.Warn("failed to create ping request", "agent", agent.Name, "error", err)
				continue
			}

			data, err := json.Marshal(req)
			if err != nil {
				continue
			}

			// Set up response channel.
			respCh := make(chan *Response, 1)
			agent.mu.Lock()
			agent.pending[id] = respCh
			agent.mu.Unlock()

			writeCtx, writeCancel := context.WithTimeout(ctx, h.heartbeatTimeout)
			err = agent.Conn().Write(writeCtx, websocket.MessageText, data)
			writeCancel()
			if err != nil {
				slog.Warn("failed to send ping", "agent", agent.Name, "error", err)
				agent.mu.Lock()
				delete(agent.pending, id)
				agent.mu.Unlock()
				h.MarkOffline(agent.Name)
				return
			}

			// Wait for pong response.
			select {
			case <-ctx.Done():
				agent.mu.Lock()
				delete(agent.pending, id)
				agent.mu.Unlock()
				return
			case <-time.After(h.heartbeatTimeout):
				slog.Warn("heartbeat timeout", "agent", agent.Name)
				agent.mu.Lock()
				delete(agent.pending, id)
				agent.mu.Unlock()
				h.MarkOffline(agent.Name)
				return
			case <-respCh:
				// Pong received, agent is alive.
			}
		}
	}
}

// reaper periodically removes agents that have been offline longer than the TTL.
func (h *Hub) reaper(ctx context.Context) {
	defer close(h.done)

	ticker := time.NewTicker(h.agentTTL / 2)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.mu.Lock()
			now := time.Now()
			for name, agent := range h.agents {
				if agent.Status() == StatusOffline && now.Sub(agent.LastSeen()) > h.agentTTL {
					slog.Info("reaping stale agent", "agent", name, "last_seen", agent.LastSeen())
					delete(h.agents, name)
				}
			}
			h.mu.Unlock()
		}
	}
}
