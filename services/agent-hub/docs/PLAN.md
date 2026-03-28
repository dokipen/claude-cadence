# Agent Hub: Centralized Agent Management

## Problem

agentd instances run independently with static YAML config and a local gRPC API. There is no way to manage multiple agentd instances from a single control plane. As the number of agent machines grows, we need centralized management accessible from `cadence.whatisbackdoor.com` and eventually the web frontend.

## Solution

A new Go service (**agent-hub**) that:
- Accepts outbound WebSocket connections from agentd instances (no firewall changes on agent machines)
- Exposes a REST API for clients to perform CRUD operations on sessions across any registered agentd
- Proxies terminal WebSocket connections from the browser to agentd ttyd instances

## Architecture

```
Browser (REST / WS terminal)
        |
      Caddy (cadence.whatisbackdoor.com)
        |
   +---------+--------+----------+
   |         |        |          |
 /graphql  /api/v1  /ws/term  (frontend)
   |         |        |
 issues   agent-hub  agent-hub
 (4000)   (4200)     (4200)
                |
     +----------+----------+
     |          |          |
   agentd-A  agentd-B  agentd-C
   (mac-1)   (mac-2)   (mac-3)
```

## Key Design Decisions

- **WebSocket** for agentd → hub persistent connection (simpler than gRPC streaming, works through Caddy/proxies)
- **JSON-RPC 2.0** over the WebSocket for structured request/response with correlation IDs
- **agentd initiates** the outbound connection (no inbound firewall changes on agent machines)
- **agentd keeps local gRPC server** running alongside the hub client (both transports active)
- **Hub proxies** terminal WebSocket connections (browser → hub → agentd ttyd)
- **Two separate auth tokens**: REST client → hub (API token) and agentd → hub (agent token)
- **`github.com/coder/websocket`** for WebSocket (modern Go lib, successor to nhooyr.io/websocket)
- **Standard `net/http` ServeMux** (Go 1.22+) for REST routing

---

## Phase 1: Hub Skeleton + agentd Registration

### 1a. New Service: `services/agent-hub/`

```
services/agent-hub/
  cmd/agent-hub/main.go
  internal/
    config/config.go          # Hub config (port, auth, timeouts)
    hub/
      hub.go                  # Core hub: agent registry, routing
      agent.go                # Connected agent state + WS conn
      messages.go             # JSON-RPC message types
    rest/
      server.go               # HTTP server
      handlers.go             # REST endpoint handlers
      middleware.go            # Auth middleware
    proxy/
      terminal.go             # WS terminal relay (Phase 3)
  go.mod
  go.sum
  config.example.yaml
```

Hub config (`config.example.yaml`):

```yaml
host: "127.0.0.1"
port: 4200

auth:
  mode: "token"
  token_env_var: "HUB_API_TOKEN"

hub_auth:
  token_env_var: "HUB_AGENT_TOKEN"

heartbeat:
  interval: "30s"
  timeout: "10s"

agent_ttl: "5m"

log:
  level: "info"
  format: "json"
```

Core types:

```go
type Hub struct {
    mu     sync.RWMutex
    agents map[string]*ConnectedAgent  // keyed by agent name
}

type ConnectedAgent struct {
    Name       string
    Profiles   map[string]Profile
    Status     AgentStatus  // online, offline
    Conn       *websocket.Conn
    TtydConfig TtydInfo
    pending    map[string]chan json.RawMessage  // req ID -> response chan
    LastSeen   time.Time
}
```

WebSocket accept endpoint: `GET /ws/agent?name=<name>` with `Authorization: Bearer <token>` header

REST endpoint: `GET /api/v1/agents` — list registered agents with status

### 1b. agentd Hub Client

Add optional `hub` config section to agentd (`services/agents/internal/config/config.go`):

```yaml
hub:
  url: "wss://cadence.whatisbackdoor.com/ws/agent"
  name: "mac-mini-1"
  token: ""
  token_env_var: "HUB_AGENT_TOKEN"
  reconnect_interval: "5s"
```

New package: `services/agents/internal/hub/client.go`

- Dials hub WebSocket, sends `register` message (name, profiles, ttyd info)
- Handles heartbeat pong responses
- Reconnects with exponential backoff (1s → 30s max, with jitter)
- Dispatches incoming JSON-RPC requests to the existing `AgentService`

In `cmd/agentd/main.go`: if `cfg.Hub` is set, start hub client goroutine alongside the gRPC server.

### 1c. Caddy Changes

Add to `infrastructure/Caddyfile`:

```
handle /api/v1/* {
    reverse_proxy localhost:4200
}
handle /ws/agent {
    reverse_proxy localhost:4200
}
handle /ws/terminal/* {
    reverse_proxy localhost:4200
}
```

---

## Phase 2: Session CRUD via Hub

### REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/agents` | List registered agentd instances |
| GET | `/api/v1/agents/:name` | Get agentd info (profiles, status) |
| POST | `/api/v1/agents/:name/sessions` | CreateSession |
| GET | `/api/v1/agents/:name/sessions` | ListSessions |
| GET | `/api/v1/agents/:name/sessions/:id` | GetSession |
| DELETE | `/api/v1/agents/:name/sessions/:id` | DestroySession |

Query parameters for filtering: `?profile=code-reviewer&state=running`

### Request Flow

1. REST request arrives at hub
2. Hub looks up target agentd by name
3. Serializes request as JSON-RPC message
4. Sends over WebSocket to agentd
5. Waits for response (with timeout)
6. Returns REST response

### Error Mapping

| Condition | HTTP Status |
|-----------|-------------|
| agentd not found | 404 |
| agentd offline | 502 |
| agentd timeout | 504 |
| Session not found | 404 |
| Invalid request | 400 |
| Domain errors | 4xx |

### JSON-RPC Protocol

Messages over the agentd ↔ hub WebSocket:

```json
// Hub → agentd (request)
{"jsonrpc": "2.0", "id": "req-1", "method": "createSession", "params": {"agent_profile": "code-reviewer", "session_name": "review-42"}}
{"jsonrpc": "2.0", "id": "req-2", "method": "getSession", "params": {"session_id": "abc-123"}}
{"jsonrpc": "2.0", "id": "req-3", "method": "listSessions", "params": {"agent_profile": "", "state": 0}}
{"jsonrpc": "2.0", "id": "req-4", "method": "destroySession", "params": {"session_id": "abc-123", "force": true}}
{"jsonrpc": "2.0", "id": "ping-1", "method": "ping", "params": {}}

// agentd → hub (response)
{"jsonrpc": "2.0", "id": "req-1", "result": {"session": {...}}}
{"jsonrpc": "2.0", "id": "req-2", "error": {"code": -32001, "message": "session not found"}}
{"jsonrpc": "2.0", "id": "ping-1", "result": {"pong": true}}

// agentd → hub (request — hub must acknowledge registration)
{"jsonrpc": "2.0", "id": "reg-1", "method": "register", "params": {"name": "mac-1", "profiles": {...}, "ttyd": {"advertise_address": "192.168.1.50", "base_port": 7681}}}

// hub → agentd (registration acknowledgment)
{"jsonrpc": "2.0", "id": "reg-1", "result": {"accepted": true}}
```

---

## Phase 3: Terminal WebSocket Proxying

### agentd Config Additions

```yaml
ttyd:
  bind_address: "127.0.0.1"    # New field, defaults to 127.0.0.1
  advertise_address: ""         # Address the hub uses to reach ttyd. Defaults to bind_address.
```

### New JSON-RPC Method

`getTerminalEndpoint(session_id)` — hub asks agentd for the ttyd host:port for a given session.

### Hub Proxy Endpoint

`GET /ws/terminal/:agent_name/:session_id`

Flow:
1. Browser connects to hub's terminal proxy endpoint
2. Hub authenticates the request (same REST auth middleware)
3. Hub sends `getTerminalEndpoint` JSON-RPC to the target agentd
4. agentd responds with its ttyd address:port for that session
5. Hub establishes outbound WebSocket to agentd's ttyd
6. Hub relays bytes bidirectionally (transparent WebSocket-to-WebSocket proxy)

The browser never needs direct network access to agent machines.

---

## Phase 4: Hardening

- Graceful shutdown (drain WebSocket connections)
- Integration tests (hub + agentd end-to-end)
- Rate limiting on REST API
- Metrics (connected agents count, request latency, active sessions)

---

## Files to Modify

| File | Change |
|------|--------|
| `services/agents/internal/config/config.go` | Add `HubConfig` struct, validation, defaults |
| `services/agents/cmd/agentd/main.go` | Start hub client goroutine when hub config present |
| `services/agents/internal/ttyd/ttyd.go` | Add `bind_address` and `advertise_address` (Phase 3); update `Start()` signature to accept bind address instead of hardcoded `127.0.0.1` |
| `infrastructure/Caddyfile` | Add routes for hub REST, agent WS, terminal WS |

## Files to Create

| File | Purpose |
|------|---------|
| `services/agent-hub/` | Entire new service (see directory structure above) |
| `services/agents/internal/hub/client.go` | Hub WebSocket client for agentd |

## Dependencies

| Package | Purpose |
|---------|---------|
| `github.com/coder/websocket` | WebSocket client + server (both services) |
| `gopkg.in/yaml.v3` | Config parsing (already used in agentd) |
| `net/http` (stdlib) | REST server with Go 1.22+ ServeMux |

---

## Security

- **Two separate tokens**: REST client → hub (`auth.token`) and agentd → hub (`hub_auth.token`). Rotatable independently.
- **agentd initiates outbound**: No inbound ports needed on agent machines (except ttyd for terminal proxying, restrictable to hub IP via firewall).
- **TLS via Caddy**: All external connections use `wss://` and `https://`.
- **Terminal auth**: Browser terminal WebSocket goes through hub's REST auth middleware. No unauthenticated terminal access.
- **Constant-time token comparison**: Same pattern as existing agentd auth.

## Disconnect/Reconnect Behavior

1. Hub detects disconnect (WebSocket close or heartbeat timeout) → marks agent `offline`
2. In-flight requests to that agent get HTTP 502
3. `GET /api/v1/agents` shows the agent with `status: offline`
4. agentd reconnects with exponential backoff (1s → 30s, with jitter), re-sends `register`
5. Hub matches by name, transitions back to `online`
6. PTY sessions survive the disconnect — queryable again after reconnection
7. If agent stays offline past `agent_ttl` (default 5m), hub removes its entry

## Verification

1. Start agent-hub with config, verify it listens on port 4200
2. Start agentd with hub config, verify WebSocket connection and registration
3. `curl GET /api/v1/agents` — verify agentd appears with `status: online`
4. `curl POST /api/v1/agents/<name>/sessions` — verify session created on remote agentd
5. `curl GET /api/v1/agents/<name>/sessions` — verify sessions listed
6. `curl DELETE /api/v1/agents/<name>/sessions/<id>` — verify session destroyed
7. Kill agentd, verify hub marks it offline; restart, verify reconnection
8. Connect browser to `/ws/terminal/<agent>/<session>` — verify terminal access
9. Run existing agentd e2e tests to confirm no regressions in local-only mode
