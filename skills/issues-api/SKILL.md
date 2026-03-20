---
name: issues-api
description: CLI commands for the issues microservice backend. Use when the project's ticket provider is configured as issues-api.
user-invokable: false
---

## Overview

This skill documents the `issues` CLI client for the issues microservice. Use these commands when the project's `CLAUDE.md` configures `provider: issues-api` in its `Ticket Provider` section.

## Prerequisites

- The issues microservice must be running at the configured `api_url`
- The CLI must be authenticated: `issues auth whoami`
- If not authenticated: `gh auth token | issues auth login --pat -`

## Project Name Resolution

All `--project` flags and project positional arguments accept either a project **name** (e.g., `claude-cadence`) or a **CUID** (e.g., `cmmryin270000ny01dc2msx3t`). The CLI resolves names to IDs automatically.

## Project Management

### Create a project

```bash
issues project create --name "My Project" --repository "org/repo" --json
```

### List projects

```bash
issues project list --json
```

### View a project

```bash
issues project view PROJECT --json
```

### Update a project

```bash
issues project update PROJECT --name "New Name" --json
issues project update PROJECT --repository "org/new-repo" --json
```

## Project Inference

The CLI can infer the project from the current directory's git remote origin URL. When `--project` is omitted, the CLI reads `git remote get-url origin`, normalizes it to an `owner/repo` slug, and matches it against known projects. Explicit `--project` always takes precedence.

## Ticket Management

**ID types:** Commands accept either a ticket number or a CUID. When using a ticket number, include `--project PROJECT` to resolve it (project name or ID; inferred from git origin if omitted). When using a CUID, `--project` is not needed.

### Create a ticket

```bash
issues ticket create \
  --title "Brief descriptive title" \
  --project PROJECT \
  --description "Detailed description" \
  --acceptance-criteria "- [ ] Criterion 1\n- [ ] Criterion 2" \
  --labels "bug,enhancement" \
  --assignee USER_ID \
  --points 5 \
  --priority MEDIUM \
  --json
```

`--body` is accepted as an alias for `--description` on both `create` and `update`.

Note: `--project` is optional if you're in a git repo whose origin matches a known project.

### View a ticket

```bash
issues ticket view 42 --project PROJECT --json
```

Note: `--project` is optional when viewing by ticket number if you're in a matching git repo.

Shows: title, state, priority, story points, assignee, labels, description, acceptance criteria, blockers, comments.

### List tickets

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

### Update a ticket

```bash
issues ticket update TICKET_ID --title "New title" --json
issues ticket update TICKET_ID --description "New description" --json
issues ticket update TICKET_ID --acceptance-criteria "Updated criteria" --json
issues ticket update TICKET_ID --points 8 --json
issues ticket update TICKET_ID --priority HIGH --json
```

### Transition a ticket (state changes)

```bash
issues ticket transition TICKET_ID --to REFINED --json
issues ticket transition TICKET_ID --to IN_PROGRESS --json
issues ticket transition TICKET_ID --to CLOSED --json
issues ticket transition TICKET_ID --to BACKLOG --json
```

Valid transitions:
- `BACKLOG` -> `REFINED`, `CLOSED`
- `REFINED` -> `IN_PROGRESS`, `BACKLOG`, `CLOSED`
- `IN_PROGRESS` -> `CLOSED`, `REFINED`
- `CLOSED` -> `BACKLOG`

Blocked tickets cannot transition to `IN_PROGRESS`.

**State machine:**

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

> **IMPORTANT:** Always check the ticket's current state before transitioning.
> Use `issues ticket view TICKET_ID --project PROJECT --json` and read the `state` field.
> - Transitioning to the current state is an error
> - Skipping states is an error (e.g., `BACKLOG` → `IN_PROGRESS` is invalid — must go through `REFINED`)

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

## Labels

### List labels

```bash
issues label list --json
```

### Create a label

```bash
issues label create --name "bug" --color "#d73a4a" --json
```

### Add a label to a ticket

```bash
issues label add TICKET_ID --label bug --json
```

### Remove a label from a ticket

```bash
issues label remove TICKET_ID --label bug --json
```

### Delete a label

```bash
issues label delete LABEL_NAME_OR_ID --json
```

Deletes a label entirely. If the label is attached to any tickets, it is automatically removed from them.

## Comments

### Add a comment

```bash
issues comment add TICKET_ID --body "Comment text" --json
```

### Edit a comment

```bash
issues comment edit COMMENT_ID --body "Updated text" --json
```

### Delete a comment

```bash
issues comment delete COMMENT_ID --json
```

## Blocking Relationships

### Add a blocker

```bash
issues block add --blocker 10 --blocked 42 --project PROJECT --json
```

Note: `--project` is optional if you're in a git repo whose origin matches a known project.

### Remove a blocker

```bash
issues block remove --blocker 10 --blocked 42 --project PROJECT --json
```

## Assignment

### Assign a ticket

```bash
issues assign TICKET_ID --user USER_ID --json
```

### Unassign a ticket

```bash
issues unassign TICKET_ID --json
```

## Authentication

### Login / re-authentication (secure — token never in shell history)

```bash
gh auth token | issues auth login --pat -
```

Delegates to the already-authenticated `gh` CLI to supply the PAT via stdin. Works for both initial login and re-authentication when a token expires mid-session. Requires `gh` to be authenticated first — run `gh auth login` if needed.

### Auth check with auto-recovery

```bash
issues auth whoami || (gh auth token | issues auth login --pat -)
```

Use this one-liner at the start of a session to verify auth is valid and automatically re-authenticate if it has expired.

### Check current user

```bash
issues auth whoami
```

### Logout

```bash
issues auth logout
```

## JSON Output

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
