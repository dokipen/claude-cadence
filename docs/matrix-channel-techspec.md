# Tech Spec: Matrix Channel Integration for Cadence

## 1. Overview

A Claude Code Channel plugin that bridges Matrix to Cadence, replacing the Issues UI for mobile/chat-based workflows. Users interact with tickets and agents by sending natural language messages in Matrix rooms. Claude Code processes requests using existing cadence skills (`issues-api`, `agent-service`, `ticket-provider`). A background monitor pushes session alerts and board updates into Matrix.

### Goals

- Access ticket management (board, detail, transitions, comments) from Element Android
- Launch, monitor, and destroy agent sessions from Matrix
- Receive push notifications when agent sessions are waiting for input
- Zero business logic duplication — Claude + existing skills handle all operations

### Non-Goals

- Live terminal emulation (link to web UI instead)
- Matrix federation (tuwunel is private, Tailscale-only)
- Multi-user support (single-user server, one authorized sender)

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Element (phone/desktop)                                        │
│  └─ #cadence (root Space)                                       │
│     └─ #cadence-{project} (per-project Space)                   │
│        ├─ #cadence-{project}-board    — ticket board             │
│        ├─ #cadence-{project}-agents   — agent/session status     │
│        ├─ #cadence-{project}-alerts   — waiting-for-input alerts │
│        └─ #cadence-{project}-ticket-N — per-ticket discussion    │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Matrix CS API (sync + send)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  tuwunel (matrix.whatisbackdoor.com:6167)                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Matrix CS API
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  matrix-channel (MCP server, TypeScript/Bun)                     │
│  ├─ Matrix client    — bot login, sync loop, room mgmt          │
│  ├─ Channel layer    — MCP tools + notification emitter          │
│  └─ Monitor          — polls agent-hub, posts alerts/updates     │
└────────┬──────────────────────┬──────────────────────────────────┘
         │ stdio (MCP)          │ HTTP (background)
         ▼                      ▼
┌─────────────────┐  ┌──────────────────────────────────────────────┐
│  Claude Code     │  │  Cadence Backend                             │
│  (agentd session)│  │  ├─ Issues API (GraphQL)  — tickets, comments│
│  ├─ issues-api   │  │  └─ Agent-Hub (REST)      — agents, sessions │
│  ├─ agent-service│  └──────────────────────────────────────────────┘
│  └─ ticket-prov. │
└─────────────────┘
```

### Data Flow: User Message

```
1. User sends "show ticket 42" in #cadence-board (Element)
2. tuwunel delivers event via /sync
3. matrix-channel receives event, emits channel notification to Claude
4. Claude interprets intent, runs: issues ticket view 42 --project claude-cadence --json
5. Claude calls matrix_send_message tool with formatted HTML card
6. matrix-channel sends message to #cadence-board via Matrix CS API
7. User sees formatted ticket detail in Element
```

### Data Flow: Background Alert

```
1. Monitor polls GET /api/v1/sessions every 10s
2. Detects session "lead-42" transitioned to waiting_for_input=true
3. Posts alert to #cadence-alerts via Matrix CS API
4. Element pushes notification to user's phone
```

## 3. Components

### 3.1 MCP Server (`src/index.ts`, `src/channel/server.ts`)

Standard MCP server over stdio transport. Declares `claude/channel` capability.

```typescript
// Capability declaration in initialize response
{
  capabilities: {
    experimental: {
      "claude/channel": {}
    },
    tools: { /* tool definitions */ }
  }
}
```

Lifecycle:
1. Parse config from env vars
2. Initialize Matrix client, start sync
3. Create/discover Space and rooms
4. Start background monitor
5. Begin MCP stdio transport

### 3.2 Matrix Client (`src/matrix/client.ts`)

Uses `matrix-bot-sdk` for Matrix CS API interaction.

```typescript
interface MatrixConfig {
  homeserverUrl: string;     // https://matrix.whatisbackdoor.com
  accessToken: string;       // from MATRIX_ACCESS_TOKEN env
  userId: string;            // @cadence:matrix.whatisbackdoor.com
  authorizedUser: string;    // @doki_pen:matrix.whatisbackdoor.com
}
```

Key behaviors:
- **Sync loop**: Long-poll `/sync` for room events
- **Message filter**: Only process `m.room.message` events from `authorizedUser` (ignore bot's own messages, other users)
- **Sync token persistence**: Store sync token in filesystem to avoid replaying old events on restart

### 3.3 Room Manager (`src/matrix/rooms.ts`)

Creates and discovers the two-level Space hierarchy: a root Space for Cadence, and per-project Spaces containing the functional rooms.

```typescript
interface RoomLayout {
  rootSpaceAlias: string;    // #cadence:matrix.whatisbackdoor.com
  // Per-project rooms are scoped: #cadence-{project}-{room}
}

interface ProjectRooms {
  projectName: string;       // e.g., "claude-cadence"
  spaceRoomId: string;       // per-project Space room ID
  boardRoomId: string;       // #cadence-{project}-board
  agentsRoomId: string;      // #cadence-{project}-agents
  alertsRoomId: string;      // #cadence-{project}-alerts
}
```

Startup sequence:
1. Resolve root Space alias → room ID (or create if missing)
2. For the default project (from `CADENCE_PROJECT` env):
   a. Resolve project Space alias → room ID (or create + add as child of root Space)
   b. For each core room: resolve alias → room ID (or create + add as child of project Space)
3. Invite `authorizedUser` to all rooms if not already joined
4. Store room ID map for use by tools and monitor

Additional project Spaces are created on demand when the user interacts with a different project.

Room creation uses:
```typescript
// Root Space creation
POST /_matrix/client/v3/createRoom
{
  name: "Cadence",
  topic: "Cadence project management",
  creation_content: { type: "m.space" },
  initial_state: [{ type: "m.room.join_rules", content: { join_rule: "invite" } }],
  room_alias_name: "cadence"
}

// Per-project Space (child of root)
POST /_matrix/client/v3/createRoom
{
  name: "claude-cadence",
  topic: "Project: claude-cadence",
  creation_content: { type: "m.space" },
  initial_state: [
    { type: "m.room.join_rules", content: { join_rule: "invite" } },
    { type: "m.space.parent", state_key: "<root_space_id>", content: { via: ["matrix.whatisbackdoor.com"] } }
  ],
  room_alias_name: "cadence-claude-cadence"
}
// Then add m.space.child state event to the root Space

// Functional room (child of project Space)
POST /_matrix/client/v3/createRoom
{
  name: "Board",
  topic: "Ticket board — say 'board' for summary",
  initial_state: [
    { type: "m.space.parent", state_key: "<project_space_id>", content: { via: ["matrix.whatisbackdoor.com"] } }
  ],
  room_alias_name: "cadence-claude-cadence-board"
}
// Then add m.space.child state event to the project Space
```

### 3.4 Channel Notifications (`src/channel/notifications.ts`)

When a Matrix message arrives from the authorized user, emit a channel notification to Claude.

```typescript
// Notification payload
{
  method: "notifications/claude/channel",
  params: {
    channel: "matrix",
    content: [
      {
        type: "text",
        text: `Message from @doki_pen in #cadence-board:\n\n${messageBody}`
      }
    ],
    metadata: {
      room_id: "!abc:matrix.whatisbackdoor.com",
      room_name: "cadence-board",
      sender: "@doki_pen:matrix.whatisbackdoor.com",
      event_id: "$event123",
      thread_root: null  // or event ID if threaded reply
    }
  }
}
```

The `room_name` in metadata tells Claude which room context the message came from, so responses go to the right room.

### 3.5 MCP Tools (`src/channel/tools.ts`)

#### `matrix_send_message`

Send a message to a Matrix room. Primary tool for all Claude responses.

```typescript
{
  name: "matrix_send_message",
  description: "Send a message to a Matrix room. Use html_body for rich formatting.",
  inputSchema: {
    type: "object",
    properties: {
      room_id: { type: "string", description: "Matrix room ID (from notification metadata)" },
      body: { type: "string", description: "Plain text body (fallback)" },
      html_body: { type: "string", description: "HTML formatted body (optional)" },
      thread_event_id: { type: "string", description: "Event ID to reply in thread (optional)" }
    },
    required: ["room_id", "body"]
  }
}
```

Implementation:
```typescript
PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
{
  msgtype: "m.text",
  body: body,                              // plain text fallback
  format: "org.matrix.custom.html",        // only if html_body provided
  formatted_body: html_body,
  "m.relates_to": thread_event_id ? {      // only if threading
    rel_type: "m.thread",
    event_id: thread_event_id,
    is_falling_back: true,
    "m.in_reply_to": { event_id: thread_event_id }
  } : undefined
}
```

#### `matrix_send_reaction`

React to a message (confirmations, quick actions).

```typescript
{
  name: "matrix_send_reaction",
  inputSchema: {
    properties: {
      room_id: { type: "string" },
      event_id: { type: "string", description: "Event to react to" },
      reaction: { type: "string", description: "Emoji reaction (e.g. ✅, ❌)" }
    },
    required: ["room_id", "event_id", "reaction"]
  }
}
```

#### `matrix_create_ticket_room`

Create a per-ticket discussion room in the Space.

```typescript
{
  name: "matrix_create_ticket_room",
  inputSchema: {
    properties: {
      ticket_number: { type: "number" },
      ticket_title: { type: "string" }
    },
    required: ["ticket_number", "ticket_title"]
  }
}
```

Creates room `#cadence-ticket-{number}`, adds as Space child, invites authorized user, returns room ID.

#### `matrix_update_topic`

Update a room's topic (useful for status summaries).

```typescript
{
  name: "matrix_update_topic",
  inputSchema: {
    properties: {
      room_id: { type: "string" },
      topic: { type: "string" }
    },
    required: ["room_id", "topic"]
  }
}
```

### 3.6 HTML Formatter (`src/matrix/formatter.ts`)

Converts ticket and session data into Matrix-compatible HTML. Matrix supports a subset of HTML via `org.matrix.custom.html` format. Element renders: `<b>`, `<i>`, `<code>`, `<pre>`, `<a>`, `<table>`, `<tr>`, `<td>`, `<th>`, `<h1>`-`<h6>`, `<ul>`, `<ol>`, `<li>`, `<br>`, `<hr>`, `<blockquote>`, `<span data-mx-color>`.

#### Board Summary

```html
<h3>📋 Board — claude-cadence</h3>

<b>IN_PROGRESS (2)</b>
<table>
<tr><td><b>#42</b></td><td>Fix login timeout</td><td>🔴 HIGH</td><td>bug</td><td>5 pts</td></tr>
<tr><td><b>#38</b></td><td>Add dark mode</td><td>🟡 MEDIUM</td><td>enhancement</td><td>3 pts</td></tr>
</table>

<b>REFINED (3)</b>
<table>
<tr><td><b>#45</b></td><td>Refactor auth middleware</td><td>🟡 MEDIUM</td><td>refactor</td><td>8 pts</td></tr>
...
</table>

<b>BACKLOG (12)</b> · <b>CLOSED (47)</b>
```

#### Ticket Detail Card

```html
<h3>#42 — Fix login timeout</h3>
<b>State:</b> IN_PROGRESS · <b>Priority:</b> 🔴 HIGH · <b>Points:</b> 5
<b>Labels:</b> <code>bug</code>
<b>Assignee:</b> doki_pen

<b>Description:</b>
Login times out after 30 seconds on slow connections...

<b>Acceptance Criteria:</b>
<ul>
<li>Timeout configurable via env var</li>
<li>Default increased to 60s</li>
</ul>

<b>Blocked by:</b> #38 (IN_PROGRESS)
<b>Blocks:</b> #50

<b>Comments (2):</b>
<blockquote><b>doki_pen</b> (2h ago): Should we also add a retry?</blockquote>
<blockquote><b>claude</b> (1h ago): Added retry with exponential backoff.</blockquote>
```

#### Agent Status Table

```html
<h3>🤖 Agents</h3>
<table>
<tr><th>Agent</th><th>Status</th><th>Sessions</th></tr>
<tr><td>bootsy</td><td>🟢 online</td><td>2 running, 1 waiting</td></tr>
<tr><td>workstation</td><td>⚪ offline</td><td>—</td></tr>
</table>

<b>Active Sessions:</b>
<table>
<tr><th>Session</th><th>Profile</th><th>State</th><th>Since</th></tr>
<tr><td>lead-42</td><td>lead</td><td>⏳ waiting</td><td>3m ago</td></tr>
<tr><td>review-pr-99</td><td>code-reviewer</td><td>🟢 running</td><td>12m ago</td></tr>
</table>
```

#### Alert Message

```html
<b>⚠️ Session needs input</b>
<b>Session:</b> lead-42 · <b>Agent:</b> bootsy · <b>Profile:</b> lead
<b>Idle:</b> 3 minutes
<a href="https://cadence.bootsy.internal/agents">Open in web UI →</a>
```

### 3.7 Background Monitor (`src/bridge/monitor.ts`)

Runs independently of the MCP channel — polls Cadence backends and posts directly to Matrix.

```typescript
interface MonitorState {
  // Track known session states for delta detection
  knownSessions: Map<string, { state: string; waitingForInput: boolean }>;
  // Track alerted waiting sessions to avoid duplicates
  alertedSessions: Set<string>;
  // Rate limiting: last message time per room
  lastMessageTime: Map<string, number>;
}
```

#### Polling Loop

```typescript
setInterval(async () => {
  const sessions = await fetchAllSessions(hubApiUrl, hubApiToken);

  for (const { agentName, sessions: agentSessions } of sessions) {
    for (const session of agentSessions) {
      const key = `${agentName}:${session.id}`;
      const prev = monitorState.knownSessions.get(key);

      // New waiting session → alert
      if (session.waiting_for_input && !monitorState.alertedSessions.has(key)) {
        await postAlert(alertsRoomId, session, agentName);
        monitorState.alertedSessions.add(key);
      }

      // Session no longer waiting → clear alert tracking
      if (!session.waiting_for_input && monitorState.alertedSessions.has(key)) {
        monitorState.alertedSessions.delete(key);
      }

      // State changed → post update to agents room
      if (prev && prev.state !== session.state) {
        await postStateChange(agentsRoomId, session, agentName, prev.state);
      }

      monitorState.knownSessions.set(key, {
        state: session.state,
        waitingForInput: session.waiting_for_input,
      });
    }
  }

  // Clean up sessions that no longer exist
  // ...
}, 10_000);  // 10 second interval
```

#### Rate Limiting

Minimum 5 seconds between messages per room to avoid flooding:

```typescript
function canPostToRoom(roomId: string): boolean {
  const last = monitorState.lastMessageTime.get(roomId) ?? 0;
  return Date.now() - last >= 5000;
}
```

### 3.8 API Clients (`src/api/`)

#### Issues Client (`issues-client.ts`)

Used by the monitor for board delta detection. Claude uses the `issues` CLI directly for operations, but the monitor needs programmatic access.

```typescript
interface IssuesClient {
  fetchBoardTickets(projectId: string, state?: TicketState): Promise<TicketEdge[]>;
}
```

Uses `graphql-request` against the Issues API GraphQL endpoint. Reuses query patterns from `services/issues-ui/src/api/queries.ts`.

Auth: Uses the same GitHub PAT flow — `gh auth token` piped to `issues auth login`.

#### Hub Client (`hub-client.ts`)

Used by the monitor for session polling. Simpler than the issues-ui client — no protobuf parsing needed, just plain JSON.

```typescript
interface HubClient {
  fetchAgents(): Promise<Agent[]>;
  fetchAllSessions(): Promise<AgentSessions[]>;
}

// Simple fetch wrapper
async function hubFetch<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Hub API ${res.status}: ${res.statusText}`);
  return res.json();
}
```

## 4. Configuration

All configuration via environment variables (no config file needed for v1):

| Variable | Required | Description |
|----------|----------|-------------|
| `MATRIX_HOMESERVER_URL` | yes | `https://matrix.whatisbackdoor.com` |
| `MATRIX_ACCESS_TOKEN` | yes | Bot user access token |
| `MATRIX_USER_ID` | yes | `@cadence:matrix.whatisbackdoor.com` |
| `MATRIX_AUTHORIZED_USER` | yes | `@doki_pen:matrix.whatisbackdoor.com` |
| `CADENCE_HUB_API_URL` | yes | `https://cadence.bootsy.internal/api/v1` |
| `CADENCE_HUB_API_TOKEN` | yes | Agent-Hub API token |
| `CADENCE_ISSUES_API_URL` | no | `https://cadence.bootsy.internal/graphql` (for monitor) |
| `CADENCE_PROJECT` | no | Default project name (default: `claude-cadence`) |
| `MONITOR_INTERVAL_MS` | no | Polling interval (default: `10000`) |

## 5. Skill Definition

`skills/matrix-bridge/SKILL.md` teaches Claude how to handle Matrix messages:

```markdown
---
name: matrix-bridge
description: Matrix channel integration for Cadence. Teaches Claude how to interpret
  Matrix messages and respond using matrix_* tools.
user-invokable: false
---

## Overview

You are connected to Matrix via the matrix-channel plugin. Messages from the user
arrive as channel notifications with room context. Use the matrix_* tools to respond.

## Room Context

- **#cadence-board** — Ticket operations. Respond to: board, show/view ticket,
  create ticket, transition, filter queries.
- **#cadence-agents** — Agent operations. Respond to: agent list, session list,
  launch/destroy sessions.
- **#cadence-alerts** — Read-only for the monitor. User may reply to discuss alerts.

## Response Guidelines

- Always respond in the same room the message came from (use room_id from metadata)
- Use html_body for all responses (formatted ticket cards, tables, etc.)
- Keep responses concise — this is a mobile chat interface
- Use the issues CLI for ticket operations, agent-hub API for session operations
- After performing an action, confirm with a brief message (not the full detail)

## Common Patterns

| User says | Action |
|-----------|--------|
| "board" | Fetch tickets by state, format as board summary, send to room |
| "show 42" / "ticket 42" | Fetch ticket detail, format as card, send to room |
| "create ticket: ..." | Create via issues CLI, confirm with ticket number |
| "move 42 to REFINED" | Transition via issues CLI, confirm |
| "agents" | Fetch agents + sessions, format as status table |
| "lead 42" | Create session on first online agent, confirm |
| "stop lead-42" | Destroy session, confirm |
```

## 6. Deployment

### agentd Profile

Add a `matrix-bridge` profile to agentd config:

```yaml
matrix-bridge:
  description: "Matrix bridge — Cadence ↔ Matrix channel"
  repo: "https://github.com/dokipen/claude-cadence.git"
  command: >-
    claude --model sonnet
    --permission-mode accept
    --plugin-dir {{.PluginDir}}
    --mcp-server "bun run {{.RepoPath}}/services/matrix-channel/src/index.ts"
    --cwd {{.WorktreePath}}
```

### Bot User Setup

Create `@cadence:matrix.whatisbackdoor.com` on tuwunel:
1. Temporarily enable registration with token
2. Register user via Matrix CS API
3. Store access token in env var
4. Disable registration

### Service Lifecycle

- agentd manages the Claude Code session
- Claude Code manages the MCP server subprocess
- If the MCP server crashes, Claude Code restarts it
- If the Claude Code session crashes, agentd restarts it
- The Matrix sync token persists to disk, so restarts resume without replaying history

## 7. Directory Structure

```
services/matrix-channel/
  package.json
  tsconfig.json
  src/
    index.ts                    # Entrypoint: init config → init matrix → start MCP server → start monitor
    config.ts                   # Load and validate env vars
    matrix/
      client.ts                 # MatrixClient wrapper (login, sync, send, react)
      rooms.ts                  # RoomManager (space/room creation, alias resolution)
      formatter.ts              # formatBoard(), formatTicket(), formatAgents(), formatAlert()
    channel/
      server.ts                 # MCP Server setup with claude/channel capability
      tools.ts                  # Tool definitions and handlers
      notifications.ts          # Matrix event → MCP channel notification
    bridge/
      monitor.ts                # Background polling loop + alert logic
    api/
      hub-client.ts             # Agent-Hub REST client (fetch, minimal, no protobuf)
      issues-client.ts          # Issues API GraphQL client (board queries)
skills/matrix-bridge/
  SKILL.md                      # Claude instruction set for Matrix interaction
```

## 8. Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "matrix-bot-sdk": "^0.7.0",
    "graphql-request": "^7.0.0",
    "graphql": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/bun": "latest",
    "bun-types": "latest"
  }
}
```

## 9. Implementation Phases

### Phase 1: Foundation (this spec)
Scaffold project, Matrix bot, MCP server, basic message round-trip.

**Exit criteria:** Send "hello" in #cadence-board → Claude responds in the same room.

### Phase 2: Ticket Operations
Claude handles ticket commands using `issues` CLI, responds with formatted HTML.

**Exit criteria:** "board" → formatted kanban; "show 42" → ticket card; "create ticket: X" → ticket created.

### Phase 3: Agent Management
Claude handles agent/session commands via agent-hub REST API.

**Exit criteria:** "agents" → status table; "lead 42" → session created; "stop X" → session destroyed.

### Phase 4: Background Monitoring
Monitor polls agent-hub, posts alerts and state changes.

**Exit criteria:** Session enters waiting state → push notification on phone via Element.

### Phase 5: Reactions + Polish
Reaction-based quick actions, mobile formatting optimization.

**Exit criteria:** React with ✅ on a ticket message → ticket closed.

## 10. Security Considerations

- **Single authorized user**: Only process messages from `MATRIX_AUTHORIZED_USER`. All other senders are silently ignored.
- **No federation**: tuwunel configured with `allow_federation = false`. Server only reachable via LAN/Tailscale.
- **Token storage**: Access tokens stored in environment variables, not in config files checked into git.
- **Room privacy**: All rooms invite-only (`join_rule: invite`). Bot + authorized user only.
- **Input validation**: Room IDs and event IDs from tool calls are validated against known rooms before use.
