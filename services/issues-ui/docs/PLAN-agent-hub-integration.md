# Agent Hub Integration: Ticket-Centric Agent Management

## Problem

Agent sessions are managed exclusively via REST API and CLI. There is no way to launch an agent on a ticket, view its terminal, or manage sessions from the web UI. The workflow today requires switching between the issues-ui (tickets) and the command line (agents) — these should be unified.

## Solution

Add agent management capabilities directly into the ticket workflow:
- **Kanban board**: A "Launch Agent" button on each ticket card opens a dialog to select an agent host and profile, then creates a session
- **Ticket detail**: Tab navigation ("Details" | "Agent") where the Agent tab shows an embedded xterm.js terminal connected to the session

Agents are launched _from_ tickets, not managed as a separate concern.

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
- **REST** (fetch) → agent-hub for agents, sessions
- **WebSocket** → agent-hub terminal proxy for xterm.js

## Key Design Decisions

- **Ticket-centric, not agent-centric**: No separate `/agents` page. Agent interaction happens through ticket cards and the ticket detail view. This matches the workflow — agents work on tickets.
- **Profile filtering by repo**: Each agentd profile has a `repo` field. The UI matches `profile.repo` against the ticket's `project.repository` to show only relevant profiles. If there's only one match, the dropdown is collapsed to just show it.
- **Caddy injects the hub API token** for `/api/v1/*` requests so the browser never handles the agent-hub auth token. Vite dev proxy mirrors this.
- **Session naming convention**: Sessions are named `lead-{ticket-number}` so the UI can associate sessions with tickets without a formal link in the data model.
- **xterm.js** for the embedded terminal — industry-standard, used by VS Code and Gitpod.

---

## Phase 1: Add repo field to agent-hub profile registration

The hub's `ProfileInfo` currently only has `description`. The UI needs `repo` to filter profiles by the ticket's project repository.

### User Stories

1. **As a frontend developer**, I can see the `repo` field in the `GET /api/v1/agents` response for each profile, so I can filter profiles by repository in the UI.
2. **As an operator**, I can register agents with profiles that include repo URLs, and the hub surfaces this information via its REST API.

### Changes

**agent-hub** (`services/agent-hub/internal/hub/messages.go`):
```go
type ProfileInfo struct {
    Description string `json:"description"`
    Repo        string `json:"repo"`
}
```

**agentd hub client** (`services/agents/internal/hub/client.go`):
```go
// In register(), change:
profiles[name] = profileInfo{Description: p.Description}
// To:
profiles[name] = profileInfo{Description: p.Description, Repo: p.Repo}
```

**agentd hub client types** (same file):
```go
type profileInfo struct {
    Description string `json:"description"`
    Repo        string `json:"repo"`
}
```

### Acceptance Criteria

- [ ] `ProfileInfo` in agent-hub includes `repo` field
- [ ] agentd sends `repo` during registration
- [ ] `GET /api/v1/agents` response includes `repo` for each profile
- [ ] Existing agents without repo field register successfully (backward compatible)
- [ ] E2E tests verify agent registration includes repo and the REST API returns it

---

## Phase 2: REST client, types, and Vite proxy

Frontend foundation: API client for agent-hub and TypeScript types.

### User Stories

1. **As a developer**, I can import `hubFetch` and make typed REST calls to the agent-hub API from the issues-ui codebase.
2. **As a developer**, I can call `useAgents()` in a component to get a polling list of registered agents with their profiles and status.
3. **As a developer**, I can call `useAgentProfiles(repoUrl)` to get only the agent/profile combinations that match a given repository URL.

### Vite Proxy

Add to `vite.config.ts`:
```ts
"/api/v1": `http://localhost:${agentHubPort}`,
```

### REST Client

New file: `src/api/agentHubClient.ts`

A thin wrapper around `fetch`:
```ts
async function hubFetch<T>(path: string, options?: RequestInit): Promise<T>
```

- Prefixes paths with `/api/v1`
- Parses JSON, maps HTTP errors to thrown errors with status codes
- No auth header (proxy handles it)

### TypeScript Types

New file: `src/types/agents.ts`

```ts
type AgentStatus = "online" | "offline";

interface AgentProfile {
  description: string;
  repo: string;
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

### GraphQL Change

Add `repository` to the `TICKET_DETAIL_QUERY` project field:
```graphql
project {
  id
  name
  repository   # needed for profile filtering
}
```

### Hooks

- `useAgents()` — polls `GET /api/v1/agents`, returns typed agent list
- `useAgentProfiles(repoUrl)` — filters profiles across all online agents matching a repo URL, returns `{ agent, profileName, profile }[]`

### Acceptance Criteria

- [ ] Vite dev proxy forwards `/api/v1/*` to agent-hub
- [ ] `hubFetch` handles GET, POST, DELETE with JSON parsing and error mapping
- [ ] TypeScript types match agent-hub REST response shapes
- [ ] `useAgents` hook fetches and caches agent list with polling
- [ ] `useAgentProfiles` filters to profiles matching a given repo URL
- [ ] `TICKET_DETAIL_QUERY` includes `project.repository`
- [ ] E2E tests verify the Vite proxy forwards `/api/v1/agents` and returns agent data

---

## Phase 3: Launch agent from ticket

Two surfaces for launching agents: a dialog on ticket cards and an inline control in the ticket detail view.

### User Stories

1. **As a user**, I can click a "Launch" button on a ticket card in the Kanban board to open a dialog where I choose an agent host and profile, so that an agent session is created to work on that ticket.
2. **As a user**, I see only agent profiles that match the ticket's project repository, so I don't accidentally launch the wrong profile.
3. **As a user**, when there is only one matching profile for the repo, I see it pre-selected without needing to choose from a dropdown.
4. **As a user**, after launching an agent I am navigated to the ticket detail's Agent tab so I can see the session.
5. **As a user**, I can launch an agent from the ticket detail's Agent tab using the same controls (inline, not a dialog).

### Kanban Board — Launch Dialog

Add a "Launch" button to `TicketCard`. Clicking opens `LaunchAgentDialog`:

- **Agent host dropdown**: Lists online agents that have at least one profile matching the ticket's `project.repository`
- **Profile dropdown**: Profiles filtered by repo. If only one match exists, show it as text instead of a dropdown
- **Submit**: Calls `POST /api/v1/agents/:name/sessions` with `{ agent_profile, session_name: "lead-{number}", extra_args: ["{number}"] }`
- **On success**: Navigates to `/ticket/:id` (Agent tab)

The launch button needs to stop click propagation so it doesn't navigate to the ticket detail.

### Ticket Detail — Inline Launch Control

Same agent/profile selection, but rendered inline in the Agent tab (not in a dialog). Shown when no active session exists for this ticket.

### Components

| Component | Location |
|-----------|----------|
| `LaunchAgentDialog.tsx` | Modal dialog triggered from TicketCard |
| `AgentLauncher.tsx` | Shared agent/profile selection logic, used by both dialog and inline |

### Acceptance Criteria

- [ ] TicketCard has a "Launch" button that opens the dialog
- [ ] Dialog shows agent hosts filtered to those with matching repo profiles
- [ ] Profile dropdown is auto-selected when only one match
- [ ] Session is created via agent-hub REST API
- [ ] Successful launch navigates to ticket detail Agent tab
- [ ] Ticket detail Agent tab shows inline launch control when no session exists
- [ ] Launch button click does not trigger card navigation
- [ ] E2E tests cover: opening the launch dialog from a ticket card, profile filtering by repo, auto-select with single match, session creation, and navigation to Agent tab

---

## Phase 4: Ticket detail tab nav with embedded terminal

Replace the single-view ticket detail with a tabbed layout.

### User Stories

1. **As a user**, I see "Details" and "Agent" tabs on the ticket detail page, so I can switch between ticket information and the agent terminal.
2. **As a user**, when I open the Agent tab and a session is running for this ticket, I see a live terminal where I can interact with the agent.
3. **As a user**, the terminal fills the available browser height so I have maximum working space.
4. **As a user**, if the terminal disconnects, I see a reconnect prompt so I can re-establish the connection.
5. **As a user**, I can destroy an active session from the Agent tab when the work is done.

### Tab Navigation

Two tabs on `TicketDetail`: **Details** (current content) and **Agent**.

### Agent Tab

- **No session**: Shows the inline `AgentLauncher` control from Phase 3
- **Active session**: Shows an xterm.js terminal filling the available browser height
  - Connects to `ws[s]://<host>/ws/terminal/:agent/:session`
  - Auto-resizes via `@xterm/addon-fit`
  - Shows loading, connected, disconnected, and error states
  - Reconnect prompt on disconnect
  - "Destroy" button to end the session

### Session Discovery

The Agent tab finds sessions for the current ticket by listing sessions across online agents and matching by session name prefix `lead-{ticket.number}`.

### Dependencies

Add to `package.json`:
- `@xterm/xterm`
- `@xterm/addon-fit`

### Components

| Component | Location |
|-----------|----------|
| `Terminal.tsx` | xterm.js wrapper with WebSocket connection management |
| `AgentTab.tsx` | Agent tab content: launcher or terminal |

### Acceptance Criteria

- [ ] Ticket detail has "Details" and "Agent" tab navigation
- [ ] Details tab shows the existing ticket content unchanged
- [ ] Agent tab shows terminal when a running session exists
- [ ] Terminal connects to hub WebSocket proxy and renders output
- [ ] Terminal input is sent to the remote session
- [ ] Terminal auto-resizes on window resize
- [ ] Disconnection shows a reconnect prompt
- [ ] Terminal is only available for sessions in `running` state
- [ ] Agent tab shows launch control when no session exists
- [ ] Terminal uses UTF-8 encoding and proper charset so Claude Code renders fully featured output (unicode, box drawing, etc.)
- [ ] Terminal color scheme matches Cadence branding
- [ ] E2E tests cover: tab navigation between Details and Agent, terminal rendering for a running session, and launch control shown when no session exists

---

## Phase 5: Agent Manager with Tiling Terminal Layout

A dedicated `/agents` page for managing all active sessions across agents with a tiling window manager interface inspired by [ion](https://tuomov.iki.fi/software/ion/).

### User Stories

1. **As a user**, I can navigate to `/agents` from the header to see all active agent sessions across all hosts.
2. **As a user**, I see sessions grouped by agent host in a sidebar, with online/offline status indicators.
3. **As a user**, I can click a session in the sidebar to open its terminal in the tiling area.
4. **As a user**, when I open multiple sessions, they tile automatically (ion-style) so I can monitor several agents at once.
5. **As a user**, I can minimize a terminal window to hide it while keeping the session alive, and re-open it later from the sidebar.
6. **As a user**, I can terminate a session from its window header, which kills the tmux session and removes the window.
7. **As a user**, I can drag dividers between tiled windows to resize them.

### Layout

```
┌──────────────┬──────────────────────────────────────────────┐
│ Agent List   │  Tiled Terminal Windows                      │
│              │ ┌─────────────────┬────────────────────────┐ │
│ ● mac-mini-1 │ │ lead-109       │ lead-112              │ │
│   lead-109   │ │ (mac-mini-1)   │ (mac-mini-2)          │ │
│ ◉ lead-112 ← │ │                │                        │ │
│              │ │ $ claude ...   │ ◉ Waiting for input    │ │
│ ● mac-mini-2 │ │                │                        │ │
│   lead-112   │ │ [minimize] [×] │ [minimize] [×]         │ │
│              │ └─────────────────┴────────────────────────┘ │
│              │ ┌──────────────────────────────────────────┐ │
│              │ │ review-88                                │ │
│              │ │ (mac-mini-1)                             │ │
│              │ │                                          │ │
│              │ │ [minimize] [×]                           │ │
│              │ └──────────────────────────────────────────┘ │
└──────────────┴──────────────────────────────────────────────┘
```

### Left Sidebar — Agent/Session List

- Groups sessions under their agent host
- Shows agent status (online/offline dot)
- **Highlights sessions waiting for input** (e.g., filled dot ◉ + visual indicator) — detected by monitoring terminal output for prompt patterns
- Clicking a session adds its terminal to the tiling area (or focuses it if already visible)
- Sessions not shown in the tiling area are listed but dimmed

### Tiling Area

- Windows tile automatically: first window fills the space, second splits horizontally, subsequent windows split the largest pane (ion-style)
- Each window has:
  - **Header**: session name, agent host, ticket link (if named `lead-N`)
  - **Minimize button**: Removes from tiling area but keeps session alive. Session stays in the sidebar list
  - **Terminate button**: Destroys the session (calls `DELETE /api/v1/agents/:name/sessions/:id`), removes from tiling area
- Windows can be resized by dragging dividers
- Clicking a session in the sidebar that's already tiled focuses/highlights it

### Route

`/agents` — new top-level page with nav link in the header.

### Components

| Component | Purpose |
|-----------|---------|
| `AgentManager.tsx` | Top-level page with sidebar + tiling area |
| `SessionList.tsx` | Left sidebar session/agent list |
| `TilingLayout.tsx` | Tiling window manager logic (split calculation, resize) |
| `TerminalWindow.tsx` | Individual tiled terminal with header and controls |

### Acceptance Criteria

- [ ] `/agents` route renders the agent manager page
- [ ] Left sidebar lists all agents and their sessions, grouped by host
- [ ] Clicking a session adds its terminal to the tiling area
- [ ] Tiling layout automatically splits space (ion-style)
- [ ] Minimize removes terminal from view but keeps session alive
- [ ] Terminate kills the session and removes the window
- [ ] Sessions waiting for input are visually highlighted in the sidebar (placeholder until Phase 6 backend detection)
- [ ] Dividers between tiled windows are draggable
- [ ] Header navigation includes a link to the agent manager
- [ ] E2E tests cover: navigating to agent manager, opening sessions in tiling area, minimize/terminate actions, and sidebar session list

---

## Phase 6: Input Detection and Notifications

Detect when agent sessions are waiting for user input and surface this across the UI via the agent manager sidebar and a global notification system.

### User Stories

1. **As a user**, I see a notification badge in the header when any agent session is waiting for my input, so I don't miss prompts while working on other pages.
2. **As a user**, I can click the notification badge to see a dropdown listing which sessions need attention, with links to the relevant ticket Agent tab or agent manager.
3. **As a user**, sessions waiting for input are highlighted in the agent manager sidebar so I can quickly spot them.
4. **As a user**, notifications auto-clear when the session resumes output, so I'm not distracted by stale alerts.

### Backend — agentd Input Detection

agentd monitors active tmux sessions for idle prompts:

- Periodically runs `tmux capture-pane -t <session> -p` to read current pane content
- Tracks last output timestamp per session
- When no new output for N seconds and the last non-empty line matches a prompt pattern (e.g., ends with `? `, `> `, `(y/n)`, `$`), sets `waiting_for_input: true` on the session
- Exposes new fields on session responses: `waiting_for_input: bool`, `idle_since: timestamp`

### Backend — agent-hub API

- Session responses from the hub REST API include `waiting_for_input` and `idle_since` (passed through from agentd)
- New endpoint: `GET /api/v1/sessions?waiting_for_input=true` — returns all sessions across agents that are waiting, for efficient polling

### Frontend — Agent Manager Integration

- Phase 5's sidebar highlights sessions waiting for input (filled dot, color change, or animation)
- Replaces the client-side idle heuristic from Phase 5 with the authoritative backend signal

### Frontend — Global Notification System

- **Notification badge** in the app header (visible on all pages): shows count of sessions waiting for input
- **Notification dropdown**: lists waiting sessions with session name, agent host, and idle duration
- Each notification links to:
  - `/ticket/:id` Agent tab (if session name matches `lead-{number}` convention)
  - `/agents` with the session focused (otherwise)
- Notifications auto-dismiss when the session is no longer waiting (output resumes)

### Components

| Component | Purpose |
|-----------|---------|
| `NotificationBadge.tsx` | Header badge with waiting session count |
| `NotificationDropdown.tsx` | Dropdown listing sessions waiting for input |

### Files to Modify (Backend)

| File | Change |
|------|--------|
| `services/agents/internal/session/manager.go` | Add pane monitoring and idle detection |
| `services/agents/internal/hub/client.go` | Include `waiting_for_input` in session responses |
| `services/agent-hub/internal/hub/messages.go` | Add fields to session response types |
| `services/agent-hub/internal/rest/handlers.go` | Add `GET /api/v1/sessions` endpoint |

### Acceptance Criteria

- [ ] agentd detects idle sessions with prompt-like last output
- [ ] Session responses include `waiting_for_input` and `idle_since` fields
- [ ] Hub exposes filtered sessions endpoint for efficient polling
- [ ] Agent manager sidebar highlights waiting sessions using backend signal
- [ ] Notification badge in header shows count of waiting sessions
- [ ] Notification dropdown lists waiting sessions with links
- [ ] Clicking a notification navigates to the correct ticket Agent tab or agent manager
- [ ] Notifications auto-clear when session output resumes
- [ ] E2E tests cover: notification badge appears when a session is waiting, dropdown lists waiting sessions with correct links, badge clears when session resumes, and agent manager sidebar highlights waiting sessions

---

## Future Considerations

- **Persistent session-ticket links**: Store the association in the data model (issues-api metadata or agent-hub session tags) instead of relying on naming conventions
- **Real-time status via WebSocket**: Replace polling with push for agent/session updates
- **Session logs**: Capture scrollback for completed sessions
- **Multi-agent orchestration**: Launch coordinated sessions from the UI

---

## Files to Create

| File | Phase | Purpose |
|------|-------|---------|
| `src/api/agentHubClient.ts` | 2 | REST client for agent-hub API |
| `src/types/agents.ts` | 2 | TypeScript types for agents and sessions |
| `src/hooks/useAgents.ts` | 2 | Agent list polling hook with profile filtering |
| `src/components/LaunchAgentDialog.tsx` | 3 | Modal dialog for launching agent from ticket card |
| `src/components/AgentLauncher.tsx` | 3 | Shared agent/profile selection control |
| `src/components/AgentTab.tsx` | 4 | Agent tab content (launcher or terminal) |
| `src/components/Terminal.tsx` | 4 | xterm.js terminal wrapper |
| `src/components/AgentManager.tsx` | 5 | Agent manager page with sidebar + tiling area |
| `src/components/SessionList.tsx` | 5 | Left sidebar session/agent list |
| `src/components/TilingLayout.tsx` | 5 | Tiling window manager (split calculation, resize) |
| `src/components/TerminalWindow.tsx` | 5 | Individual tiled terminal with header and controls |
| `src/components/NotificationBadge.tsx` | 6 | Header badge with waiting session count |
| `src/components/NotificationDropdown.tsx` | 6 | Dropdown listing sessions waiting for input |
| `src/styles/agents.module.css` | 2-6 | Styles for agent components |

## Files to Modify

| File | Phase | Change |
|------|-------|--------|
| `services/agent-hub/internal/hub/messages.go` | 1 | Add `Repo` to `ProfileInfo` |
| `services/agents/internal/hub/client.go` | 1 | Send `Repo` in registration + local type |
| `services/issues-ui/vite.config.ts` | 2 | Add `/api/v1` proxy rule |
| `services/issues-ui/src/api/queries.ts` | 2 | Add `repository` to ticket detail project query |
| `services/issues-ui/src/components/TicketCard.tsx` | 3 | Add launch button |
| `services/issues-ui/src/components/TicketDetail.tsx` | 4 | Add tab navigation (Details / Agent) |
| `services/issues-ui/src/styles/detail.module.css` | 4 | Tab and terminal layout styles |
| `services/issues-ui/src/App.tsx` | 5 | Add `/agents` route and header nav link |
| `services/issues-ui/src/App.tsx` | 6 | Add NotificationBadge to header |
| `services/issues-ui/package.json` | 4 | Add xterm.js dependencies |
| `services/agents/internal/session/manager.go` | 6 | Add pane monitoring and idle detection |
| `services/agent-hub/internal/rest/handlers.go` | 6 | Add filtered sessions endpoint |
