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
- If not authenticated: `issues auth login --pat <github-pat>`

## Project Management

### Create a project

```bash
issues project create --name "My Project" --repository "org/repo"
```

### List projects

```bash
issues project list
```

### View a project

```bash
issues project view PROJECT_ID
```

### Update a project

```bash
issues project update PROJECT_ID --name "New Name"
issues project update PROJECT_ID --repository "org/new-repo"
```

## Project Inference

The CLI can infer the project from the current directory's git remote origin URL. When `--project` is omitted, the CLI reads `git remote get-url origin`, normalizes it to an `owner/repo` slug, and matches it against known projects. Explicit `--project` always takes precedence.

## Ticket Management

**ID types:** Most commands accept either a ticket number or a CUID. When using a ticket number, `ticket view` requires `--project PROJECT_ID` to resolve it. When using a CUID, `--project` is not needed. Commands like `ticket update`, `ticket transition`, `comment add`, `label add/remove`, `assign`, and `unassign` only accept a CUID and do not use `--project`. Use `ticket view` to look up a ticket's CUID from its number.

### Create a ticket

```bash
issues ticket create \
  --title "Brief descriptive title" \
  --project PROJECT_ID \
  --description "Detailed description" \
  --acceptance-criteria "- [ ] Criterion 1\n- [ ] Criterion 2" \
  --labels "LABEL_ID1,LABEL_ID2" \
  --assignee USER_ID \
  --points 5 \
  --priority MEDIUM
```

Note: `--project` is optional if you're in a git repo whose origin matches a known project.

### View a ticket

```bash
issues ticket view 42 --project PROJECT_ID
```

Note: `--project` is optional when viewing by ticket number if you're in a matching git repo.

Shows: title, state, priority, story points, assignee, labels, description, acceptance criteria, blockers, comments.

### List tickets

```bash
issues ticket list
issues ticket list --state REFINED
issues ticket list --label "bug"
issues ticket list --assignee "username"
issues ticket list --blocked
issues ticket list --priority HIGH
issues ticket list --project PROJECT_ID
issues ticket list --limit 50
issues ticket list --after "cursor_value"
```

### Update a ticket

```bash
issues ticket update TICKET_ID --title "New title"
issues ticket update TICKET_ID --description "New description"
issues ticket update TICKET_ID --acceptance-criteria "Updated criteria"
issues ticket update TICKET_ID --points 8
issues ticket update TICKET_ID --priority HIGH
```

### Transition a ticket (state changes)

```bash
issues ticket transition TICKET_ID --to REFINED
issues ticket transition TICKET_ID --to IN_PROGRESS
issues ticket transition TICKET_ID --to CLOSED
issues ticket transition TICKET_ID --to BACKLOG
```

Valid transitions:
- `BACKLOG` -> `REFINED`, `CLOSED`
- `REFINED` -> `IN_PROGRESS`, `BACKLOG`, `CLOSED`
- `IN_PROGRESS` -> `CLOSED`, `REFINED`
- `CLOSED` -> `BACKLOG`

Blocked tickets cannot transition to `IN_PROGRESS`.

## Labels

### List labels

```bash
issues label list
```

### Create a label

```bash
issues label create --name "bug" --color "#d73a4a"
```

### Add a label to a ticket

```bash
issues label add TICKET_ID --label LABEL_ID
```

### Remove a label from a ticket

```bash
issues label remove TICKET_ID --label LABEL_ID
```

## Comments

### Add a comment

```bash
issues comment add TICKET_ID --body "Comment text"
```

### Edit a comment

```bash
issues comment edit COMMENT_ID --body "Updated text"
```

### Delete a comment

```bash
issues comment delete COMMENT_ID
```

## Blocking Relationships

### Add a blocker

```bash
issues block add --blocker 10 --blocked 42
```

### Remove a blocker

```bash
issues block remove --blocker 10 --blocked 42
```

## Assignment

### Assign a ticket

```bash
issues assign TICKET_ID --user USER_ID
```

### Unassign a ticket

```bash
issues unassign TICKET_ID
```

## Authentication

### Login with GitHub PAT

```bash
issues auth login --pat <github-personal-access-token>
```

### Login with OAuth code

```bash
issues auth login --code <oauth-code>
```

### Check current user

```bash
issues auth whoami
```

### Logout

```bash
issues auth logout
```

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
