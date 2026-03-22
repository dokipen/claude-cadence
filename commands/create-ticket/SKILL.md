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

Detect the configured ticket provider before any operation. Refer to the `ticket-provider` skill for full details.

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
| **Target project** | When ambiguous | Ask if `CLAUDE.md` has no `project_id` and multiple projects exist |

If the user provided a title as an argument, use it. Ask for anything missing in a single prompt — do not ping-pong with one question at a time.

### 2. Confirm Before Creating

Present a summary and ask for confirmation before creating:

```
About to create ticket:
  Title: <title>
  Type: <label>
  Project: <project> (if issues-api)

Description:
<description>

Acceptance criteria:
<criteria>

Proceed? [Y/n]
```

Skip confirmation if the user provided all details up front and said something like "create a ticket for X, description Y, AC Z".

### 3. Create the Ticket

**GitHub Issues:**
```bash
gh issue create \
  --title "<title>" \
  --label "<type>" \
  --body "## Description
<description>

## Acceptance Criteria
<criteria>"
```

**Issues API:**
```bash
issues ticket create \
  --project "$PROJECT" \
  --title "<title>" \
  --labels "<LABEL_ID>" \
  --description "## Description
<description>" \
  --acceptance-criteria "<criteria>" \
  --json
```

For Issues API, resolve label IDs first:
```bash
issues label list --project "$PROJECT" --json
```

### 4. Report and Stop

Output the created ticket number and URL (or ID for issues-api), then stop.

```
Created ticket #<N>: <title>
<url or id>
```

That's it. Do not proceed further.
