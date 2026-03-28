# Plan: Inline Prompt Answering in Notification Dropdown

## Context

The notification dropdown currently shows sessions waiting for input, but the only action is clicking to navigate to the terminal. This requires leaving the current view, opening the full terminal, and reading/answering the prompt manually.

The goal is to surface the actual prompt text and provide inline answer controls — y/n buttons, option buttons for select prompts, and a text input for open-ended questions — directly inside each notification dropdown item. The item header will show the associated ticket title fetched from the issues API.

---

## Architecture Overview

Three things need to happen end-to-end:

1. **Capture prompt context on the backend** — when the session monitor marks `waitingForInput=true`, extract the visible terminal lines and classify the prompt type (yesno / select / text / shell).
2. **Write to PTY stdin via API** — add a `sendInput` RPC on agentd and a `POST /api/v1/agents/{name}/sessions/{id}/input` REST endpoint on agent-hub so the UI can answer without a WebSocket terminal connection.
3. **Rework the notification item UI** — show ticket title (from issues API), prompt context, and controls that send the right keystrokes.

---

## Backend Changes — agentd

### `services/agents/internal/session/store.go`
Add two fields to `Session`:
```go
PromptContext string  // ANSI-stripped visible lines around the prompt
PromptType    string  // "yesno" | "select" | "text" | "shell"
```
These are cleared when `waitingForInput` is cleared.

### `services/agents/internal/session/monitor.go`
When transitioning to `waitingForInput=true`, after the idle threshold check:
1. Strip ANSI escape codes from `content` — add a small `stripANSI(s string) string` helper using a regex (`\x1b\[[0-9;]*[A-Za-z]` and `\x1b[()][0-9A-Za-z]`).
2. Extract the last ~15 non-empty visible lines.
3. Classify prompt type by inspecting those lines:
   - `"yesno"` — any line matches `\(y/n\)|\(Y/n\)|\(yes/no\)|\(N/y\)|\(y/N\)` (case-insensitive)
   - `"select"` — any line contains `❯`
   - `"text"` — last line matches `\?\s*$` or `>\s*$`
   - `"shell"` — last line matches `[$#]\s*$`
4. Store as `PromptContext` (joined lines) and `PromptType` in the session via `store.Update`.
5. Clear both fields when transitioning `waitingForInput` to false.

### `services/agents/internal/pty/manager.go`
Add:
```go
func (m *PTYManager) WriteInput(id string, data []byte) error
```
Looks up the session's `sess.master` and writes `data` to it. Returns error if session not found or write fails.

### `services/agents/internal/hub/dispatch.go`
**New RPC handler `SendInput`**:
- Params: `{ session_id string, text string }`
- Calls `pty.WriteInput(sessionID, []byte(text))`
- Returns `{ ok: true }` or error

**sessionInfo struct** — add fields:
```go
PromptContext string `json:"prompt_context,omitempty"`
PromptType    string `json:"prompt_type,omitempty"`
```
Populate in `toSessionInfo()`.

Wire `sendInput` into the method dispatch table (same pattern as `createSession`, `destroySession`, etc.).

---

## Backend Changes — agent-hub

### `services/agent-hub/internal/rest/server.go`
Add route:
```
POST /api/v1/agents/{name}/sessions/{id}/input
```
In the `apiMux` block, alongside the existing session routes.

### `services/agent-hub/internal/rest/handlers.go`
Add `handleSendInput(h *hub.Hub) http.HandlerFunc`:
- Read JSON body `{ text string }` (cap at `hub.RPCMaxMessageSize`)
- Resolve agent by `{name}`, verify online
- Forward `sendInput` RPC: `{ session_id, text }`
- Return `200 OK` with `{ ok: true }` or appropriate error

---

## Proto + Codegen

### `services/agent-hub/proto/hub/v1/hub.proto`
Add to `Session` message:
```proto
optional string prompt_context = 15;
optional string prompt_type = 16;
```

### Regenerate TypeScript types
From `services/issues-ui/`:
```
buf generate
```
This updates `src/gen/hub/v1/hub_pb.ts` with the new fields.

---

## Frontend Changes

### `services/issues-ui/src/api/agentHubClient.ts`
Add:
```ts
export async function sendSessionInput(
  agentName: string,
  sessionId: string,
  text: string
): Promise<void>
```
`POST /api/v1/agents/{agentName}/sessions/{sessionId}/input` with `{ text }`.

### `services/issues-ui/src/App.tsx`
Pass `effectiveProjectId` and `selectedProject` to `NotificationDropdown`:
```tsx
<NotificationDropdown
  waitingSessions={waitingSessions}
  projectId={effectiveProjectId}
  projectName={selectedProject?.name ?? null}
/>
```

### `services/issues-ui/src/components/NotificationDropdown.tsx`
**Structural change**: extract a `NotificationItem` sub-component per session (needed so `useTicketByNumber` can be called per item without violating hook rules).

**`NotificationDropdownProps`** — add `projectId: string | null` and `projectName: string | null`.

**`NotificationItem` props**: `{ ws: AgentSession; projectId: string | null; projectName: string | null; onClose(): void }`

Inside `NotificationItem`:
1. Parse ticket number: `/^lead-(\d+)/` on `ws.session.name` → call `useTicketByNumber(projectId ?? undefined, ticketNumber)` conditionally.
2. Show header row:
   - Project name badge (small muted chip, e.g. `claude-cadence`) — always shown when `projectName` is set
   - Ticket title if loaded (e.g. `#42 Add sound effects`), otherwise the session name
   - Agent name + idle time right-aligned
3. Show `promptContext` lines (plain text, fixed-width, truncated to ~5 lines).
4. Render answer controls based on `promptType`:
   - **`yesno`**: "Yes" button → `sendSessionInput(agentName, id, "y\n")` and "No" → `"n\n"`
   - **`select`**: Parse option lines from `promptContext` (lines containing `❯` mark current; adjacent indented lines are other options). Render each option as a button. On click, compute arrow-key sequence from current index to target index, append `\r`, call `sendSessionInput`.
     - Arrow keys: Up = `\x1b[A`, Down = `\x1b[B`
   - **`text`** / **`shell`** / fallback: Text input + "Send" button → `sendSessionInput(agentName, id, input + "\n")`
5. Controls use `e.stopPropagation()` so clicks don't follow the surrounding `<Link>`.
6. After sending, briefly show a "Sent" state (disable controls for ~1s, then re-enable).

### `services/issues-ui/src/styles/layout.module.css`
Add styles:
- `.notificationItemBody` — padding, border-top inside item, bg slightly different
- `.notificationProjectBadge` — small muted chip/tag for the project name (var(--text-muted), border, rounded, tiny font)
- `.notificationTicketTitle` — bold, truncated with ellipsis, small font
- `.notificationPromptText` — monospace, muted text, font-size 0.72rem, max 5 lines, overflow hidden
- `.notificationControlsRow` — flex row, gap, flex-wrap, margin-top 0.4rem
- `.notificationControlBtn` — small button, var(--surface-alt), border, rounded, hover state
- `.notificationControlBtnPrimary` — amber accent for Yes / affirmative option
- `.notificationInputRow` — flex row, gap for text input + send button
- `.notificationTextInput` — flex-grow input, small, matches surface styling

### `services/issues-ui/src/components/NotificationDropdown.test.tsx`
Interaction-level tests (Vitest + `@testing-library/react`):
- Renders y/n buttons when `promptType = "yesno"`; clicking "Yes" calls `sendSessionInput` with `"y\n"`
- Renders option buttons when `promptType = "select"` with parsed options
- Renders text input + Send button when `promptType = "text"`
- `e.stopPropagation()` prevents navigation (verify mock navigate not called on button click)
- Shows ticket title when `useTicketByNumber` resolves

Mock `sendSessionInput` and `useTicketByNumber` in tests.

---

## Prompt Parsing Details (select type)

Terminal buffer after ANSI stripping for a select prompt looks like:
```
? Which framework? (Use arrow keys)
❯ React
  Vue
  Svelte
```

Parsing algorithm in the frontend (`NotificationDropdown.tsx`):
1. Split `promptContext` by `\n`
2. Find question line: first line starting with `?`
3. Collect option lines: subsequent lines that are non-empty (trim `❯` and whitespace to get label)
4. `currentIndex` = index of line containing `❯`
5. On button click for `targetIndex`:
   - delta = targetIndex - currentIndex
   - arrows = delta > 0 ? `\x1b[B`.repeat(delta) : `\x1b[A`.repeat(-delta)
   - send `arrows + "\r"`

---

## Critical Files

| File | Change |
|------|--------|
| `services/agents/internal/session/store.go` | Add `PromptContext`, `PromptType` fields |
| `services/agents/internal/session/monitor.go` | ANSI strip + prompt classification on wait |
| `services/agents/internal/pty/manager.go` | Add `WriteInput` method |
| `services/agents/internal/hub/dispatch.go` | Add `sendInput` RPC + new sessionInfo fields |
| `services/agent-hub/internal/rest/server.go` | Add input route |
| `services/agent-hub/internal/rest/handlers.go` | Add `handleSendInput` handler |
| `services/agent-hub/proto/hub/v1/hub.proto` | Add `prompt_context`, `prompt_type` fields |
| `services/issues-ui/src/gen/hub/v1/hub_pb.ts` | Regenerated (run `buf generate`) |
| `services/issues-ui/src/api/agentHubClient.ts` | Add `sendSessionInput` |
| `services/issues-ui/src/App.tsx` | Pass `effectiveProjectId` to `NotificationDropdown` |
| `services/issues-ui/src/components/NotificationDropdown.tsx` | Full rework with `NotificationItem` |
| `services/issues-ui/src/styles/layout.module.css` | New notification item styles |
| `services/issues-ui/src/components/NotificationDropdown.test.tsx` | New test file |

---

## Verification

1. **Unit tests**: `npm run test` in `services/issues-ui/` — new `NotificationDropdown.test.tsx` must pass
2. **Go tests**: `go test ./...` in `services/agents/` and `services/agent-hub/`
3. **End-to-end manual test**:
   - Start a `lead-N` session and wait for it to hit a y/n prompt
   - Open the notification badge — item should show ticket title, prompt text, Yes/No buttons
   - Click "Yes" — verify the terminal session receives `y\n` and proceeds
   - Verify select prompts show option buttons and clicking navigates + selects correctly
4. **Shellcheck**: `shellcheck commands/**/*.sh skills/**/*.sh` (no shell changes expected)
