---
name: create-ticket
description: Create a ticket in the project's issue tracker. Collects title, description, and acceptance criteria, then creates the ticket and stops — no implementation.
disable-model-invocation: true
---

# Create Ticket

Create a ticket in the project's issue tracker and stop. Do NOT begin implementation.

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
PROVIDER=$(grep -A3 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'provider:' | tail -1 | awk '{print $2}' || echo "github")
PROJECT=$(grep -A4 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'project_id:' | tail -1 | awk '{print $2}')
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
