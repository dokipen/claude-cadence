---
name: agent-service
description: Understanding agentd's hub-based architecture for managing AI agent sessions. Use when working with agent sessions, profiles, or the agentd API through the agent-hub.
user-invokable: false
---

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

## Overview

`agentd` is a service that manages AI agent sessions. It no longer exposes a direct gRPC port. Instead, session management is dispatched through the agent-hub WebSocket reverse connection — agentd connects outbound to the hub and receives JSON-RPC commands over that persistent connection.

This is an internal skill for understanding agentd's architecture and its API surface.

## Architecture

```
                  ┌──────────────────────────────────────┐
  Issues UI / ────► agent-hub (4200)                     │
  REST clients    │   REST/WebSocket API                  │
                  │   dispatches commands to agentd       │
                  └──────────────┬───────────────────────┘
                                 │ WebSocket (outbound from agentd)
                                 ▼
                  ┌──────────────────────────────────────┐
                  │ agentd (host loopback only)           │
                  │   session manager + PTY sessions      │
                  │   JSON-RPC dispatcher                 │
                  └──────────────────────────────────────┘
```

Key points:
- agentd does **not** listen for inbound connections from external clients
- agentd connects outbound to agent-hub via WebSocket (`hub.url` in config)
- Commands arrive as JSON-RPC requests over that WebSocket
- The API surface is defined in `services/agents/internal/hub/dispatch.go`

## JSON-RPC Methods

The dispatcher handles the following methods (see `dispatch.go` for full param/result types):

| Method | Description |
|--------|-------------|
| `createSession` | Launch an agent in a new PTY session |
| `getSession` | Get current state of a session (reconciled with PTY process) |
| `listSessions` | List sessions with optional `agent_profile`, `state`, and `waiting_for_input` filters |
| `destroySession` | Kill PTY session, clean up worktree, remove state |
| `getTerminalEndpoint` | Get terminal relay info for a session |

### Session States

| State string | Description |
|---|---|
| `creating` | Session is being set up |
| `running` | Agent process is active |
| `stopped` | Agent process has exited |
| `error` | Session encountered an error |
| `destroying` | Session is being torn down |

### Session Object Fields

```json
{
  "id": "uuid-v4",
  "name": "human-readable-name",
  "agent_profile": "profile-name",
  "state": "running",
  "worktree_path": "/var/lib/agentd/worktrees/<id>",
  "repo_url": "https://github.com/org/repo.git",
  "base_ref": "main",
  "created_at": "2025-01-01T00:00:00Z",
  "error_message": "",
  "agent_pid": 12345,
  "websocket_url": "",
  "waiting_for_input": false,
  "idle_since": null
}
```

### getTerminalEndpoint

Returns either:
- `{"relay": true}` — terminal traffic is relayed through the hub WebSocket (default when no `advertise_address` is configured)
- `{"url": "wss://host/ws/terminal/<session-id>"}` — direct URL (when `advertise_address` is set in config)

## Configuration

agentd connects to agent-hub via a `hub:` block in `~/.config/agentd/config.yaml`:

> **Note:** This path is shown for human reference only. Do not attempt to read, verify, or access `~/.config/agentd/config.yaml` or any other home directory path during agent operation — this triggers macOS permission popups. All agentd configuration is managed by the host operator.

```yaml
hub:
  url: "wss://<HUB_URL>/ws/agent"  # Replace <HUB_URL> with the hub URL from your agentd configuration
  name: "my-machine"               # unique identifier for this agentd instance
  token_env_var: "HUB_AGENT_TOKEN" # env var holding the hub auth token
  reconnect_interval: "5s"
```

## Interacting with Agent Sessions

Session operations go through the agent-hub REST API, not directly to agentd.

```bash
# Replace <HUB_URL> with the hub URL from your agentd configuration

# List all agents registered with the hub
curl -s -H "Authorization: Bearer $HUB_API_TOKEN" \
  https://<HUB_URL>/api/v1/agents | jq '.'

# Dispatch a createSession command to a specific agent
curl -s -X POST \
  -H "Authorization: Bearer $HUB_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent_profile": "code-reviewer", "session_name": "review-pr-42"}' \
  https://<HUB_URL>/api/v1/agents/<agent-name>/sessions

# List sessions on an agent
curl -s -H "Authorization: Bearer $HUB_API_TOKEN" \
  https://<HUB_URL>/api/v1/agents/<agent-name>/sessions | jq '.'
```

## Error Codes

JSON-RPC errors returned by the dispatcher use these codes:

| Code | Meaning |
|------|---------|
| -32000 | Internal error |
| -32001 | Not found |
| -32002 | Already exists |
| -32003 | Invalid argument |
| -32004 | Failed precondition (e.g., destroying a running session without force) |
