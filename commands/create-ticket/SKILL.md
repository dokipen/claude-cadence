---
name: create-ticket
description: Create a ticket in the project's issue tracker. Collects title, description, and acceptance criteria, then creates the ticket and stops — no implementation.
disable-model-invocation: true
---

# Create Ticket

Create a ticket in the project's issue tracker and stop. Do NOT begin implementation.

## Filesystem Scope

> **IMPORTANT:** Only access files within the project repository (the directory containing `CLAUDE.md`). This applies to all tools — `Read`, `Glob`, `Grep`, and `Bash` alike. Never run Bash commands (e.g., `find`, `cat`, `ls`) targeting paths outside the repository, and never use absolute paths to home directories or system paths. Do not use `$HOME`, `~`, or any environment variable that may expand to a path outside the project repository (e.g., `$XDG_CONFIG_HOME`, `$TMPDIR`, `$XDG_DATA_HOME`, `$XDG_RUNTIME_DIR`, `$XDG_CACHE_HOME`), do not use path traversal (e.g., `../`) to navigate above the repo root, and do not run `readlink` or `realpath` on paths that would resolve outside the project directory. Use relative paths and `Glob`/`Grep` within the project directory.

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

```bash
PROVIDER_CONFIG=$(bash skills/ticket-provider/scripts/detect-provider.sh)
PROVIDER=$(echo "$PROVIDER_CONFIG" | jq -r '.provider')
PROJECT=$(echo "$PROVIDER_CONFIG" | jq -r '.project')
```

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

Present a summary of what will be created. Do not ask for confirmation — proceed directly to step 3 to create the ticket:

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

**Issues API:**
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

For Issues API, resolve label IDs first (labels are global — no `--project` flag needed):
```bash
issues label list --json
```

### 4. Report and Stop

Output the created ticket number and URL (or ID for issues-api), then stop.

```
Created ticket #<N>: <title>
<url or id>
```

That's it. Do not proceed further.
