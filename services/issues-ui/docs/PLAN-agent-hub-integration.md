# Agent Hub Integration: Web UI for Agent Management

## Problem

Agent sessions are managed exclusively via REST API and CLI. There is no way to view agent status, create sessions, or access terminals from the issues-ui web interface. As the number of agents and sessions grows, operators need a visual dashboard alongside ticket management.

## Solution

Extend issues-ui with agent management pages that talk directly to the agent-hub REST API. The existing Caddy reverse proxy already routes `/api/v1/*` to agent-hub (port 4200), so the frontend needs only a REST client and new pages — no backend changes required.

## Architecture

```
Browser (issues-ui SPA)
        |
      Caddy (cadence.bootsy.internal)
        |
   +---------+----------+-----------+
   |         |          |           |
 /graphql  /api/v1   /ws/terminal  /* (SPA)
   |         |          |
 issues   agent-hub  agent-hub
 (4000)   (4200)     (4200)
```

The UI uses two API transports:
- **GraphQL** (graphql-request) → issues-api for tickets, comments, labels
- **REST** (fetch) → agent-hub for agents, sessions, terminal endpoints

## Key Design Decisions

- **Direct REST calls** from the browser to agent-hub (via Caddy proxy) — no GraphQL gateway or BFF layer. The agent-hub API is already well-structured REST and adding a GraphQL wrapper would be unnecessary indirection.
- **Caddy injects the hub API token** for `/api/v1/*` requests so the browser never handles the agent-hub auth token. This keeps the token server-side and avoids a second auth flow.
- **Vite dev proxy** mirrors the Caddy setup: `/api/v1` → `http://localhost:4200` for local development.
- **Polling for agent status** using the existing `usePollingQuery` pattern (adapted for REST). WebSocket push for real-time status is deferred to a future iteration.
- **xterm.js** for the embedded terminal — the industry-standard browser terminal emulator, used by VS Code, Gitpod, and others.

---

## Phase 1: REST Client & Proxy Setup

Add a REST API client for agent-hub and configure the dev proxy.

### Vite Proxy

Add to `vite.config.ts`:

```ts
"/api/v1": `http://localhost:${agentHubPort}`,
```

This mirrors the production Caddy config for local development.

### REST Client

New file: `src/api/agentHubClient.ts`

A thin wrapper around `fetch` for the agent-hub REST API:

```ts
async function hubFetch<T>(path: string, options?: RequestInit): Promise<T>
```

- Prefixes all paths with `/api/v1`
- Parses JSON responses
- Maps HTTP errors to thrown errors with status codes
- No auth header needed (Caddy/Vite proxy handles it)

### TypeScript Types

New file: `src/types/agents.ts`

```ts
type AgentStatus = "online" | "offline";

interface AgentProfile {
  description: string;
}

interface Agent {
  name: string;
  profiles: Record<string, AgentProfile>;
  status: AgentStatus;
  last_seen: string;
}

type SessionState = "creating" | "running" | "stopped" | "error" | "destroying";

interface Session {
  id: string;
  name: string;
  agent_profile: string;
  state: SessionState;
  tmux_session: string;
  created_at: string;
  stopped_at?: string;
  error_message?: string;
  agent_pid: number;
  websocket_url?: string;
  worktree_path: string;
  repo_url: string;
  base_ref: string;
}
```

### Acceptance Criteria

- [ ] Vite dev proxy forwards `/api/v1/*` to agent-hub
- [ ] `hubFetch` function handles GET, POST, DELETE with JSON parsing
- [ ] TypeScript types match agent-hub REST response shapes
- [ ] Error responses (404, 502, 504) are surfaced as typed errors

---

## Phase 2: Agents Overview Page

A new top-level page showing all registered agents and their status.

### Route

`/agents` — added to AppShell routes, with a header nav link.

### Components

**AgentsPage** (`src/components/AgentsPage.tsx`)
- Fetches `GET /api/v1/agents` on an interval (reuse polling pattern)
- Renders a grid of AgentCard components
- Shows empty state when no agents are registered

**AgentCard** (`src/components/AgentCard.tsx`)
- Agent name, status indicator (green dot = online, red = offline)
- Profile list (badges)
- Session count (fetched via `GET /api/v1/agents/:name/sessions`)
- Click navigates to agent detail page

### Navigation

Add "Agents" link to the AppShell header, alongside the existing project selector.

### Acceptance Criteria

- [ ] `/agents` route renders the agents overview page
- [ ] Agent cards display name, status, and profiles
- [ ] Polling refreshes agent list on a 15-second interval
- [ ] Offline agents are visually distinguished from online agents
- [ ] Header navigation includes a link to the agents page
- [ ] Empty state shown when no agents are registered

---

## Phase 3: Session Management

View, create, and destroy sessions for a specific agent.

### Routes

- `/agents/:name` — agent detail with session list
- `/agents/:name/sessions/:id` — session detail

### Components

**AgentDetail** (`src/components/AgentDetail.tsx`)
- Agent info header (name, status, profiles, last seen)
- Sessions table: name, profile, state, created time, actions
- "New Session" button opens CreateSessionDialog
- Polling refreshes sessions on a 15-second interval

**CreateSessionDialog** (`src/components/CreateSessionDialog.tsx`)
- Profile dropdown (populated from agent's registered profiles)
- Session name input
- Optional extra args input
- Calls `POST /api/v1/agents/:name/sessions`

**SessionDetail** (`src/components/SessionDetail.tsx`)
- Session metadata: name, profile, state, created/stopped timestamps
- Worktree info: repo URL, base ref, worktree path
- Error message display (when state = error)
- "Destroy" button with confirmation
- Terminal placeholder (wired up in Phase 4)

### Acceptance Criteria

- [ ] Agent detail page lists all sessions with state indicators
- [ ] Create session dialog validates inputs and shows loading/error states
- [ ] Sessions can be destroyed with a confirmation step
- [ ] Session detail shows all metadata fields
- [ ] Agent offline state disables session creation with a clear message

---

## Phase 4: Embedded Web Terminal

Connect to agent sessions via the hub's WebSocket terminal proxy.

### Dependencies

Add `@xterm/xterm` and `@xterm/addon-fit` (auto-resize) to `package.json`.

### Components

**Terminal** (`src/components/Terminal.tsx`)
- Wraps xterm.js instance
- Connects to `ws[s]://<host>/ws/terminal/:agent/:session`
- Handles resize events (addon-fit)
- Reconnect on disconnect with backoff
- Loading, connected, disconnected, and error states

### Integration

- Add terminal panel to SessionDetail (Phase 3 component)
- Show terminal only when session state is `running`
- Full-height layout with session metadata in a collapsible sidebar

### Acceptance Criteria

- [ ] Terminal connects to the hub WebSocket proxy and renders output
- [ ] Terminal input is sent to the remote session
- [ ] Terminal auto-resizes on window resize
- [ ] Disconnection shows a reconnect prompt
- [ ] Terminal is only available for sessions in `running` state

---

## Future Considerations

These are not in scope for the initial integration but are natural follow-ons:

- **Ticket-session linking**: Associate agent sessions with tickets so the board shows which agents are working on which issues. Requires data model changes (issues-api or agent-hub metadata).
- **Real-time status via WebSocket**: Replace polling with a push model for agent/session status updates.
- **Session logs**: Capture and display scrollback history for completed sessions.
- **Multi-agent orchestration**: Launch coordinated sessions across multiple agents from the UI.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/api/agentHubClient.ts` | REST client for agent-hub API |
| `src/types/agents.ts` | TypeScript types for agents and sessions |
| `src/components/AgentsPage.tsx` | Agents overview page |
| `src/components/AgentCard.tsx` | Individual agent card |
| `src/components/AgentDetail.tsx` | Agent detail with session list |
| `src/components/CreateSessionDialog.tsx` | New session dialog |
| `src/components/SessionDetail.tsx` | Session detail view |
| `src/components/Terminal.tsx` | xterm.js terminal wrapper |
| `src/styles/agents.module.css` | Styles for agent pages |

## Files to Modify

| File | Change |
|------|--------|
| `vite.config.ts` | Add `/api/v1` proxy rule |
| `src/App.tsx` | Add `/agents/*` routes and header navigation |
| `src/styles/layout.module.css` | Header nav link styles |
| `package.json` | Add xterm.js dependencies (Phase 4) |
