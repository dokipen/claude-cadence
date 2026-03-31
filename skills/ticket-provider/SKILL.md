---
name: ticket-provider
description: Ticket provider abstraction layer that reads CLAUDE.md configuration and dispatches to the correct backend (GitHub Issues or issues microservice). Use when performing ticket operations.
user-invokable: false
---

## Filesystem Scope

> **IMPORTANT:** Only access files within the project repository (the directory containing `CLAUDE.md`). This applies to all tools — `Read`, `Glob`, `Grep`, and `Bash` alike. Never run Bash commands (e.g., `find`, `cat`, `ls`) targeting paths outside the repository, and never use absolute paths to home directories or system paths. Do not use `$HOME`, `~`, or any environment variable that may expand to a path outside the project repository (e.g., `$XDG_CONFIG_HOME`, `$TMPDIR`, `$XDG_DATA_HOME`, `$XDG_RUNTIME_DIR`, `$XDG_CACHE_HOME`, `$PATH`, `$SHELL`, `$OLDPWD`), do not use path traversal (e.g., `../`) to navigate above the repo root, do not run `readlink` or `realpath` on paths that would resolve outside the project directory, do not follow symlinks that lead outside the project directory, do not use `printenv` or `env` to read environment variables as path components, do not use `which`, `command -v`, or `type` to locate system tools, and do not use command substitution with any of these commands to construct file paths (e.g., `$(which python3)`, `$(printenv GOPATH)/src`, `$(command -v git)`). Use relative paths and `Glob`/`Grep` within the project directory.

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
# Resolve cadence plugin root. Checks (in order):
# 1. CADENCE_ROOT env var (explicit override, e.g. for --plugin-dir installs)
# 2. Current directory (running directly from the cadence repo)
# 3. .claude/plugins/cadence/ (locally installed plugin)
CADENCE_ROOT="${CADENCE_ROOT:-}"
if [ -z "$CADENCE_ROOT" ] && [ -f ".claude-plugin/plugin.json" ]; then
  CADENCE_ROOT="$(pwd)"
fi
if [ -z "$CADENCE_ROOT" ] && [ -d ".claude/plugins/cadence" ]; then
  CADENCE_ROOT="$(pwd)/.claude/plugins/cadence"
fi
if [ -z "$CADENCE_ROOT" ]; then
  echo "ERROR: cadence plugin root not found. Set CADENCE_ROOT env var to the plugin directory." >&2
  exit 1
fi
case "$CADENCE_ROOT" in
  *..*)
    echo "ERROR: CADENCE_ROOT must not contain path traversal (..)." >&2
    exit 1
    ;;
esac
PROVIDER_CONFIG=$(bash "$CADENCE_ROOT/skills/ticket-provider/scripts/detect-provider.sh")
PROVIDER=$(echo "$PROVIDER_CONFIG" | jq -r '.provider')
PROJECT=$(echo "$PROVIDER_CONFIG" | jq -r '.project')
```

## Provider Dispatch

### GitHub Issues (default)

When `provider: github` (or no config), use `gh` CLI commands.

| Operation | Command |
|-----------|---------|
| List tickets | `gh issue list [filters]` |
| View ticket | `gh issue view N` |
| Create ticket | `gh issue create --title "..." --body "$(cat <<'EOF' ... EOF)"` |
| Update ticket | `gh issue edit N [options]` |
| Add label | `gh issue edit N --add-label "name"` |
| Remove label | `gh issue edit N --remove-label "name"` |
| Comment | `gh issue comment N --body "$(cat <<'EOF' ... EOF)"` |
| Close ticket | `gh issue close N` |
| Check blockers | `gh api repos/{owner}/{repo}/issues/N/dependencies/blocked_by` |
| Check labels | `gh issue view N --json labels --jq '.labels[].name'` |
| Check assignee | `gh issue view N --json assignees --jq '.assignees[].login'` |
| Check estimate | `gh issue view N --json labels --jq '.labels[].name \| select(startswith("estimate:"))'` |
| Check state | `gh issue view N --json state --jq '.state'` |

### Issues API

When `provider: issues-api`, prefer `mcp__issues__*` MCP tools — they require no shell escaping and no CLI install. Fall back to the `issues` CLI when MCP tools are absent. Refer to the `issues-api` skill for the full command reference for both paths.

**Important:** MCP tools are deferred and will not appear in your tool list until probed. Before assuming they are absent and falling back to CLI, call `ToolSearch` with query `select:mcp__issues__ticket_get,mcp__issues__ticket_list,mcp__issues__ticket_create,mcp__issues__ticket_update,mcp__issues__ticket_transition,mcp__issues__ticket_assign,mcp__issues__ticket_unassign,mcp__issues__comment_add,mcp__issues__label_add,mcp__issues__label_remove,mcp__issues__label_list` to load all MCP tool schemas. If `ToolSearch` returns tool definitions, use MCP tools. Only use the CLI fallback if `ToolSearch` returns no results.

The table below shows the CLI fallback commands. When `mcp__issues__*` tools are available, use them instead — see the `issues-api` skill for MCP tool signatures.

**N** = ticket number (requires `--project`), **TICKET_ID** = CUID (no `--project` needed). Use `ticket view` to look up a ticket's CUID from its number.

| Operation | MCP tool (preferred) | CLI fallback |
|-----------|----------------------|-------------|
| List tickets | `mcp__issues__ticket_list` | `issues ticket list --project $PROJECT [filters] --json` |
| View ticket | `mcp__issues__ticket_get` | `issues ticket view N --project $PROJECT --json` |
| Create ticket | `mcp__issues__ticket_create` | `issues ticket create --project $PROJECT --title "..." [options] --json` |
| Update ticket | `mcp__issues__ticket_update` | `issues ticket update TICKET_ID [options] --json` |
| Add label | `mcp__issues__label_add` | `issues label add TICKET_ID --label LABEL_ID --json` |
| Remove label | `mcp__issues__label_remove` | `issues label remove TICKET_ID --label LABEL_ID --json` |
| Comment | `mcp__issues__comment_add` | `issues comment add TICKET_ID --body "$(cat <<'EOF' ... EOF)" --json` |
| Close ticket | `mcp__issues__ticket_transition` | `issues ticket transition TICKET_ID --to CLOSED --json` |
| Check blockers | `mcp__issues__ticket_get` (read `blockedBy`) | `issues ticket view N --project $PROJECT --json` (read `blockedBy` array) |
| Check state | `mcp__issues__ticket_get` (read `state`) | `issues ticket view N --project $PROJECT --json` (read `state` field) |
| Check assignee | `mcp__issues__ticket_get` (read `assignee`) | `issues ticket view N --project $PROJECT --json` (read `assignee` field) |
| Check estimate | `mcp__issues__ticket_get` (read `storyPoints`) | `issues ticket view N --project $PROJECT --json` (read `storyPoints` field) |

**Important:** Always use `--json` on `issues` CLI commands. This outputs structured JSON instead of chalk-formatted text, making output reliable for programmatic parsing. See the `issues-api` skill for details.

## Concept Mapping

The two providers use different terminology in some areas:

| Concept | GitHub Issues | Issues API |
|---------|--------------|------------|
| Ticket identifier | Issue number (`#42`) | Display number (`#42`) for lookups; CUID (e.g. `cmn…`) required for mutations |
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
- **Issues API identifier two-step**: The display number (`#42`) can only be used with lookup operations (`ticket view N --project $PROJECT` or `mcp__issues__ticket_get` with `number`). Mutation operations — update, transition, label add/remove, comment — require the CUID from the response. Always call `ticket view` (or `mcp__issues__ticket_get`) first to obtain the CUID, then pass it to subsequent mutations.
- The `issues` CLI must be installed and authenticated (`gh auth token | issues auth login --pat -`)
- **QA/local override** (`issues-api` only): Set `ISSUES_API_URL` to target a local or QA instance without modifying `CLAUDE.md`. This takes precedence over the `api_url` in `CLAUDE.md`. Has no effect when provider is `github`.
  ```bash
  ISSUES_API_URL=http://192.168.1.100:5173/graphql /lead 123
  ```
