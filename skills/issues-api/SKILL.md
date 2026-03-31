---
name: issues-api
description: CLI commands for the issues microservice backend. Use when the project's ticket provider is configured as issues-api.
user-invokable: false
---

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

## Overview

This skill documents two paths for interacting with the issues microservice:

1. **MCP tools** (`mcp__issues__*`) — preferred when available. No shell escaping, no CLI install required, structured input/output.
2. **`issues` CLI** — fallback when MCP tools are not available.

**Always prefer MCP tools when `mcp__issues__*` tools appear in your available tool list.** Fall back to the CLI only when they are absent.

Provider detection still applies: use this skill only when the project's `CLAUDE.md` configures `provider: issues-api`.

---

## State Machine

Valid transitions:
- `BACKLOG` → `REFINED`, `CLOSED`
- `REFINED` → `IN_PROGRESS`, `BACKLOG`, `CLOSED`
- `IN_PROGRESS` → `CLOSED`, `REFINED`
- `CLOSED` → `BACKLOG`

Blocked tickets cannot transition to `IN_PROGRESS`.

```
           ┌────────────────────────┐
           ↓                        │
BACKLOG ──→ REFINED ──→ IN_PROGRESS │
  ↑  │       │  ↑           │       │
  │  │       │  └───────────┘       │
  │  └───────┴──────────────────→ CLOSED
  │                                 │
  └─────────────────────────────────┘
                (reopen)
```

> **IMPORTANT:** Always check the ticket's current state before transitioning. Transitioning to the current state or skipping states is an error (e.g., `BACKLOG` → `IN_PROGRESS` is invalid — must go through `REFINED`).

---

## MCP Tools (preferred)

Use these tools when `mcp__issues__*` tools are available. They are faster, require no shell escaping, and work without the CLI installed.

### Ticket Operations

#### Get a ticket

```
mcp__issues__ticket_get
  id: "<TICKET_CUID>"           # Use id OR number, not both
  number: 42                    # Ticket number (integer)
  projectId: "<PROJECT_CUID>"   # Optional with number: falls back to projectName or ISSUES_PROJECT_ID env var; ignored when id is used
  projectName: "claude-cadence" # Optional with number: resolved to CUID if projectId not provided; ignored when id is used
```

#### List tickets

```
mcp__issues__ticket_list
  projectId: "<PROJECT_CUID>"         # Falls back to ISSUES_PROJECT_ID env var
  projectName: "claude-cadence"       # Alternative to projectId
  state: "REFINED"                    # BACKLOG | REFINED | IN_PROGRESS | CLOSED
  labelNames: ["bug", "enhancement"]  # OR filter: matches either label
  isBlocked: true                     # Filter to only blocked tickets
  priority: "HIGH"                    # HIGHEST | HIGH | MEDIUM | LOW | LOWEST
  limit: 50                           # Default: 20, max: 100
```

#### Create a ticket

```
mcp__issues__ticket_create
  title: "Brief descriptive title"   # Required
  projectId: "<PROJECT_CUID>"        # Falls back to ISSUES_PROJECT_ID env var
  projectName: "claude-cadence"      # Alternative to projectId
  description: "Detailed description"
  acceptanceCriteria: "- [ ] Criterion 1\n- [ ] Criterion 2"
  labelIds: ["<LABEL_CUID_1>"]       # Use mcp__issues__label_list to resolve names → IDs
  priority: "MEDIUM"                 # HIGHEST | HIGH | MEDIUM | LOW | LOWEST
  storyPoints: 3                     # Fibonacci: 1, 2, 3, 5, 8, 13
```

#### Update a ticket

```
mcp__issues__ticket_update
  id: "<TICKET_CUID>"          # Required
  title: "New title"
  description: "New description"
  acceptanceCriteria: "- [ ] Updated criterion"
  priority: "HIGH"
  storyPoints: 5
```

#### Transition a ticket (state changes)

```
mcp__issues__ticket_transition
  id: "<TICKET_CUID>"   # Required
  to: "IN_PROGRESS"     # BACKLOG | REFINED | IN_PROGRESS | CLOSED
```

See [State Machine](#state-machine) above for valid transitions, the state diagram, and the blocked-ticket constraint.

**Common multi-step transitions:**

```
# Start work on a BACKLOG ticket (must pass through REFINED):
mcp__issues__ticket_transition  id: "<ID>"  to: "REFINED"
mcp__issues__ticket_transition  id: "<ID>"  to: "IN_PROGRESS"

# Reopen a CLOSED ticket and start work:
mcp__issues__ticket_transition  id: "<ID>"  to: "BACKLOG"
mcp__issues__ticket_transition  id: "<ID>"  to: "REFINED"
mcp__issues__ticket_transition  id: "<ID>"  to: "IN_PROGRESS"
```

### Label Operations

#### List all labels

```
mcp__issues__label_list
  (no parameters)
```

Use this to resolve label names to CUIDs before calling `ticket_create` or `label_add`.

#### Add a label to a ticket

```
mcp__issues__label_add
  ticketId: "<TICKET_CUID>"   # Required
  labelId: "<LABEL_CUID>"     # Required; use mcp__issues__label_list to resolve name → ID
```

#### Remove a label from a ticket

```
mcp__issues__label_remove
  ticketId: "<TICKET_CUID>"   # Required
  labelId: "<LABEL_CUID>"     # Required
```

### Assignment Operations

#### Assign a ticket

```
mcp__issues__ticket_assign
  ticketId: "<TICKET_CUID>"   # Required
  userId: "<USER_ID>"          # Required
```

#### Unassign a ticket

```
mcp__issues__ticket_unassign
  ticketId: "<TICKET_CUID>"   # Required
```

### Comment Operations

#### Add a comment

```
mcp__issues__comment_add
  ticketId: "<TICKET_CUID>"   # Required
  body: "Comment text"         # Required; no shell escaping needed
```

---

## CLI Fallback

Use the `issues` CLI when `mcp__issues__*` tools are not available in your tool list.

### Prerequisites

- The issues microservice must be running at the configured `api_url`
- The CLI must be authenticated: `issues auth whoami`
- If not authenticated: `gh auth token | issues auth login --pat -`

### Project Name Resolution

All `--project` flags and project positional arguments accept either a project **name** (e.g., `claude-cadence`) or a **CUID** (e.g., `cmmryin270000ny01dc2msx3t`). The CLI resolves names to IDs automatically.

### Project Management

#### Create a project

```bash
issues project create --name "My Project" --repository "org/repo" --json
```

#### List projects

```bash
issues project list --json
```

#### View a project

```bash
issues project view PROJECT --json
```

#### Update a project

```bash
issues project update PROJECT --name "New Name" --json
issues project update PROJECT --repository "org/new-repo" --json
```

### Project Inference

The CLI can infer the project from the current directory's git remote origin URL. When `--project` is omitted, the CLI reads `git remote get-url origin`, normalizes it to an `owner/repo` slug, and matches it against known projects. Explicit `--project` always takes precedence.

### Ticket Management

**ID types:** Commands accept either a ticket number or a CUID. When using a ticket number, include `--project PROJECT` to resolve it (project name or ID; inferred from git origin if omitted). When using a CUID, `--project` is not needed.

#### Create a ticket

```bash
issues ticket create \
  --title "Brief descriptive title" \
  --project PROJECT \
  --description "$(cat <<'EOF'
Detailed description
EOF
)" \
  --acceptance-criteria "$(cat <<'EOF'
- [ ] Criterion 1
- [ ] Criterion 2
EOF
)" \
  --labels "bug,enhancement" \
  --assignee USER_ID \
  --points 5 \
  --priority MEDIUM \
  --json
```

`--body` is accepted as an alias for `--description` on both `create` and `update`.

Note: `--project` is optional if you're in a git repo whose origin matches a known project.

#### View a ticket

```bash
issues ticket view 42 --project PROJECT --json
```

Note: `--project` is optional when viewing by ticket number if you're in a matching git repo.

Shows: title, state, priority, story points, assignee, labels, description, acceptance criteria, blockers, comments.

#### List tickets

```bash
issues ticket list --json
issues ticket list --state REFINED --json
issues ticket list --label "bug" --json
issues ticket list --label "bug" --label "enhancement" --json  # OR filter: matches either label
issues ticket list --assignee "username" --json
issues ticket list --blocked --json
issues ticket list --priority HIGH --json
issues ticket list --project PROJECT --json
issues ticket list --limit 50 --json
issues ticket list --after "cursor_value" --json
issues ticket list --verbose              # includes description, acceptance criteria, and label IDs
issues ticket list -v --state REFINED     # verbose + filter
```

#### Update a ticket

```bash
issues ticket update TICKET_ID --title "New title" --json
issues ticket update TICKET_ID --description "$(cat <<'EOF'
New description
EOF
)" --json
issues ticket update TICKET_ID --acceptance-criteria "$(cat <<'EOF'
Updated criteria
EOF
)" --json
issues ticket update TICKET_ID --points 8 --json
issues ticket update TICKET_ID --priority HIGH --json
```

#### Transition a ticket (state changes)

```bash
issues ticket transition TICKET_ID --to REFINED --json
issues ticket transition TICKET_ID --to IN_PROGRESS --json
issues ticket transition TICKET_ID --to CLOSED --json
issues ticket transition TICKET_ID --to BACKLOG --json
```

See [State Machine](#state-machine) above for valid transitions, the state diagram, and the blocked-ticket constraint. Use `issues ticket view TICKET_ID --project PROJECT --json` to check the current state before transitioning.

**Common multi-step transitions:**

```bash
# Start work on a BACKLOG ticket (must pass through REFINED):
issues ticket transition TICKET_ID --to REFINED --json
issues ticket transition TICKET_ID --to IN_PROGRESS --json

# Reopen a CLOSED ticket and start work:
issues ticket transition TICKET_ID --to BACKLOG --json
issues ticket transition TICKET_ID --to REFINED --json
issues ticket transition TICKET_ID --to IN_PROGRESS --json
```

### Labels

> **Labels are global** — they are not scoped to a project. `issues label list` takes no `--project` flag. Label IDs are the same across all projects.

#### List labels

```bash
issues label list --json
```

#### Create a label

```bash
issues label create --name "bug" --color "#d73a4a" --json
```

#### Add a label to a ticket

```bash
issues label add TICKET_ID --label bug --json
```

#### Remove a label from a ticket

```bash
issues label remove TICKET_ID --label bug --json
```

#### Delete a label

```bash
issues label delete LABEL_NAME_OR_ID --json
```

Deletes a label entirely. If the label is attached to any tickets, it is automatically removed from them.

### Comments

#### Shell Safety: Heredocs for Body Content, Variables for Titles

**IMPORTANT:** Backticks inside double-quoted strings are evaluated as shell command substitution. Two argument types need special handling:

**Body content** (`--body`, `--description`, `--acceptance-criteria`): always use `<<'EOF'` single-quoted heredocs. Single-quoted `<<'EOF'` prevents all variable expansion and command substitution inside the heredoc.

```bash
issues comment add TICKET_ID --body "$(cat <<'EOF'
Comment text with `backticks` safe here.
EOF
)" --json
```

**Titles** (`--title`): cannot use heredocs inline. If the title contains backticks, assign to a variable first:

```bash
TICKET_TITLE=$(cat <<'EOF'
Fix `createSession` return type
EOF
)
issues ticket create --title "$TICKET_TITLE" ...
```

When possible, write titles without backticks (e.g., "Fix createSession return type") — titles are plain text labels and backtick formatting rarely adds value there.

#### Add a comment

```bash
issues comment add TICKET_ID --body "$(cat <<'EOF'
Comment text
EOF
)" --json
```

#### Edit a comment

```bash
issues comment edit COMMENT_ID --body "$(cat <<'EOF'
Updated text
EOF
)" --json
```

#### Delete a comment

```bash
issues comment delete COMMENT_ID --json
```

### Blocking Relationships

#### Add a blocker

```bash
issues block add --blocker 10 --blocked 42 --project PROJECT --json
```

Note: `--project` is optional if you're in a git repo whose origin matches a known project.

#### Remove a blocker

```bash
issues block remove --blocker 10 --blocked 42 --project PROJECT --json
```

### Assignment

#### Assign a ticket

```bash
issues assign TICKET_ID --user USER_ID --json
```

#### Unassign a ticket

```bash
issues unassign TICKET_ID --json
```

### Authentication

#### Login / re-authentication (secure — token never in shell history)

```bash
gh auth token | issues auth login --pat -
```

Delegates to the already-authenticated `gh` CLI to supply the PAT via stdin. Works for both initial login and re-authentication when a token expires mid-session. Requires `gh` to be authenticated first — run `gh auth login` if needed.

#### Auth check with auto-recovery

```bash
issues auth whoami || (gh auth token | issues auth login --pat -)
```

Use this one-liner at the start of a session to verify auth is valid and automatically re-authenticate if it has expired.

#### Check current user

```bash
issues auth whoami
```

#### Logout

```bash
issues auth logout
```

### JSON Output

All commands (except `auth`) support a `--json` flag that outputs raw JSON instead of formatted text. Use `--json` when parsing output programmatically.

```bash
# Get ticket data as JSON
issues ticket view 42 --project PROJECT_ID --json

# List tickets as JSON (includes pagination info)
issues ticket list --project PROJECT_ID --json

# Create and get structured response
issues ticket create --project PROJECT_ID --title "Title" --json

# Get label list as JSON array
issues label list --json
```

When `--json` is used:
- Output is valid JSON written to stdout (no spinner text, no ANSI codes)
- The JSON structure matches the GraphQL response data
- Errors still go to stderr in plain text

**Best practice for agents:** Always use `--json` when invoking `issues` CLI commands. This avoids parsing chalk-formatted terminal output with ANSI escape codes. Parse with `jq` or read the JSON directly.

---

## Data Model Notes

### States

| State | Description |
|-------|-------------|
| `BACKLOG` | New/unrefined ticket |
| `REFINED` | Ready for implementation |
| `IN_PROGRESS` | Actively being worked on |
| `CLOSED` | Completed |

### Priorities

`HIGHEST`, `HIGH`, `MEDIUM` (default), `LOW`, `LOWEST`

### Story Points

Arbitrary positive integers. Convention: Fibonacci scale (1, 2, 3, 5, 8, 13).
