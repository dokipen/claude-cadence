---
name: refine
description: Refine tickets to ensure quality standards before work begins
disable-model-invocation: true
---

# Ticket Refinement

Refine tickets to meet quality standards before implementation begins. Supports both GitHub Issues and the issues microservice as backends.

## Usage

```
/refine           # Refine all unrefined open issues
/refine 123       # Refine specific issue #123
```

## Provider Detection

Before any ticket operation, detect the configured provider. Refer to the `ticket-provider` skill for full details.

```bash
# Extract provider from project's CLAUDE.md (defaults to "github")
PROVIDER=$(grep -A3 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'provider:' | tail -1 | awk '{print $2}' || echo "github")
PROJECT_ID=$(grep -A4 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'project_id:' | tail -1 | awk '{print $2}')
```

Use this value to select the correct commands throughout the workflow.

## Workflow

### Single Issue (`/refine 123`)

1. **Delegate to ticket-refiner agent:**
   ```
   Review and refine issue #123.

   Check all refinement criteria and report findings.
   For any missing items, apply best-effort fixes directly.
   Estimate based on scope and complexity — do not ask the user.
   ```

2. **Apply all fixes** including estimates, labels, and title improvements

3. **Mark refined** when all criteria pass:

   **GitHub (default):**
   ```bash
   gh issue edit 123 --add-label "refined"
   ```

   **Issues API:**
   ```bash
   issues ticket transition 123 --project $PROJECT_ID --to REFINED
   ```

### Batch Refinement (`/refine`)

1. **Get unrefined open issues:**

   **GitHub (default):**
   ```bash
   gh issue list --state open --json number,title,labels \
     --jq '.[] | select(.labels | map(.name) | contains(["refined"]) | not) | "\(.number): \(.title)"'
   ```

   **Issues API:**
   ```bash
   issues ticket list --project $PROJECT_ID --state BACKLOG
   ```

2. **For each issue**, delegate to ticket-refiner agent

3. **Present summary** of all issues reviewed and changes made

## Refinement Criteria

An issue is refined when it has ALL of:

| Criterion | GitHub Issues | Issues API |
|-----------|--------------|------------|
| Clear title | Descriptive, categorized via labels | Same |
| Acceptance criteria | Checkboxes defining "done" | `--acceptance-criteria` field |
| Estimate | `estimate:N` label (1-13) | Story points field (`--points N`) |
| Priority | `priority:high`, `priority:medium`, or `priority:low` label | Priority field (`--priority N`) |
| Type label | Label by name: bug, enhancement, etc. | Label by ID (use `issues label list --project $PROJECT_ID` to look up) |
| Assigned | Assigned to a developer | `issues assign N --project $PROJECT_ID --user USER_ID` |
| Blockers linked | Via GitHub dependencies API | `issues block add --project $PROJECT_ID --blocker X --blocked N` |
| Blocked label | `blocked` label if open blockers exist | Blocked tickets auto-tracked; cannot transition to `IN_PROGRESS` |
| Refined | `refined` label added after all criteria met | Transition to `REFINED` state |

## Quick Reference

### Estimate Scale

| Points | Description |
|--------|-------------|
| 1 | Trivial, <1 hour |
| 2 | Simple, few hours |
| 3 | Straightforward, half day |
| 5 | Moderate, 1 day |
| 8 | Significant, 2-3 days |
| 13 | Very large, consider breaking down |

GitHub uses labels (`estimate:5`). Issues API uses story points (`--points 5`).

### Priority Scale

| Label | Description |
|-------|-------------|
| priority:high | Blocking other work, critical bug, or security issue |
| priority:medium | Normal feature work or non-critical bugs |
| priority:low | Nice-to-have improvements, minor cleanup, deferred review findings |

GitHub uses labels (`priority:medium`). Issues API uses the priority field (`--priority N`).

### Title Conventions

Example: `Add achievements` + `enhancement` label
