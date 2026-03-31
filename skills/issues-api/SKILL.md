---
name: issues-api
description: MCP tools for the issues microservice backend. Use when the project's ticket provider is configured as issues-api.
user-invokable: false
---

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

## Overview

This skill documents how to interact with the issues microservice using MCP tools (`mcp__issues__*`). Use this skill only when the project's `CLAUDE.md` configures `provider: issues-api`.

**MCP tools are required.** If `mcp__issues__*` tools are not available in your tool list, surface an error — do not attempt to fall back to the `issues` CLI.

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

## MCP Tools

These tools require no shell escaping and work with structured input/output.

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

Positive integers. Convention: Fibonacci scale (1, 2, 3, 5, 8, 13).
