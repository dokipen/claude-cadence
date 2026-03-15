---
name: agent-service
description: Interacting with the agentd gRPC service for managing AI agent sessions. Use when working with agent sessions, profiles, or the agentd API.
user-invokable: false
---

## Overview

`agentd` is a gRPC service that manages AI agent sessions. It handles session lifecycle: creating, monitoring, and destroying agent processes. The service is `agents.v1.AgentService`, defaulting to `127.0.0.1:4141`.

## Prerequisites

- `agentd` must be running on the target host
- `grpcurl` must be installed
- Either server reflection is enabled, or the proto file is available at `proto/agents/v1/agents.proto`

```bash
# Check connectivity
grpcurl -plaintext 127.0.0.1:4141 list
```

**Note:** `-plaintext` disables TLS and is only appropriate for loopback connections (`127.0.0.1`). For remote hosts, omit `-plaintext` and use TLS.

Two modes for specifying the API schema:

```bash
# Reflection mode (server must have reflection enabled)
grpcurl -plaintext 127.0.0.1:4141 agents.v1.AgentService/ListSessions

# Proto file mode (use from services/agents/ directory)
grpcurl -plaintext -import-path proto -proto agents/v1/agents.proto \
  127.0.0.1:4141 agents.v1.AgentService/ListSessions

# Or from repo root
grpcurl -plaintext -import-path services/agents/proto -proto agents/v1/agents.proto \
  127.0.0.1:4141 agents.v1.AgentService/ListSessions
```

## Authentication

When the service is configured with token auth, include the `Authorization` header:

```bash
grpcurl -plaintext -H "Authorization: Bearer $TOKEN" \
  127.0.0.1:4141 agents.v1.AgentService/ListSessions
```

## Session States

| Value | Name |
|-------|------|
| 0 | SESSION_STATE_UNSPECIFIED |
| 1 | SESSION_STATE_CREATING |
| 2 | SESSION_STATE_RUNNING |
| 3 | SESSION_STATE_STOPPED |
| 4 | SESSION_STATE_ERROR |
| 5 | SESSION_STATE_DESTROYING |

## RPCs

### CreateSession

```bash
grpcurl -plaintext -d '{
  "agent_profile": "code-reviewer",
  "session_name": "review-pr-42",
  "base_ref": "main",
  "env": {
    "GITHUB_TOKEN": "$GITHUB_TOKEN"
  },
  "extra_args": ["--verbose"]
}' 127.0.0.1:4141 agents.v1.AgentService/CreateSession
```

Fields:
- `agent_profile` — name of the agent profile to run (required)
- `session_name` — human-readable label for the session (required)
- `base_ref` — git ref to base the session on (optional)
- `env` — additional environment variables as a string map (optional)
- `extra_args` — extra CLI arguments passed to the agent (optional)

### GetSession

```bash
grpcurl -plaintext -d '{"session_id": "sess_abc123"}' \
  127.0.0.1:4141 agents.v1.AgentService/GetSession
```

### ListSessions

```bash
# List all sessions
grpcurl -plaintext -d '{}' 127.0.0.1:4141 agents.v1.AgentService/ListSessions

# Filter by agent profile
grpcurl -plaintext -d '{"agent_profile": "code-reviewer"}' \
  127.0.0.1:4141 agents.v1.AgentService/ListSessions

# Filter by state (e.g., running = 2)
grpcurl -plaintext -d '{"state": 2}' \
  127.0.0.1:4141 agents.v1.AgentService/ListSessions

# Combine filters
grpcurl -plaintext -d '{"agent_profile": "tester", "state": 2}' \
  127.0.0.1:4141 agents.v1.AgentService/ListSessions
```

### DestroySession

```bash
# Graceful shutdown
grpcurl -plaintext -d '{"session_id": "sess_abc123", "force": false}' \
  127.0.0.1:4141 agents.v1.AgentService/DestroySession

# Force kill
grpcurl -plaintext -d '{"session_id": "sess_abc123", "force": true}' \
  127.0.0.1:4141 agents.v1.AgentService/DestroySession
```

## Common Patterns

### List all running sessions

```bash
grpcurl -plaintext -d '{"state": 2}' \
  127.0.0.1:4141 agents.v1.AgentService/ListSessions
```

### Create a session and monitor it

```bash
# Create
SESSION=$(grpcurl -plaintext -d '{
  "agent_profile": "tester",
  "session_name": "test-issue-99"
}' 127.0.0.1:4141 agents.v1.AgentService/CreateSession)

SESSION_ID=$(echo "$SESSION" | jq -r '.session.id')

# Poll until no longer creating
grpcurl -plaintext -d "{\"session_id\": \"$SESSION_ID\"}" \
  127.0.0.1:4141 agents.v1.AgentService/GetSession
```

### Force-destroy a stuck session

```bash
# Find stuck sessions (state 1 = creating, 5 = destroying)
grpcurl -plaintext -d '{"state": 1}' \
  127.0.0.1:4141 agents.v1.AgentService/ListSessions

# Force destroy
grpcurl -plaintext -d "{\"session_id\": \"$SESSION_ID\", \"force\": true}" \
  127.0.0.1:4141 agents.v1.AgentService/DestroySession
```
