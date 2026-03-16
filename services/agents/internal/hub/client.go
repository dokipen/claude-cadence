package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/dokipen/claude-cadence/services/agents/internal/config"
)

// Client manages the WebSocket connection from agentd to the hub.
type Client struct {
	cfg      config.HubConfig
	profiles map[string]config.Profile
	ttyd     config.TtydConfig

	mu      sync.Mutex
	conn    *websocket.Conn
	cancel  context.CancelFunc
	done    chan struct{}
}

// NewClient creates a new hub client.
func NewClient(cfg config.HubConfig, profiles map[string]config.Profile, ttyd config.TtydConfig) *Client {
	return &Client{
		cfg:      cfg,
		profiles: profiles,
		ttyd:     ttyd,
		done:     make(chan struct{}),
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
		}

		// Exponential backoff with jitter: 1s → 30s max.
		delay := backoff(attempt, c.cfg.ReconnectInterval)
		attempt++
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

	url := c.cfg.URL
	if q := "?name=" + c.cfg.Name; true {
		url += q
	}

	conn, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{
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

	// Read messages until disconnected.
	return c.readLoop(ctx, conn)
}

func (c *Client) register(ctx context.Context, conn *websocket.Conn) error {
	profiles := make(map[string]profileInfo, len(c.profiles))
	for name, p := range c.profiles {
		profiles[name] = profileInfo{Description: p.Description}
	}

	params := registerParams{
		Name:     c.cfg.Name,
		Profiles: profiles,
		Ttyd: ttydInfo{
			AdvertiseAddress: c.ttyd.AdvertiseAddress,
			BasePort:         c.ttyd.BasePort,
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
		_, data, err := conn.Read(ctx)
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}

		var req request
		if err := json.Unmarshal(data, &req); err != nil {
			slog.Warn("invalid message from hub", "error", err)
			continue
		}

		switch req.Method {
		case "ping":
			resp, _ := newResponse(req.ID, pongResult{Pong: true})
			respData, _ := json.Marshal(resp)
			if err := conn.Write(ctx, websocket.MessageText, respData); err != nil {
				return fmt.Errorf("write pong: %w", err)
			}
		default:
			slog.Debug("unhandled hub method", "method", req.Method)
		}
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
}

type ttydInfo struct {
	AdvertiseAddress string `json:"advertise_address"`
	BasePort         int    `json:"base_port"`
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
