package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	sharedrelay "github.com/dokipen/claude-cadence/services/shared/relay"
)

// ErrAdvertiseAddressChanged is returned when a re-registering agent attempts
// to change its AdvertiseAddress.
var ErrAdvertiseAddressChanged = errors.New("advertise address changed on re-registration")

// maxConsecutiveRPCFailures is the number of consecutive RPC timeout/deadline
// failures before the agent is demoted to offline. Only deadline-exceeded errors
// count; business-logic errors (e.g. rpcErrNotFound) do not.
const maxConsecutiveRPCFailures = 3

// MaxMessageSize is the maximum allowed WebSocket message size for relay
// (binary) frames (1 MiB). Sized for PTY burst output from terminal relay.
// This is the connection-level read limit applied via SetReadLimit.
const MaxMessageSize = 1 << 20

// RPCMaxMessageSize is the maximum allowed size for a single JSON-RPC
// (text) frame from an agent (64 KiB). RPC payloads (register, ping/pong,
// listSessions, createSession responses) are structurally small — a 1 MiB
// text frame would never occur in normal operation and likely indicates a
// misconfigured or malicious client. Enforced post-read in HandleAgentConnection.
const RPCMaxMessageSize = 64 * 1024

// Hub manages registered agentd connections.
type Hub struct {
	mu     sync.RWMutex
	agents map[string]*ConnectedAgent

	// termSessions tracks active terminal proxy cancel functions for graceful drain.
	termMu              sync.Mutex
	termSessions        map[string]context.CancelFunc
	maxTerminalSessions int

	heartbeatInterval  time.Duration
	heartbeatTimeout   time.Duration
	keepaliveInterval  time.Duration
	agentTTL           time.Duration

	cancel context.CancelFunc
	done   chan struct{}
}

// New creates a new Hub. maxTerminalSessions sets the maximum number of
// concurrent terminal proxy sessions; 0 means unlimited.
func New(heartbeatInterval, heartbeatTimeout, keepaliveInterval, agentTTL time.Duration, maxTerminalSessions int) *Hub {
	return &Hub{
		agents:              make(map[string]*ConnectedAgent),
		termSessions:        make(map[string]context.CancelFunc),
		maxTerminalSessions: maxTerminalSessions,
		heartbeatInterval:   heartbeatInterval,
		heartbeatTimeout:    heartbeatTimeout,
		keepaliveInterval:   keepaliveInterval,
		agentTTL:            agentTTL,
		done:                make(chan struct{}),
	}
}

// Start begins the background reaper goroutine that removes stale agents.
func (h *Hub) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go h.reaper(ctx)
}

// Stop shuts down the hub, draining terminal proxy sessions and closing agent connections.
func (h *Hub) Stop() {
	// Cancel the reaper goroutine.
	if h.cancel != nil {
		h.cancel()
	}
	<-h.done

	// Cancel all active terminal proxy sessions so they drain cleanly.
	h.termMu.Lock()
	for id, cancel := range h.termSessions {
		cancel()
		delete(h.termSessions, id)
	}
	h.termMu.Unlock()

	// Close all agent WebSocket connections.
	h.mu.Lock()
	defer h.mu.Unlock()
	for name, agent := range h.agents {
		agent.Conn().Close(websocket.StatusGoingAway, "hub shutting down")
		delete(h.agents, name)
	}
}

// AcquireTerminalSession atomically checks the concurrent session limit and, if
// the limit is not exceeded, registers the session. Returns true on success or
// false when the limit has been reached (in which case the session is not added).
// A maxTerminalSessions value of 0 means unlimited.
func (h *Hub) AcquireTerminalSession(id string, cancel context.CancelFunc) bool {
	h.termMu.Lock()
	defer h.termMu.Unlock()
	if h.maxTerminalSessions > 0 && len(h.termSessions) >= h.maxTerminalSessions {
		return false
	}
	h.termSessions[id] = cancel
	return true
}

// UntrackTerminalSession removes a terminal proxy session from the tracker.
func (h *Hub) UntrackTerminalSession(id string) {
	h.termMu.Lock()
	delete(h.termSessions, id)
	h.termMu.Unlock()
}

// TerminalSessionCount returns the number of active terminal proxy sessions.
func (h *Hub) TerminalSessionCount() int {
	h.termMu.Lock()
	defer h.termMu.Unlock()
	return len(h.termSessions)
}

// AgentCount returns the number of registered agents.
func (h *Hub) AgentCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.agents)
}

// OnlineAgentCount returns the number of online agents.
func (h *Hub) OnlineAgentCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for _, a := range h.agents {
		if a.Status() == StatusOnline {
			count++
		}
	}
	return count
}

// Register adds or re-registers an agent. If an agent with the same name
// already exists, the old connection is closed and replaced — but only if
// the AdvertiseAddress has not changed. A changed AdvertiseAddress is
// rejected with ErrAdvertiseAddressChanged.
func (h *Hub) Register(name string, conn *websocket.Conn, params *RegisterParams) (*ConnectedAgent, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if existing, ok := h.agents[name]; ok {
		if params.Ttyd.AdvertiseAddress != existing.TtydConfig.AdvertiseAddress {
			slog.Warn("rejecting re-registration: AdvertiseAddress changed",
				"agent", name,
				"existing", existing.TtydConfig.AdvertiseAddress,
				"requested", params.Ttyd.AdvertiseAddress,
			)
			return nil, ErrAdvertiseAddressChanged
		}
		slog.Warn("replacing existing agent connection", "agent", name)
		existing.Conn().Close(websocket.StatusGoingAway, "replaced by new connection")
	}

	agent := NewConnectedAgent(name, conn, params)
	h.agents[name] = agent
	slog.Info("agent registered", "agent", name, "profiles", len(params.Profiles))
	return agent, nil
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

// markOfflineIfCurrent sets the agent offline only if the given pointer still
// owns the name slot. This prevents a stale connection goroutine from marking
// a replacement agent offline after re-registration.
func (h *Hub) markOfflineIfCurrent(name string, expected *ConnectedAgent) {
	h.mu.RLock()
	current, ok := h.agents[name]
	h.mu.RUnlock()

	if ok && current == expected {
		expected.SetStatus(StatusOffline)
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
		// Do not increment consecutiveRPCFailures here. A write failure means
		// the WebSocket connection itself is broken; HandleAgentConnection's read
		// loop will detect the error, exit, and call markOfflineIfCurrent to
		// handle offline detection through the normal heartbeat/connection path.
		return nil, fmt.Errorf("write request: %w", err)
	}

	select {
	case <-ctx.Done():
		callErr := ctx.Err()
		if errors.Is(callErr, context.DeadlineExceeded) {
			if n := agent.incRPCFailures(); n >= maxConsecutiveRPCFailures {
				slog.Warn("agent demoted: too many consecutive RPC timeouts",
					"agent", agent.Name,
					"consecutive_failures", n,
				)
				h.markOfflineIfCurrent(agent.Name, agent)
			}
		}
		return nil, callErr
	case resp := <-respCh:
		if resp.Error != nil {
			return nil, &CallError{RPCError: resp.Error}
		}
		agent.resetRPCFailures()
		return resp.Result, nil
	}
}

// HandleAgentConnection processes messages from a connected agent.
// It blocks until the connection is closed or an error occurs.
// Text frames are dispatched as JSON-RPC responses; binary frames are decoded
// as terminal relay frames and delivered to the registered session channel.
func (h *Hub) HandleAgentConnection(ctx context.Context, agent *ConnectedAgent) {
	agent.Conn().SetReadLimit(MaxMessageSize)

	go h.heartbeatLoop(ctx, agent)
	go h.wsKeepaliveLoop(ctx, agent)

	for {
		msgType, data, err := agent.Conn().Read(ctx)
		if err != nil {
			slog.Info("agent connection closed", "agent", agent.Name, "error", err)
			agent.CloseTerminalChannels()
			h.markOfflineIfCurrent(agent.Name, agent)
			return
		}

		agent.Touch()

		switch msgType {
		case websocket.MessageBinary:
			if len(data) < sharedrelay.TerminalFrameHeaderLen {
				slog.Warn("binary frame too short from agent", "agent", agent.Name, "len", len(data))
				continue
			}
			switch data[0] {
			case sharedrelay.FrameTypeTerminal:
				sessionID, payload, err := DecodeTerminalFrame(data)
				if err != nil {
					slog.Warn("invalid terminal frame from agent", "agent", agent.Name, "error", err)
					continue
				}
				if !agent.DeliverTerminalFrame(sessionID, payload) {
					slog.Debug("no relay registered for session", "agent", agent.Name, "session_id", sessionID)
				}
			case sharedrelay.FrameTypeRelayEnd:
				sessionID, err := DecodeRelayEndFrame(data)
				if err != nil {
					slog.Warn("invalid relay-end frame from agent", "agent", agent.Name, "error", err)
					continue
				}
				slog.Debug("relay ended for session", "agent", agent.Name, "session_id", sessionID)
				agent.CloseTerminalChannel(sessionID)
			default:
				slog.Debug("unknown binary frame type from agent", "agent", agent.Name, "type", fmt.Sprintf("0x%02x", data[0]))
			}

		case websocket.MessageText:
			if len(data) > RPCMaxMessageSize {
				slog.Warn("oversized RPC frame from agent, closing connection",
					"agent", agent.Name,
					"size", len(data),
					"limit", RPCMaxMessageSize,
				)
				agent.Conn().Close(websocket.StatusMessageTooBig, "RPC frame exceeds limit")
				agent.CloseTerminalChannels()
				h.markOfflineIfCurrent(agent.Name, agent)
				return
			}
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
				h.markOfflineIfCurrent(agent.Name, agent)
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
				h.markOfflineIfCurrent(agent.Name, agent)
				return
			case <-respCh:
				// Pong received, agent is alive.
			}
		}
	}
}

// wsKeepaliveLoop sends periodic protocol-level WebSocket pings (RFC 6455 opcode
// 0x9) on the agent connection to prevent NAT/firewall devices from silently
// dropping idle TCP connections between application-level heartbeats. A zero
// keepaliveInterval disables the loop.
//
// Ping requires that Read is being called concurrently on the connection so that
// pong frames can be received — this is satisfied by HandleAgentConnection's read
// loop running in the same goroutine scope.
func (h *Hub) wsKeepaliveLoop(ctx context.Context, agent *ConnectedAgent) {
	if h.keepaliveInterval <= 0 {
		return
	}
	ticker := time.NewTicker(h.keepaliveInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, h.keepaliveInterval)
			err := agent.Conn().Ping(pingCtx)
			cancel()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				slog.Warn("ws keepalive ping failed", "agent", agent.Name, "error", err)
				h.markOfflineIfCurrent(agent.Name, agent)
				return
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

// OpenTerminalRelay registers a relay channel for the given session on the
// named agent. It returns a receive-only channel that delivers PTY output
// frames (already decoded payloads) and a cleanup function that must be
// called when the session ends.
//
// Returns an error if the agent is not found or is offline.
func (h *Hub) OpenTerminalRelay(ctx context.Context, agentName string, sessionID uuid.UUID) (<-chan []byte, func(), error) {
	h.mu.RLock()
	agent, ok := h.agents[agentName]
	h.mu.RUnlock()

	if !ok {
		return nil, nil, fmt.Errorf("agent not found: %s", agentName)
	}
	if agent.Status() != StatusOnline {
		return nil, nil, fmt.Errorf("agent offline: %s", agentName)
	}

	ch, cleanup := agent.RegisterTerminalRelay(sessionID)
	return ch, cleanup, nil
}

// WriteTerminalFrame encodes payload as a terminal relay binary frame for
// sessionID and writes it to the named agent's WebSocket connection.
//
// Concurrent write safety: coder/websocket serializes concurrent Write calls
// internally via its own mutex, so no additional per-agent write mutex is
// required here. heartbeatLoop also writes to the same connection; both callers
// rely on coder/websocket's internal serialization to avoid interleaving.
//
// Returns an error if the agent is not found, offline, or the write fails.
func (h *Hub) WriteTerminalFrame(ctx context.Context, agentName string, sessionID uuid.UUID, payload []byte) error {
	h.mu.RLock()
	agent, ok := h.agents[agentName]
	h.mu.RUnlock()

	if !ok {
		return fmt.Errorf("agent not found: %s", agentName)
	}
	if agent.Status() != StatusOnline {
		return fmt.Errorf("agent offline: %s", agentName)
	}

	frame := EncodeTerminalFrame(sessionID, payload)

	writeCtx, cancel := context.WithTimeout(ctx, h.heartbeatTimeout)
	defer cancel()
	return agent.Conn().Write(writeCtx, websocket.MessageBinary, frame)
}
