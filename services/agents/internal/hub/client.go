package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
)

// terminalRelayChannelBufSize is the buffer size for per-session relay input channels.
// 256 entries absorbs larger PTY output bursts (e.g. cat of a large file) without
// dropping frames or blocking the hub read loop.
const terminalRelayChannelBufSize = 256

// SessionDispatcher handles session CRUD and terminal operations dispatched from the hub.
type SessionDispatcher interface {
	CreateSession(params json.RawMessage) (json.RawMessage, *rpcError)
	GetSession(params json.RawMessage) (json.RawMessage, *rpcError)
	ListSessions(params json.RawMessage) (json.RawMessage, *rpcError)
	DestroySession(params json.RawMessage) (json.RawMessage, *rpcError)
	GetTerminalEndpoint(params json.RawMessage) (json.RawMessage, *rpcError)
}

// Client manages the WebSocket connection from agentd to the hub.
type Client struct {
	cfg        config.HubConfig
	profiles   map[string]config.Profile
	ttyd       config.TtydConfig
	dispatcher SessionDispatcher
	ptyMgr     *pty.PTYManager

	mu      sync.Mutex
	conn    *websocket.Conn
	writeMu sync.Mutex // protects concurrent WebSocket writes
	cancel  context.CancelFunc
	done    chan struct{}

	// terminalRelayCh maps session ID → channel for incoming binary relay
	// frames from the hub (browser input forwarded to the PTY session).
	relayCh   map[string]chan []byte
	relayChMu sync.Mutex
}

// NewClient creates a new hub client.
// ptyMgr is optional: pass it to enable the terminal relay path. When nil
// (or when advertise_address is configured), the dispatcher falls back to the
// direct URL-based response. Task 5 will wire this up in main.go.
func NewClient(cfg config.HubConfig, profiles map[string]config.Profile, ttyd config.TtydConfig, dispatcher SessionDispatcher, ptyMgr ...*pty.PTYManager) *Client {
	var mgr *pty.PTYManager
	if len(ptyMgr) > 0 {
		mgr = ptyMgr[0]
	}
	return &Client{
		cfg:        cfg,
		profiles:   profiles,
		ttyd:       ttyd,
		dispatcher: dispatcher,
		ptyMgr:     mgr,
		done:       make(chan struct{}),
		relayCh:    make(map[string]chan []byte),
	}
}

// Start begins the connection loop in a background goroutine.
func (c *Client) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	go c.connectLoop(ctx)
}

// Stop closes the connection and stops the client.
func (c *Client) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
	<-c.done
}

func (c *Client) connectLoop(ctx context.Context) {
	defer close(c.done)

	attempt := 0
	for {
		select {
		case <-ctx.Done():
			c.closeConn()
			return
		default:
		}

		err := c.connect(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Warn("hub connection failed", "error", err, "attempt", attempt)
			attempt++
		} else {
			// Reset backoff after a successful connection that later disconnected.
			attempt = 0
		}

		// Exponential backoff with jitter: 1s → 30s max.
		delay := backoff(attempt, c.cfg.ReconnectInterval)
		slog.Info("reconnecting to hub", "delay", delay)

		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func (c *Client) connect(ctx context.Context) error {
	token := c.cfg.ResolveToken()

	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+token)

	dialURL := c.cfg.URL + "?" + url.Values{"name": {c.cfg.Name}}.Encode()

	conn, _, err := websocket.Dial(ctx, dialURL, &websocket.DialOptions{
		HTTPHeader: headers,
	})
	if err != nil {
		return fmt.Errorf("dial hub: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	// Send register message.
	if err := c.register(ctx, conn); err != nil {
		conn.Close(websocket.StatusProtocolError, "register failed")
		return fmt.Errorf("register: %w", err)
	}

	slog.Info("connected to hub", "url", c.cfg.URL, "name", c.cfg.Name)

	// Create a per-connection context that is cancelled when readLoop returns.
	// This ensures relay goroutines spawned on this connection are torn down
	// before a reconnect attempt reuses the client.
	connCtx, connCancel := context.WithCancel(ctx)
	defer connCancel()

	// Read messages until disconnected.
	return c.readLoop(connCtx, conn)
}

func (c *Client) register(ctx context.Context, conn *websocket.Conn) error {
	profiles := make(map[string]profileInfo, len(c.profiles))
	for name, p := range c.profiles {
		profiles[name] = profileInfo{Description: p.Description, Repo: p.Repo}
	}

	params := registerParams{
		Name:     c.cfg.Name,
		Profiles: profiles,
		Ttyd: ttydInfo{
			AdvertiseAddress: c.ttyd.AdvertiseAddress,
			BasePort:         c.ttyd.BasePort,
			MaxPorts:         c.ttyd.MaxPorts,
		},
	}

	req, err := newRequest("reg-1", "register", params)
	if err != nil {
		return err
	}

	data, err := json.Marshal(req)
	if err != nil {
		return err
	}

	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		return fmt.Errorf("send register: %w", err)
	}

	// Read registration acknowledgment.
	_, respData, err := conn.Read(ctx)
	if err != nil {
		return fmt.Errorf("read register response: %w", err)
	}

	var resp response
	if err := json.Unmarshal(respData, &resp); err != nil {
		return fmt.Errorf("parse register response: %w", err)
	}

	if resp.Error != nil {
		return fmt.Errorf("register rejected: %s", resp.Error.Message)
	}

	return nil
}

func (c *Client) readLoop(ctx context.Context, conn *websocket.Conn) error {
	for {
		msgType, data, err := conn.Read(ctx)
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}

		// Binary frames carry terminal relay data (browser → PTY).
		if msgType == websocket.MessageBinary {
			c.dispatchBinaryFrame(data)
			continue
		}

		var req request
		if err := json.Unmarshal(data, &req); err != nil {
			slog.Warn("invalid message from hub", "error", err)
			continue
		}

		switch req.Method {
		case "ping":
			resp, _ := newResponse(req.ID, pongResult{Pong: true})
			if err := c.writeResponse(ctx, conn, resp); err != nil {
				return err
			}

		case "createSession", "getSession", "listSessions", "destroySession", "getTerminalEndpoint":
			// Dispatch asynchronously so long-running operations (e.g., git clone)
			// don't block the read loop from responding to heartbeat pings.
			go c.dispatchSessionAsync(ctx, conn, req)

		default:
			slog.Debug("unhandled hub method", "method", req.Method)
		}
	}
}

// dispatchBinaryFrame routes an incoming binary relay frame to the registered
// channel for the target session. Frames that cannot be decoded or have no
// registered channel are silently dropped.
func (c *Client) dispatchBinaryFrame(data []byte) {
	sessionUUID, payload, err := decodeTerminalFrame(data)
	if err != nil {
		slog.Warn("relay: dropping malformed binary frame", "error", err)
		return
	}
	sessID := sessionUUID.String()
	c.relayChMu.Lock()
	ch, ok := c.relayCh[sessID]
	c.relayChMu.Unlock()
	if !ok {
		slog.Debug("relay: no relay channel for session, dropping frame", "session_id", sessID)
		return
	}
	// Non-blocking send: drop if the channel is full.
	select {
	case ch <- payload:
	default:
		slog.Debug("relay: input channel full, dropping frame", "session_id", sessID)
	}
}

// dispatchSessionAsync dispatches a session method and writes the response.
// For getTerminalEndpoint with relay: true, it also starts the relay pump.
func (c *Client) dispatchSessionAsync(ctx context.Context, conn *websocket.Conn, req request) {
	var fn func(json.RawMessage) (json.RawMessage, *rpcError)
	switch req.Method {
	case "createSession":
		fn = c.dispatcher.CreateSession
	case "getSession":
		fn = c.dispatcher.GetSession
	case "listSessions":
		fn = c.dispatcher.ListSessions
	case "destroySession":
		fn = c.dispatcher.DestroySession
	case "getTerminalEndpoint":
		fn = c.dispatcher.GetTerminalEndpoint
	}

	resp := c.dispatchSession(req.ID, req.Params, fn)
	if err := c.writeResponse(ctx, conn, resp); err != nil {
		slog.Warn("failed to write dispatch response", "method", req.Method, "error", err)
		return
	}

	// If this was a getTerminalEndpoint call that returned relay: true, start
	// the relay pump now that the JSON-RPC response has been sent.
	//
	// A derived context is used (rather than the readLoop's ctx) so the relay
	// goroutine can be torn down independently — e.g., on hub reconnect the old
	// relay is cancelled without waiting for the top-level context to cancel.
	if req.Method == "getTerminalEndpoint" && resp.Error == nil && c.ptyMgr != nil {
		var result terminalEndpointResult
		if err := json.Unmarshal(resp.Result, &result); err == nil && result.Relay {
			var p getTerminalEndpointParams
			if err := json.Unmarshal(req.Params, &p); err == nil {
				relayCtx, relayCancel := context.WithCancel(ctx)
				go c.runTerminalRelay(relayCtx, relayCancel, conn, p.SessionID, c.ptyMgr)
			}
		}
	}
}

// writeResponse serializes and writes a response, protected by the write mutex.
func (c *Client) writeResponse(ctx context.Context, conn *websocket.Conn, resp *response) error {
	respData, _ := json.Marshal(resp)
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := conn.Write(ctx, websocket.MessageText, respData); err != nil {
		return fmt.Errorf("write response: %w", err)
	}
	return nil
}

// RegisterRelaySession creates a buffered input channel for terminal relay
// frames destined for sessionID. relayCancel is the CancelFunc for the relay
// goroutine's derived context; it is invoked from the cleanup alongside the
// channel close so that hub reconnects tear down the old relay immediately.
// Returns the channel and a cleanup function that removes the registration.
// The caller must invoke cleanup when the relay session ends.
func (c *Client) RegisterRelaySession(sessionID string, relayCancel context.CancelFunc) (<-chan []byte, func()) {
	ch := make(chan []byte, terminalRelayChannelBufSize)
	c.relayChMu.Lock()
	c.relayCh[sessionID] = ch
	c.relayChMu.Unlock()
	var once sync.Once
	cleanup := func() {
		once.Do(func() {
			c.relayChMu.Lock()
			delete(c.relayCh, sessionID)
			c.relayChMu.Unlock()
			// Cancel the relay goroutine's context so it stops attempting
			// writes on a stale hub connection (e.g., after hub reconnect).
			relayCancel()
			// Close so the relay loop's `case payload, ok := <-ch` branch
			// detects teardown via the !ok path instead of blocking forever.
			close(ch)
		})
	}
	return ch, cleanup
}

// dispatchSession calls a SessionDispatcher method and wraps the result in a response.
func (c *Client) dispatchSession(id string, params json.RawMessage, fn func(json.RawMessage) (json.RawMessage, *rpcError)) *response {
	result, rpcErr := fn(params)
	if rpcErr != nil {
		return &response{
			JSONRPC: "2.0",
			ID:      id,
			Error:   rpcErr,
		}
	}
	return &response{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
}

func (c *Client) closeConn() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close(websocket.StatusGoingAway, "client stopping")
		c.conn = nil
	}
}

// backoff calculates exponential backoff with jitter. Base delay starts at
// reconnectInterval and caps at 30s.
func backoff(attempt int, base time.Duration) time.Duration {
	if base <= 0 {
		base = time.Second
	}
	maxDelay := 30 * time.Second

	delay := time.Duration(float64(base) * math.Pow(2, float64(attempt)))
	if delay > maxDelay {
		delay = maxDelay
	}

	// Add jitter: ±25%.
	jitter := float64(delay) * 0.25
	delay = time.Duration(float64(delay) + (rand.Float64()*2-1)*jitter)
	return delay
}

// JSON-RPC types (local to agentd hub client).

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type registerParams struct {
	Name     string                  `json:"name"`
	Profiles map[string]profileInfo  `json:"profiles"`
	Ttyd     ttydInfo                `json:"ttyd"`
}

type profileInfo struct {
	Description string `json:"description"`
	Repo        string `json:"repo"`
}

type ttydInfo struct {
	AdvertiseAddress string `json:"advertise_address"`
	BasePort         int    `json:"base_port"`
	MaxPorts         int    `json:"max_ports"`
}

type pongResult struct {
	Pong bool `json:"pong"`
}

func newRequest(id, method string, params any) (*request, error) {
	var raw json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	return &request{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  raw,
	}, nil
}

func newResponse(id string, result any) (*response, error) {
	b, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	return &response{
		JSONRPC: "2.0",
		ID:      id,
		Result:  b,
	}, nil
}
