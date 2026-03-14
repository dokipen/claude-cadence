# US-04: Web Terminal Access

## Summary

The service provides web-based terminal access to agent sessions via ttyd, which exposes tmux sessions as websocket-backed terminals accessible from a browser.

## Stories

### ttyd Lifecycle
- As a user, when `ttyd.enabled=true` in config, each new session gets a ttyd process
- As a user, ttyd is started after the tmux session is created
- As a user, ttyd is automatically stopped when the session is destroyed
- As a user, if ttyd is not enabled, sessions work normally without web terminal access

### Port Management
- As a user, each session gets a unique websocket port (incremented from `ttyd.base_port`)
- As a user, port collisions are avoided by tracking allocated ports
- As a user, ports are released when sessions are destroyed

### Web Access
- As a user, the `Session` response includes a `websocket_url` field with the ttyd URL
- As a user, I can open the websocket URL in a browser to see the agent's terminal
- As a user, the web terminal is writable (I can interact with the agent session)

## E2E Test Cases

| Test | Description |
|------|-------------|
| `TestTtyd_StartsWithSession` | ttyd process started when session created |
| `TestTtyd_HttpResponds` | ttyd HTTP endpoint responds |
| `TestTtyd_StopsOnDestroy` | ttyd process killed when session destroyed |
| `TestTtyd_UniquePort` | Each session gets a different port |
| `TestTtyd_Disabled` | Sessions work without ttyd when disabled |

## Implementation Phase

**Phase 4** (ttyd Web Terminal Access) -- 3 story points

Blocked by: Phase 1
