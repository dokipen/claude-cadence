---
name: session-diagnostics
description: >
  Diagnose agentd session deaths, audit agent health, and create improvement tickets.
  Use when asked to investigate agent crashes or session failures, check session health,
  or when running a periodic automated diagnostic.
---

# Session Diagnostics

Calls the hub diagnostics API, classifies patterns, and creates tickets for actionable issues.

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

## Step 1 — Fetch diagnostics

```bash
curl -sf \
  -H "Authorization: Bearer $HUB_API_TOKEN" \
  "https://cadence.whatisbackdoor.com/api/v1/diagnostics?since_minutes=10080"
```

If `$HUB_API_TOKEN` is not set, check the environment or `.env.dev`.
Default window is 7 days (10080 minutes). Pass `?since_minutes=N` to narrow the window.

The response shape:

```json
{
  "collected_at": "...",
  "since_minutes": 10080,
  "agents": {
    "<agent-name>": {
      "status": "online|offline",
      "last_seen": "...",
      "diagnostics": {
        "events": [...],
        "sessions": { "running": [...], "stopped": [...], "error": [...], "creating": [...] },
        "summary": {
          "since_minutes": 10080,
          "death_count": 0,
          "fast_exit_count": 0,
          "stuck_creating_count": 0,
          "stale_ttl_count": 0,
          "hub_disconnect_count": 0,
          "total_sessions": 0,
          "running_count": 0,
          "error_count": 0
        }
      }
    }
  },
  "hub_events": [...],
  "combined_summary": {
    "total_death_count": 0,
    "fast_exit_count": 0,
    "stuck_creating_count": 0,
    "hub_timeout_count": 0,
    "offline_agent_count": 0,
    "error_session_count": 0
  }
}
```

## Step 2 — Classify patterns

`stale_ttl_count` events are **normal** (sessions cleaned after their TTL). All other event
types indicate unexpected failures.

| Pattern | Signal | Priority |
|---|---|---|
| Hard crash (agentd killed) | `offline_agent_count > 0` AND `hub_timeout_count > 0` | HIGH |
| Session deaths (SIGKILL/OOM) | `total_death_count > 0` | HIGH |
| Error sessions | `error_session_count > 0` — inspect `error_message` field | HIGH |
| Fast exits (bad config/env) | `fast_exit_count >= 2` | MEDIUM–HIGH |
| Stuck creating | `stuck_creating_count >= 2` | MEDIUM |
| Repeated hub disconnects | `hub_disconnect_count > 5` | MEDIUM |

For hard crashes: agentd was OOM-killed or SIGKILL'd. Look for `hub_timeout` events in
`hub_events` naming the affected agent. The agent itself cannot log its own death.

For session deaths: check `exit_error` in the event (e.g., `"signal: killed"` → OOM).

For error sessions: check `error_message` in the session info for vault/git/config clues.

## Step 3 — Duplicate check

Before creating tickets, search for existing ones:

**MCP preferred:**
```
mcp__issues__ticket_list  projectName: "claude-cadence"  state: "BACKLOG"
mcp__issues__ticket_list  projectName: "claude-cadence"  state: "REFINED"
mcp__issues__ticket_list  projectName: "claude-cadence"  state: "IN_PROGRESS"
```

**CLI fallback:**
```bash
issues ticket list --project claude-cadence --state BACKLOG --json
issues ticket list --project claude-cadence --state REFINED --json
issues ticket list --project claude-cadence --state IN_PROGRESS --json
```

Search titles for keywords matching the pattern (e.g., "OOM", "session death", "vault").
Skip ticket creation if a matching open ticket already exists; comment on it instead.

## Step 4 — Create or update tickets

For each actionable pattern without an existing ticket:

**Shell safety:** The `--title` argument is inline — avoid backticks in the title. write_file titles as plain text (e.g., "OOM in session restore" not "OOM in `restoreSession`"). The `--description` heredoc below is already backtick-safe via `<<'EOF'`.

**MCP preferred:**
```
mcp__issues__ticket_create
  title: "<concise description without backticks>"
  projectName: "claude-cadence"
  description: "## Problem\n\n<what the diagnostic data shows>\n\n## Evidence\n\n<paste relevant event entries or summary counts>\n\n## Hypothesis\n\n<likely root cause based on the pattern>"
  acceptanceCriteria: "- [ ] Root cause identified and fixed\n- [ ] Recurrence rate drops to zero in next 7-day diagnostic window"
  priority: "HIGH"
```

**CLI fallback:**
```bash
issues ticket create \
  --project claude-cadence \
  --title "<concise description without backticks>" \
  --description "$(cat <<'EOF'
## Problem

<what the diagnostic data shows>

## Evidence

<paste relevant event entries or summary counts>

## Hypothesis

<likely root cause based on the pattern>

## Acceptance Criteria

- [ ] Root cause identified and fixed
- [ ] Recurrence rate drops to zero in next 7-day diagnostic window
EOF
)" \
  --priority HIGH \
  --json
```

Then add the `agent-discovered` label.

**MCP preferred:** Use `mcp__issues__label_list` to resolve `agent-discovered` to a CUID, then:
```
mcp__issues__label_add
  ticketId: "<TICKET_CUID>"
  labelId: "<AGENT_DISCOVERED_LABEL_CUID>"
```

**CLI fallback:**
```bash
issues label add <ticket-id> --label agent-discovered --json
```

## Step 5 — Return summary

Report back:

- Total events analyzed and window covered
- Patterns found and their severity
- Tickets created (with IDs) or existing tickets updated
- Any patterns that were skipped (normal stale TTL, duplicates)

## Notes

- `diagnostics` will be `null` for offline agents — they cannot respond to RPC calls.
  Their presence in the response + matching `hub_timeout` events is the hard-crash signal.
- Log source on Linux is journald (unit `agentd` or `agent-hub`); on macOS it is the file
  at `log.path` in the service config (set by install.sh).
- If the endpoint returns `504 Gateway Timeout`, some agents may be slow to respond.
  The partial results in `agents` are still usable.