# Techspec: Inline Prompt Answering in Notification Dropdown

**Ticket**: #422
**Status**: Research / Pre-implementation

---

## Problem

When a Claude session is waiting for user input, the notification dropdown shows the session name with a link to the terminal. The user must leave their current view, open the terminal, read the prompt, and type an answer. For simple y/n or single-select questions this round-trip is friction — especially when multiple sessions are waiting.

---

## Solution

Surface the prompt text and answer controls directly inside the notification dropdown item. Each waiting session item becomes an interactive card showing:
- Project badge + ticket title (from the issues API)
- The last visible lines from the terminal buffer (the actual question)
- Context-appropriate controls: Yes/No buttons, option buttons, or a text input

Answers are submitted via a new REST endpoint that writes directly to the PTY stdin.

---

## Approach: PTY-Level (vs. Claude Code Hooks)

Two approaches were considered:

**Option A — Claude Code Channels / Elicitation hooks**: Configure `PreToolUse` hooks on `AskUserQuestion` to intercept structured question data and route it to a central server. More structured data, but requires hooks config in every Claude session and is tied to Claude Code's specific prompt APIs.

**Option B — Extend existing PTY monitoring** *(chosen)*: The `waitingForInput` detection already reads PTY buffers and classifies prompts via regex. Extend this to capture the visible lines around the prompt and classify the prompt type. No Claude Code config changes required; works for any prompt (shell, git, npm, Claude Code).

---

## Data Model Changes

### Session struct (`services/agents/internal/session/store.go`)

```go
type Session struct {
    // ... existing fields ...
    WaitingForInput bool
    IdleSince       *time.Time
    PromptContext   string  // NEW: ANSI-stripped visible lines around the prompt
    PromptType      string  // NEW: "yesno" | "select" | "text" | "shell"
}
```

`PromptContext` and `PromptType` are set when transitioning to `waitingForInput=true` and cleared when transitioning back to false.

### Proto (`services/agent-hub/proto/hub/v1/hub.proto`)

```proto
message Session {
  // ... existing fields through 14 ...
  optional string prompt_context = 15;
  optional string prompt_type = 16;
}
```

Field numbers 15 and 16 are unused (field 8 is reserved for the removed `tmux_session`).

---

## Prompt Extraction

### ANSI Stripping

PTY buffers contain raw terminal escape sequences. Before storing `PromptContext`, strip ANSI codes:

```go
var ansiEscape = regexp.MustCompile(
    `\x1b(?:\[[0-9;]*[A-Za-z]|[()][0-9A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))`,
)

func stripANSI(s string) string {
    return ansiEscape.ReplaceAllString(s, "")
}
```

This covers:
- CSI sequences (`ESC[...m`, `ESC[...J`, cursor movement, etc.)
- Character set designators (`ESC(` / `ESC)`)
- OSC sequences (`ESC]...BEL` and `ESC]...ST`) — window titles, hyperlinks, etc.

### Context Window

Take the last 15 non-empty lines of the stripped content. This captures the question and option list without including stale session history.

```go
func lastNLines(s string, n int) string {
    lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
    var nonEmpty []string
    for _, l := range lines {
        if strings.TrimSpace(l) != "" {
            nonEmpty = append(nonEmpty, l)
        }
    }
    if len(nonEmpty) > n {
        nonEmpty = nonEmpty[len(nonEmpty)-n:]
    }
    return strings.Join(nonEmpty, "\n")
}
```

### Prompt Type Classification

Applied to the extracted context window, checked in priority order:

| Type | Detection | Example |
|------|-----------|---------|
| `yesno` | Any line matches `(?i)[\[(][yn]\/[yn][\])]` and `yes/no` variants with round or square brackets | `? Continue? (y/N)`, `Proceed? [Y/n]` |
| `select` | Any line contains `❯` | `❯ React` |
| `text` | Last line matches `\?\s*$` or `>\s*$` | `? Enter a value:` |
| `shell` | Last line matches `[$#]\s*$` | `$` |

If no pattern matches, `PromptType` is left empty and the UI falls back to a text input.

---

## New API: Send PTY Input

### agentd — PTY write

```go
// services/agents/internal/pty/manager.go
func (m *PTYManager) WriteInput(id string, data []byte) error {
    sess, err := m.Get(id)
    if err != nil {
        return err
    }
    _, err = sess.master.Write(data)
    return err
}
```

### agentd — RPC handler

```go
// services/agents/internal/hub/dispatch.go
type sendInputParams struct {
    SessionID string `json:"session_id"`
    Text      string `json:"text"`
}

func (d *Dispatcher) SendInput(params json.RawMessage) (json.RawMessage, *rpcError) {
    var p sendInputParams
    if err := json.Unmarshal(params, &p); err != nil {
        return nil, &rpcError{Code: rpcErrInvalidArgument, Message: "invalid params: " + err.Error()}
    }
    if err := d.pty.WriteInput(p.SessionID, []byte(p.Text)); err != nil {
        return nil, mapPTYError(err)
    }
    return marshalResult(map[string]bool{"ok": true})
}
```

Wire into the dispatch table alongside `createSession`, `destroySession`, etc.

### agent-hub — REST endpoint

```
POST /api/v1/agents/{name}/sessions/{id}/input
Content-Type: application/json

{ "text": "y\n" }
```

Response: `200 OK` with `{ "ok": true }`, or standard error JSON.

Handler in `services/agent-hub/internal/rest/handlers.go` follows the same pattern as `handleDestroySession`: resolve agent, forward RPC, map errors to HTTP status.

Route registered in `services/agent-hub/internal/rest/server.go` in the `apiMux` block.

---

## Input Semantics by Prompt Type

| Type | UI Controls | Data sent to PTY |
|------|-------------|-----------------|
| `yesno` | "Yes" / "No" buttons | `y\n` / `n\n` |
| `select` | One button per option | Arrow keys + `\r` (see below) |
| `text` | Text input + Send | `<user input>\n` |
| `shell` | Text input + Send | `<user input>\n` |
| (empty) | Text input + Send | `<user input>\n` |

### Select prompt navigation

Claude Code's `AskUserQuestion` and similar tools use `@inquirer/prompts` which renders an interactive list requiring arrow-key navigation. Direct text input is not accepted for list selections.

The UI computes the delta between the current selection (indicated by `❯`) and the target option, then sends the appropriate ANSI arrow key sequences:

```
Up:   \x1b[A
Down: \x1b[B
```

Example: current=0, target=2 → send `\x1b[B\x1b[B\r`

The frontend parses options from `promptContext`:

```ts
function parseSelectPrompt(context: string): { question: string; options: string[]; currentIndex: number } {
  const lines = context.split('\n').filter(l => l.trim());
  const questionIdx = lines.findIndex(l => l.trimStart().startsWith('?'));
  const optionLines = lines.slice(questionIdx + 1);
  const options = optionLines.map(l => l.replace(/^[\s❯]+/, '').trim()).filter(Boolean);
  const currentIndex = optionLines.findIndex(l => l.includes('❯'));
  const question = questionIdx >= 0 ? lines[questionIdx].replace(/^\?+\s*/, '') : '';
  return { question, options, currentIndex: Math.max(0, currentIndex) };
}
```

---

## Frontend Component Structure

### `NotificationItem` sub-component

Extracted from `NotificationDropdown` so each item can independently call `useTicketByNumber` (hooks cannot be called in a loop).

```
NotificationDropdown
  ↳ NotificationItem (per session)
      ↳ useTicketByNumber(projectId, ticketNumber)
      ↳ Header: [project badge] [ticket title or session name] [agent] [idle time]
      ↳ PromptText: pre-formatted lines from promptContext
      ↳ Controls: <YesNo | SelectOptions | TextInput>
```

### Ticket number parsing

```ts
function parseTicketNumber(sessionName: string): number | null {
  const match = sessionName.match(/^lead-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
```

Sessions that don't match (e.g., `refine-all-*`) show the session name in the header without a ticket API fetch.

### Props flow

`App.tsx` passes `effectiveProjectId` and `selectedProject?.name` to `NotificationDropdown`, which passes both to each `NotificationItem`.

```tsx
// App.tsx
<NotificationDropdown
  waitingSessions={waitingSessions}
  projectId={effectiveProjectId}
  projectName={selectedProject?.name ?? null}
/>
```

### Answer submission

After sending input, the item shows a brief "Sent" disabled state (~1 second) to prevent double-submission and give visual feedback before the session transitions out of `waitingForInput`.

Controls use `e.stopPropagation()` to prevent the surrounding `<Link>` from navigating when a button is clicked.

---

## CSS additions (`layout.module.css`)

| Class | Purpose |
|-------|---------|
| `.notificationItemBody` | Inner content area below the header row |
| `.notificationProjectBadge` | Small muted project name chip |
| `.notificationTicketTitle` | Ticket title, truncated with ellipsis |
| `.notificationPromptText` | Monospace, muted, max 5 lines, overflow hidden |
| `.notificationControlsRow` | Flex row for answer buttons |
| `.notificationControlBtn` | Base style for answer buttons |
| `.notificationControlBtnPrimary` | Amber accent for affirmative actions (Yes) |
| `.notificationInputRow` | Flex row for text input + send button |
| `.notificationTextInput` | Flex-grow text input, surface-styled |

The dropdown width will need to grow from `min-width: 260px` to accommodate the expanded items (suggest `min-width: 320px`).

---

## Resolved Questions

1. **inquirer select — arrow key reliability** ✅ CONFIRMED: Tested by writing `\x1b[B` directly to a PTY master running `@inquirer/select`. The selection moved from React → Vue and `\r` confirmed the selection. Arrow key sequences work identically whether sent by a human via terminal WebSocket or written programmatically to the PTY master.

2. **y/n prompt detection breadth** ✅ RESOLVED: Session JSONL audit found `[Y/n]` square-bracket variant in use in cadence lead workflow scripts. Updated regex to include square-bracket forms — see prompt type classification section. Pattern: `(?i)[\[(]y[/|]n[\])]|[\[(]Y[/|]n[\])]|[\[(]yes[/|]no[\])]|[\[(]N[/|]y[\])]|[\[(]y[/|]N[\])]`.

3. **Race condition on answer** ✅ ACCEPTED: This is a single-user application; concurrent input from terminal and notification popup is not a realistic scenario. `WriteInput` writes bytes to PTY master unconditionally — worst case stray characters appear at the next prompt, which is acceptable.

4. **Multi-agent deployments** ✅ CONFIRMED: The frontend `AgentSession` already carries `agentName`, which is used to route the `sendInput` RPC to the correct agentd instance via agent-hub. No gaps.

5. **ANSI stripping completeness** ✅ RESOLVED: Regex extended to cover OSC sequences (window titles, hyperlinks) in addition to CSI and character set designators — see ANSI stripping section.

---

## Testing Requirements

Per `services/issues-ui/CLAUDE.md`, all new features require interaction-level tests before merge.

### Unit tests (`NotificationDropdown.test.tsx`)

- Renders y/n buttons when `promptType = "yesno"`
- Clicking "Yes" calls `sendSessionInput` with `"y\n"`
- Clicking "No" calls `sendSessionInput` with `"n\n"`
- Renders option buttons when `promptType = "select"` with parsed options from `promptContext`
- Clicking an option calls `sendSessionInput` with correct arrow-key sequence
- Renders text input + Send when `promptType = "text"`
- Submit sends input text + `"\n"`
- Controls use `stopPropagation` — link navigation not triggered on button click
- Shows project badge and ticket title when `useTicketByNumber` resolves
- Shows session name when ticket number not parseable from session name
- Shows "Sent" disabled state briefly after submission

### Go tests

- `monitor_test.go`: `stripANSI` helper, `lastNLines` helper, prompt type classification
- `pty/manager_test.go`: `WriteInput` writes bytes to PTY master
- `hub/dispatch_test.go`: `sendInput` RPC handler
- `rest/handlers_test.go`: `handleSendInput` REST handler

---

## Implementation Order

1. agentd: `store.go` → `monitor.go` → `pty/manager.go` → `dispatch.go` (Go tests alongside)
2. agent-hub: `handlers.go` → `server.go` (Go tests alongside)
3. Proto: update `.proto` → run `buf generate`
4. Frontend: `agentHubClient.ts` → `App.tsx` → `NotificationDropdown.tsx` + CSS → tests
