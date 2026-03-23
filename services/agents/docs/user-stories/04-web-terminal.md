# US-04: Web Terminal Access

## Summary

The service provides web-based terminal access to agent sessions via a built-in WebSocket relay that streams the PTY output to a browser.

## Stories

### WebSocket Relay Lifecycle
- As a user, each new session gets a WebSocket relay connected to its PTY
- As a user, the WebSocket relay connects to the PTY session after it is created
- As a user, the relay is automatically stopped when the session is destroyed
- As a user, sessions work normally for API access even without an active web terminal connection

### Web Access
- As a user, the `Session` response includes a `websocket_url` field with the relay URL
- As a user, I can open the websocket URL in a browser to see the agent's terminal
- As a user, the web terminal is writable (I can interact with the agent session)

## E2E Test Cases

| Test | Description |
|------|-------------|
| `TestWebTerminal_StartsWithSession` | WebSocket relay starts when session created |
| `TestWebTerminal_HttpResponds` | WebSocket endpoint responds |
| `TestWebTerminal_StopsOnDestroy` | Relay stopped when session destroyed |
| `TestWebTerminal_UniqueURL` | Each session gets a unique WebSocket URL |

## Implementation Phase

**Phase 4** (Web Terminal Access) -- 3 story points

Blocked by: Phase 1
