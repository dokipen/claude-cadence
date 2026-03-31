---
name: create-ticket
description: Create a ticket in the project's issue tracker. Collects title, description, and acceptance criteria, then creates the ticket and stops — no implementation.
disable-model-invocation: true
---

# Create Ticket

Create a ticket in the project's issue tracker and stop. Do NOT begin implementation.

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

## Usage

```
/create-ticket
/create-ticket "Add user authentication"
/create-ticket "Fix login redirect bug"
```

## Critical Rule

**After creating the ticket, your work is done. Stop.**

Do not plan, scaffold, implement, or suggest next steps. The purpose of this command is ticket creation only. If you feel the urge to start implementing — don't.

## Provider Detection

Detect the configured ticket provider before any operation. Refer to the `ticket-provider` skill for full details and command reference.

Run the following if `$CADENCE_ROOT` is not already set:

```bash
# Resolve cadence plugin root if not already set. Checks (in order):
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

> **MCP-first for issues-api:** When `PROVIDER` is `issues-api` and `mcp__issues__*` tools appear in your available tool list, use them instead of shelling out to the `issues` CLI. MCP tools require no shell escaping and no CLI install. The `issues` CLI is a fallback for when MCP tools are absent.

## Workflow

### 1. Collect Information

Gather the following — infer from arguments where possible, otherwise ask the user:

| Field | Required | Notes |
|-------|----------|-------|
| **Title** | Yes | Descriptive, action-oriented (e.g., "Add X", "Fix Y") |
| **Description** | Yes | What and why — context for the implementer |
| **Acceptance criteria** | Yes | Bullet list of conditions that define "done" |
| **Label/type** | Yes | `bug`, `enhancement`, `chore`, etc. |
| **Target project** | If no `project_id` in `CLAUDE.md` | Ask the user which project to use |

If the user provided a title as an argument, use it. Ask for anything missing in a single prompt — do not ping-pong with one question at a time.

### 2. Show Summary

Present a summary of what will be created. Once the target project is known (configured via `project_id` in `CLAUDE.md`, explicitly specified by the user, or collected in the information-gathering step above), proceed directly to step 3 — do not ask for a general "are you sure?" creation confirmation:

```
Creating ticket:
  Title: <title>
  Type: <label>
  Project: <project> (if issues-api)

Description:
<description>

Acceptance criteria:
<criteria>
```

### 3. Create the Ticket

**Shell safety:** Body content uses `<<'EOF'` single-quoted heredocs (backtick-safe). The `--title` argument is inline — avoid backticks in titles. If a title must reference code, write it without backtick formatting (e.g., "Fix createSession return type" not "Fix `createSession` return type"). If backticks in a title are unavoidable, use a variable assignment:
```bash
TICKET_TITLE=$(cat <<'EOF'
Fix `createSession` return type
EOF
)
```
Then pass `--title "$TICKET_TITLE"` instead of an inline string.

**GitHub Issues:**
```bash
gh issue create \
  --title "<title>" \
  --label "<type>" \
  --body "$(cat <<'EOF'
## Description
<description>

## Acceptance Criteria
<criteria>
EOF
)"
```

**Issues API (MCP — preferred when `mcp__issues__*` tools are available):**

Resolve label IDs first using the MCP tool (labels are global):
```
mcp__issues__label_list
  (no parameters)
```

Then create the ticket:
```
mcp__issues__ticket_create
  title: "<title>"
  projectName: "<PROJECT>"
  description: |
    ## Description
    <description>
  acceptanceCriteria: |
    - [ ] <criterion 1>
    - [ ] <criterion 2>
  labelIds: ["<LABEL_CUID>"]
  priority: "MEDIUM"
  storyPoints: 2              # optional, Fibonacci scale: 1, 2, 3, 5, 8, 13
```

**Issues API (CLI — fallback when MCP tools are absent):**

Resolve label IDs first (labels are global — no `--project` flag needed):
```bash
issues label list --json
```

Then create the ticket:
```bash
issues ticket create \
  --project "$PROJECT" \
  --title "<title>" \
  --labels "<LABEL_ID>" \
  --description "$(cat <<'EOF'
## Description
<description>
EOF
)" \
  --acceptance-criteria "$(cat <<'EOF'
- [ ] <criterion 1>
- [ ] <criterion 2>
EOF
)" \
  --json
```

> **Important (Issues API):** Always use `--acceptance-criteria` for acceptance criteria — never embed them inside `--description`. The `--description` flag maps to the ticket's description field, and `--acceptance-criteria` maps to its own dedicated field. Mixing them causes criteria to appear in the wrong field in the UI and API response.

### 4. Report and Stop

Output the created ticket number and URL (or ID for issues-api), then stop.

```
Created ticket #<N>: <title>
<url or id>
```

That's it. Do not proceed further.
