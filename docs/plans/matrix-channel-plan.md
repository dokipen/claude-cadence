# Matrix Integration for Cadence via Claude Code Channels

## Context

The Cadence Issues UI is a React web app that provides a kanban board, agent session management, terminal streaming, and notifications. The goal is to reproduce most of these features in Matrix so they're accessible from a phone (Element Android) via the tuwunel server at matrix.whatisbackdoor.com. Claude Code Channels bridge Matrix messages into a Claude Code session, which already has all cadence skills loaded — so Claude becomes the "backend brain" that processes requests and interacts with the Issues API and Agent-Hub.

## Architecture

```
Phone (Element) → tuwunel (Matrix) → Channel Plugin (MCP) → Claude Code → Cadence Skills
                ←                   ←                      ←             ← (issues-api, agent-service)
```

A single TypeScript MCP server that:
1. Connects to tuwunel as a bot user (`@cadence:matrix.whatisbackdoor.com`)
2. Declares `claude/channel` capability
3. Emits channel notifications when Matrix messages arrive
4. Exposes tools for Claude to send messages, reactions, create rooms
5. Runs background monitors that poll Agent-Hub for session state changes and post alerts

Runs as a subprocess of Claude Code in an agentd session — agentd keeps it alive permanently.

## Directory Structure

```
services/matrix-channel/
  package.json
  tsconfig.json
  src/
    index.ts                # MCP server entrypoint (stdio transport)
    config.ts               # Config loading (env vars / yaml)
    matrix/
      client.ts             # Matrix bot: login, sync, room management
      rooms.ts              # Space + room creation/discovery
      formatter.ts          # Ticket/session/board data → Matrix HTML
    channel/
      server.ts             # MCP server setup, capability declaration
      tools.ts              # MCP tools: send_message, create_room, react, etc.
      notifications.ts      # Matrix message → channel notification emitter
    bridge/
      monitor.ts            # Background polling: sessions, tickets, alerts
    api/
      issues-client.ts      # GraphQL client for Issues API
      hub-client.ts         # REST client for Agent-Hub API
skills/matrix-bridge/
  SKILL.md                  # Teaches Claude how to use the Matrix tools
```

**Dependencies:** `@modelcontextprotocol/sdk`, `matrix-bot-sdk`, `graphql-request`

## Matrix Room Structure

**Space:** `#cadence:matrix.whatisbackdoor.com`

| Room | Purpose | Maps to UI feature |
|------|---------|-------------------|
| `#cadence-board` | Ticket summaries, state changes, board view | KanbanBoard |
| `#cadence-agents` | Agent/session status, launch, destroy | AgentManager |
| `#cadence-alerts` | Waiting-for-input notifications | NotificationDropdown |
| `#cadence-ticket-{N}` | Per-ticket discussion (created on demand) | TicketDetail |

## Feature Mapping

| Issues UI Feature | Matrix Equivalent |
|---|---|
| Kanban board (4 columns) | "board" → Claude posts HTML table grouped by state |
| Drag-drop state transition | "move 42 to IN_PROGRESS" → Claude calls issues-api |
| Ticket detail view | "show 42" → Claude posts formatted ticket card |
| Comments | "comment on 42: looks good" → Claude posts comment |
| Create ticket | "create ticket: Fix auth timeout" → Claude uses create-ticket |
| Filtering (labels, priority) | Natural language: "show blocked high-priority bugs" |
| Agent list (online/offline) | "agents" → Claude posts agent status table |
| Session launch | "lead 42" → Claude creates session via agent-hub |
| Session destroy | "stop lead-42" → Claude destroys session |
| Terminal streaming | NOT replicated — link to web UI provided instead |
| Waiting-for-input notification | Background monitor posts to #cadence-alerts with push |
| CQL query language | Replaced by natural language (strictly better in chat) |

## MCP Tools

| Tool | Purpose |
|------|---------|
| `matrix_send_message` | Send plain/HTML message to a room (with optional thread) |
| `matrix_send_reaction` | React to a message (confirmations, quick actions) |
| `matrix_create_ticket_room` | Create per-ticket room in the Space |
| `matrix_update_topic` | Update room topic (status summaries) |

Claude uses existing cadence skills for all business logic — the channel only provides Matrix transport.

## Implementation Phases

### Phase 1: Foundation
- MCP server scaffold with `claude/channel` capability
- Matrix bot login + sync loop via `matrix-bot-sdk`
- Space and core room creation/discovery
- `matrix_send_message` tool (plain + HTML)
- Channel notifications: Matrix message → Claude
- `skills/matrix-bridge/SKILL.md`
- Bot user creation on tuwunel

### Phase 2: Ticket Operations
- Issues API GraphQL client (reference: `services/issues-ui/src/api/queries.ts`)
- HTML formatter for ticket cards and board summaries
- Board view, ticket detail, transitions, creation, comments
- All driven by natural language → Claude → existing skills

### Phase 3: Agent Management
- Agent-Hub REST client (reference: `services/issues-ui/src/api/agentHubClient.ts`)
- Agent/session status display
- Session launch and destroy from Matrix
- Formatted session status cards

### Phase 4: Background Monitoring + Alerts
- Poll agent-hub every 10s for session state changes
- Waiting-for-input detection → post to #cadence-alerts
- Session state transition notifications
- Board delta updates (only post when something changes)
- Dedup alerts with in-memory Set of alerted session IDs

### Phase 5: Reactions + Polish
- Reaction-based quick actions on ticket messages
- Confirmation/error reactions from Claude
- Mobile UX optimization (message formatting for small screens)

## Key Reference Files

- `services/issues-ui/src/api/queries.ts` — GraphQL queries to reuse
- `services/issues-ui/src/api/agentHubClient.ts` — Agent-Hub client patterns
- `services/issues-ui/src/components/launchConfig.ts` — Session launch logic
- `skills/agent-service/SKILL.md` — Agent-Hub architecture reference
- `skills/issues-api/SKILL.md` — Issues CLI/API reference

## Known Limitations

- **No live terminal streaming** — Matrix can't replicate xterm.js. Links to web UI provided instead.
- **Rate limiting** — Monitor batches updates, minimum 5s between messages per room.
- **Message size** — Board summaries paginated/truncated for large projects.

## Verification

1. Start tuwunel, confirm bot can login and create rooms
2. Send a message in #cadence-board, verify Claude receives channel notification
3. Say "board" → verify formatted kanban summary appears
4. Say "show 42" → verify ticket detail card
5. Say "agents" → verify agent status table
6. Say "lead 42" → verify session created via agent-hub
7. Wait for session to need input → verify alert in #cadence-alerts with push notification on phone
8. Confirm all operations work from Element Android over Tailscale
