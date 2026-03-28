# Diagnostics Endpoint Contract

## 1. Overview

The `getDiagnostics` endpoint provides a health snapshot of all registered agentd instances and their sessions. It is designed for operational use: surfacing session deaths, stuck sessions, and connectivity issues across the agent fleet.

The primary consumer is the `session-diagnostics` skill, which calls the endpoint via `curl` and uses the response to detect anomalies and create improvement tickets. No frontend code currently calls this endpoint.

The endpoint is intended for use on a trusted LAN. It is not designed for public internet exposure — no rate limiting is implemented, and the bearer token is a shared secret used across all hub REST endpoints.

---

## 2. HTTP Request

**Route:** `GET /api/v1/diagnostics`

**Authentication:** `Authorization: Bearer <HUB_API_TOKEN>`

The token is the same shared secret used by all other hub REST endpoints. Invalid or missing tokens return `HTTP 401 Unauthorized`.

### Query Parameters

| Parameter | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `since_minutes` | integer | no | `10080` (7 days) | Min `1`; values ≤ 0 use the default. Max `525960` (~1 year); values above this are clamped to `525960`. |

**Example request:**

```
GET /api/v1/diagnostics?since_minutes=60
Authorization: Bearer <HUB_API_TOKEN>
```

---

## 3. Response Shape

HTTP `200 OK` with `Content-Type: application/json`.

### Top-level fields

| Field | Type | Notes |
|---|---|---|
| `collected_at` | string (RFC3339 UTC) | `time.Now()` at the moment the response is assembled |
| `since_minutes` | integer | The effective `since_minutes` value used for this request |
| `agents` | object | Map of agent name → agent entry (see below) |
| `hub_events` | array | Hub-side diagnostic events (see Section 5) |
| `combined_summary` | object | Aggregated counts across all agents (see below) |

### Agent entry

Each value in the `agents` map has the following shape:

| Field | Type | Notes |
|---|---|---|
| `status` | string | `"online"` or `"offline"` |
| `last_seen` | string (RFC3339) | Last time the hub received a message from this agent |
| `diagnostics` | object or null | `null` for offline agents or when the per-agent RPC fails; otherwise an `agentDiagnostics` object |

### agentDiagnostics object

| Field | Type | Notes |
|---|---|---|
| `events` | array | agentd-side diagnostic events (see Section 5) |
| `sessions` | object | Session lists keyed by state: `running`, `stopped`, `error`, `creating` |
| `summary` | object | Per-agent summary counts (see below) |

### Per-agent summary fields

| Field | Type | Notes |
|---|---|---|
| `since_minutes` | integer | Window used for this agent's diagnostics |
| `death_count` | integer | Sessions killed by SIGKILL/OOM within the window |
| `fast_exit_count` | integer | Sessions that exited shortly after creation |
| `stuck_creating_count` | integer | Sessions that stayed in `creating` past a threshold |
| `stale_ttl_count` | integer | Sessions cleaned up after TTL expiry (not a failure) |
| `hub_disconnect_count` | integer | Times this agent's WebSocket to the hub closed unexpectedly |
| `total_sessions` | integer | Total sessions seen within the window |
| `running_count` | integer | Sessions currently in `running` state |
| `error_count` | integer | Sessions currently in `error` state |

### combined_summary fields

Aggregated across all agents in the response:

| Field | Aggregation |
|---|---|
| `total_death_count` | Sum of `diagnostics.summary.death_count` across all agents |
| `fast_exit_count` | Sum of `diagnostics.summary.fast_exit_count` across all agents |
| `stuck_creating_count` | Sum of `diagnostics.summary.stuck_creating_count` across all agents |
| `hub_timeout_count` | Count of `hub_timeout` events in `hub_events` |
| `offline_agent_count` | Count of agents where `status != "online"` |
| `error_session_count` | Sum of `diagnostics.summary.error_count` across all agents |

Note: `stale_ttl_count` and `hub_disconnect_count` exist in each agent's `summary` but are not aggregated into `combined_summary`. Access them per-agent if needed.

### Minimal response skeleton

```json
{
  "collected_at":   "<RFC3339 UTC timestamp>",
  "since_minutes":  10080,
  "agents": {
    "<agent-name>": {
      "status":      "online|offline",
      "last_seen":   "<RFC3339 timestamp>",
      "diagnostics": null
    }
  },
  "hub_events": [],
  "combined_summary": {
    "total_death_count":    0,
    "fast_exit_count":      0,
    "stuck_creating_count": 0,
    "hub_timeout_count":    0,
    "offline_agent_count":  0,
    "error_session_count":  0
  }
}
```

---

## 4. sessionInfo Fields

All four `sessions.*` arrays (`running`, `stopped`, `error`, `creating`) contain `sessionInfo` objects with the following fields:

| Field | Type | Presence | Notes |
|---|---|---|---|
| `id` | string (UUID) | always | Session UUID |
| `name` | string | always | Human-readable session name |
| `agent_profile` | string | always | Agent profile name |
| `state` | string | always | One of: `"creating"`, `"running"`, `"stopped"`, `"error"`, `"destroying"` |
| `created_at` | string (RFC3339) | always | |
| `waiting_for_input` | bool | always | `true` when Claude is waiting for user input |
| `worktree_path` | string | omitempty | Absolute path to the worktree |
| `repo_url` | string | omitempty | Git remote URL |
| `base_ref` | string | omitempty | Branch or ref name |
| `error_message` | string | omitempty | Populated when `state` is `"error"` |
| `agent_pid` | int | omitempty | OS process ID; `0` means absent |
| `websocket_url` | string | omitempty | WebSocket URL for terminal connection. A valid bearer token grants full terminal access to any session at this URL — treat it as a sensitive credential. |
| `idle_since` | string or null | pointer | RFC3339 timestamp, or `null` when the session is not idle |
| `prompt_context` | string | omitempty | Short context string for the pending prompt |
| `prompt_type` | string | omitempty | Type of pending prompt |

---

## 5. DiagnosticEvent Types

DiagnosticEvents share a common struct shape regardless of origin:

| Field | Type | Presence | Notes |
|---|---|---|---|
| `ts` | string (RFC3339Nano) | always | Event timestamp |
| `type` | string | always | Event type (see enums below) |
| `session_id` | string (UUID) | omitempty | |
| `session_name` | string | omitempty | |
| `pid` | int | omitempty | Process ID |
| `exit_error` | string | omitempty | E.g. `"signal: killed"` for OOM |
| `exit_code` | int or null | pointer | `null` means no exit code |
| `age` | string | omitempty | Human-readable duration, e.g. `"2m30s"` |
| `error` | string | omitempty | Error message |
| `agent` | string | omitempty | Agent name (hub-side events only) |

### agentd-side events (appear in `diagnostics.events`)

| Type | Meaning |
|---|---|
| `session_death` | Session process was killed (SIGKILL, OOM, etc.) |
| `fast_exit` | Session exited within a short window after creation, indicating a bad config or environment |
| `stuck_creating` | Session stayed in the `creating` state past a threshold |
| `stale_ttl_destroy` | Session was cleaned up after its TTL expired — this is a normal lifecycle event, not a failure |
| `hub_disconnect` | agentd's WebSocket connection to the hub was closed unexpectedly |

### hub-side events (appear in `hub_events`)

| Type | Meaning |
|---|---|
| `hub_timeout` | Three consecutive RPC calls to an agent timed out; the agent was demoted to offline |
| `agent_offline` | Agent connection dropped unexpectedly |
| `agent_conn_closed` | Agent WebSocket connection was closed |

Hub-side events use only `ts`, `type`, `agent` (omitempty), and `error` (omitempty). The session-related fields (`session_id`, `session_name`, `pid`, `exit_error`, `exit_code`, `age`) are **not present** on hub-side events.

---

## 6. Polling Behavior

The endpoint is pull-only. There is no push, streaming, or subscription mechanism.

**Idempotency:** The endpoint is fully idempotent. No state is modified by a GET request; it is safe to poll at any frequency.

**Recommended interval:** 120 seconds or longer. The hub's overall fan-out deadline is 90 seconds (see Section 7). Polling more frequently than that risks overlapping in-flight requests under load, since each request fans out to all registered agents.

**Rate limiting:** None is currently implemented.

---

## 7. Timeout and Error Behavior

| Layer | Duration | Behavior |
|---|---|---|
| Per-agent log-parse sub-context (agentd) | 30s | Aborts log parsing; returns empty `events` for that agent |
| Hub log-parse sub-context (hub) | 5s | Aborts hub log parsing; returns empty `hub_events` |
| Per-agent RPC timeout (hub) | 60s | Agent call fails silently; `diagnostics` is `null` for that agent |
| Overall fan-out deadline (hub) | 90s | Returns `504 Gateway Timeout` |
| HTTP server WriteTimeout | Cleared per-request | The hub removes the 35s server-level write deadline for this handler |

When the overall fan-out deadline is exceeded, the response is:

```
HTTP/1.1 504 Gateway Timeout
Content-Type: application/json

{"error":"fan-out deadline exceeded"}
```

Partial fan-out failures (individual agent timeouts or RPC errors) are silent at the response level. Affected agents appear with `"diagnostics": null`. There is no `partial: true` flag or top-level `errors` array to distinguish a timed-out agent from an agent that legitimately has no diagnostics data.

---

## 8. RPC Layer

The hub calls each online agentd instance via **JSON-RPC 2.0 over a persistent WebSocket connection**. The method name is `getDiagnostics`.

### Request

```json
{
  "jsonrpc": "2.0",
  "method": "getDiagnostics",
  "params": { "since_minutes": 60 },
  "id": "<request-id>"
}
```

`params` is optional. Omitting it (or passing `{}`) defaults `since_minutes` to `10080`. Values ≤ 0 use the default. Values above `525960` are clamped to `525960`.

### Response

On success, the `result` field contains an `agentDiagnostics` object as described in Section 3.

### Error codes

| Code | Meaning |
|---|---|
| `-32003` | Invalid argument — malformed JSON params |

---

## 9. Example Payload

The following is a fully populated response with two agents: one online with a session death, and one offline.

```json
{
  "collected_at": "2026-03-28T22:00:00Z",
  "since_minutes": 60,
  "agents": {
    "worker-1": {
      "status": "online",
      "last_seen": "2026-03-28T21:59:50Z",
      "diagnostics": {
        "events": [
          {
            "ts": "2026-03-28T21:45:00.123456789Z",
            "type": "session_death",
            "session_id": "550e8400-e29b-41d4-a716-446655440000",
            "session_name": "my-session",
            "pid": 12345,
            "exit_error": "signal: killed",
            "exit_code": null,
            "age": "2m30s"
          }
        ],
        "sessions": {
          "running": [
            {
              "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
              "name": "active-session",
              "agent_profile": "default",
              "state": "running",
              "created_at": "2026-03-28T21:00:00Z",
              "waiting_for_input": false,
              "worktree_path": "/home/user/project/.worktrees/42-feature",
              "repo_url": "https://github.com/example/repo",
              "base_ref": "main",
              "agent_pid": 54321,
              "websocket_url": "ws://localhost:8080/ws/6ba7b810-9dad-11d1-80b4-00c04fd430c8",
              "idle_since": "2026-03-28T21:55:00Z"
            }
          ],
          "stopped": [],
          "error": [
            {
              "id": "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
              "name": "failed-session",
              "agent_profile": "default",
              "state": "error",
              "created_at": "2026-03-28T20:00:00Z",
              "waiting_for_input": false,
              "error_message": "vault: token expired"
            }
          ],
          "creating": []
        },
        "summary": {
          "since_minutes": 60,
          "death_count": 1,
          "fast_exit_count": 0,
          "stuck_creating_count": 0,
          "stale_ttl_count": 0,
          "hub_disconnect_count": 0,
          "total_sessions": 2,
          "running_count": 1,
          "error_count": 1
        }
      }
    },
    "worker-2": {
      "status": "offline",
      "last_seen": "2026-03-28T20:30:00Z",
      "diagnostics": null
    }
  },
  "hub_events": [
    {
      "ts": "2026-03-28T20:30:05.000000000Z",
      "type": "hub_timeout",
      "agent": "worker-2"
    }
  ],
  "combined_summary": {
    "total_death_count": 1,
    "fast_exit_count": 0,
    "stuck_creating_count": 0,
    "hub_timeout_count": 1,
    "offline_agent_count": 1,
    "error_session_count": 1
  }
}
```

---

## 10. Implementation Notes

The following gaps exist in the current implementation. They are documented here to aid future work.

1. **`stale_ttl_count` and `hub_disconnect_count` not in `combined_summary`** — These per-agent counters are present in each agent's `summary` but are not aggregated at the hub level. Access them per-agent if needed.

2. **Partial fan-out failures are silent** — When an individual agent times out or errors during the fan-out, it appears in the response with `"diagnostics": null`. There is no `partial: true` flag, no `errors` map, and no other response-level indicator to distinguish a timeout from an agent that simply has no events. Callers must infer failure from `status != "online"` combined with the presence of `hub_timeout` events in `hub_events`.

3. **No proto definitions** — `hub.proto` does not include `GetDiagnosticsRequest` or `GetDiagnosticsResponse`. The diagnostics types exist only as Go structs. Any consumers must derive their schema from this document and the source.

4. **No UI consumer** — The endpoint is currently consumed only by the `session-diagnostics` agent skill via `curl`. No frontend TypeScript code calls this endpoint.
