---
name: ticket-provider
description: Ticket provider abstraction layer that reads CLAUDE.md configuration and dispatches to the correct backend (GitHub Issues or issues microservice). Use when performing ticket operations.
user-invokable: false
---

## Overview

This skill provides a unified interface for ticket operations across different backends. It reads the consuming project's `CLAUDE.md` to determine which ticket provider to use, then dispatches operations to the appropriate backend.

## Provider Detection

Read the project's `CLAUDE.md` and look for a `## Ticket Provider` section:

```markdown
## Ticket Provider
provider: issues-api
api_url: http://localhost:4000
project_id: <project-name-or-id>
```

If no `Ticket Provider` section exists, or if it specifies `provider: github`, use the **GitHub Issues** backend (default, backward compatible).

### Detection Logic

```bash
# Extract provider from CLAUDE.md (defaults to "github")
PROVIDER=$(grep -A3 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'provider:' | tail -1 | awk '{print $2}' || echo "github")
PROJECT=$(grep -A4 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'project_id:' | tail -1 | awk '{print $2}')
```

## Provider Dispatch

### GitHub Issues (default)

When `provider: github` (or no config), use `gh` CLI commands. Refer to the `github-issues` skill for full command reference.

| Operation | Command |
|-----------|---------|
| List tickets | `gh issue list [filters]` |
| View ticket | `gh issue view N` |
| Create ticket | `gh issue create --title "..." --body "..."` |
| Update ticket | `gh issue edit N [options]` |
| Add label | `gh issue edit N --add-label "name"` |
| Remove label | `gh issue edit N --remove-label "name"` |
| Comment | `gh issue comment N --body "..."` |
| Close ticket | `gh issue close N` |
| Check blockers | `gh api repos/{owner}/{repo}/issues/N/dependencies/blocked_by` |
| Check labels | `gh issue view N --json labels --jq '.labels[].name'` |
| Check assignee | `gh issue view N --json assignees --jq '.assignees[].login'` |
| Check estimate | `gh issue view N --json labels --jq '.labels[].name \| select(startswith("estimate:"))'` |
| Check state | `gh issue view N --json state --jq '.state'` |

### Issues API

When `provider: issues-api`, use the `issues` CLI. Refer to the `issues-api` skill for full command reference.

**N** = ticket number (requires `--project`), **TICKET_ID** = CUID (no `--project` needed). Use `ticket view` to look up a ticket's CUID from its number.

| Operation | Command |
|-----------|---------|
| List tickets | `issues ticket list --project $PROJECT [filters] --json` |
| View ticket | `issues ticket view N --project $PROJECT --json` |
| Create ticket | `issues ticket create --project $PROJECT --title "..." [options] --json` |
| Update ticket | `issues ticket update TICKET_ID [options] --json` |
| Add label | `issues label add TICKET_ID --label LABEL_ID --json` |
| Remove label | `issues label remove TICKET_ID --label LABEL_ID --json` |
| Comment | `issues comment add TICKET_ID --body "..." --json` |
| Close ticket | `issues ticket transition TICKET_ID --to CLOSED --json` |
| Check blockers | `issues ticket view N --project $PROJECT --json` (read `blockedBy` array) |
| Check state | `issues ticket view N --project $PROJECT --json` (read `state` field) |
| Check assignee | `issues ticket view N --project $PROJECT --json` (read `assignee` field) |
| Check estimate | `issues ticket view N --project $PROJECT --json` (read `storyPoints` field) |

**Important:** Always use `--json` on `issues` CLI commands. This outputs structured JSON instead of chalk-formatted text, making output reliable for programmatic parsing. See the `issues-api` skill for details.

## Concept Mapping

The two providers use different terminology in some areas:

| Concept | GitHub Issues | Issues API |
|---------|--------------|------------|
| Ticket identifier | Issue number (`#42`) | Ticket ID (`#42`) |
| State | `open` / `closed` | `BACKLOG` / `REFINED` / `IN_PROGRESS` / `CLOSED` |
| Estimate | Label (`estimate:5`) | Story points field (`--points 5`) |
| Priority | Not native (use labels) | Native field (`--priority HIGH`) |
| Labels | By name | By ID (use `issues label list --json` to resolve) |
| Claim/start work | Add `in-progress` label | Transition to `IN_PROGRESS` |
| Mark refined | Add `refined` label | Transition to `REFINED` |
| Blocking | GitHub dependencies API | `issues block add/remove --blocker X --blocked Y --json` |

## Important Notes

- **PR operations always use `gh` CLI** regardless of ticket provider — PRs are a GitHub concept
- **Default is `github`** — existing projects work without any configuration changes
- When using `issues-api`, the API URL from `CLAUDE.md` must be reachable
- When using `issues-api`, `project_id` is required for `ticket list`, `ticket create`, and `ticket view` (when using ticket numbers). Other commands take a CUID ticket ID and don't need `--project`.
- The `issues` CLI must be installed and authenticated (`issues auth login --pat <token>`)
