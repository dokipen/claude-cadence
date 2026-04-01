---
name: refine
description: Refine tickets to ensure quality standards before work begins
disable-model-invocation: true
---

# Ticket Refinement

Refine tickets to meet quality standards before implementation begins. Supports both GitHub Issues and the issues microservice as backends.

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

## Usage

```
/refine           # Refine all unrefined open issues
/refine 123       # Refine specific issue #123
```

## Provider Detection

Before any ticket operation, check if `$CADENCE_ROOT` is already set (resolve if empty), then detect the configured provider. Refer to the `ticket-provider` skill for full details.

```bash
# Check if $CADENCE_ROOT is already set
echo "${CADENCE_ROOT:-}"
```

If empty, resolve it:

```bash
if [ -f ".claude-plugin/plugin.json" ]; then
  CADENCE_ROOT="$(pwd)"
elif [ -d ".claude/plugins/cadence" ]; then
  CADENCE_ROOT="$(pwd)/.claude/plugins/cadence"
else
  echo "ERROR: cadence plugin root not found. Set CADENCE_ROOT env var to the plugin directory." >&2
  exit 1
fi
```

```bash
case "$CADENCE_ROOT" in
  *..*)\n    echo "ERROR: CADENCE_ROOT must not contain path traversal (..)." >&2
    exit 1
    ;;
esac
PROVIDER_CONFIG=$(bash "$CADENCE_ROOT/skills/ticket-provider/scripts/detect-provider.sh")
PROVIDER=$(echo "$PROVIDER_CONFIG" | jq -r '.provider')
PROJECT=$(echo "$PROVIDER_CONFIG" | jq -r '.project')
```

Use this value to select the correct commands throughout the workflow.

## Workflow

### Single Issue (`/refine 123`)

1. **Delegate to ticket-refiner agent:**
   ```
   Review and refine issue #123.

   Check all refinement criteria and report findings.
   For any missing items, apply best-effort fixes directly.
   Estimate based on scope and complexity using codebase context — only escalate to user if scope is genuinely ambiguous (e.g., ticket could be a 3 or a 13 depending on interpretation).
   ```

2. **Apply all fixes** including estimates, labels, and title improvements

3. **Mark refined** when all criteria pass:

   **GitHub (default):**
   ```bash
   gh issue edit 123 --add-label "refined"
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__ticket_transition
     id: "<TICKET_CUID>"
     to: "REFINED"
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues ticket transition TICKET_ID --to REFINED --json
   ```

### Batch Refinement (`/refine`)

**Batch limit:** Process at most 10 tickets per batch. If more than 10 unrefined tickets exist, process the first 10 (in ascending order by issue number) and inform the user how many remain.

**Processing order:** Process tickets **sequentially**, one at a time. Do not delegate multiple ticket-refiner agents in parallel — concurrent MCP tool calls can hit rate limits.

1. **Get unrefined open issues:**

   **GitHub (default):**
   ```bash
   gh issue list --state open --json number,title,labels \
     --jq '.[] | select(.labels | map(.name) | contains(["refined"]) | not) | "\(.number): \(.title)"'
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__ticket_list
     projectName: "$PROJECT"
     state: "BACKLOG"
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues ticket list --project "$PROJECT" --state BACKLOG --json
   ```

2. **For each issue** (sequentially, up to 10), delegate to ticket-refiner agent with the same instructions as single-issue mode. Wait for each agent to complete before starting the next.

3. **Present summary** of all issues reviewed and changes made. If tickets were skipped due to the batch limit, report the count remaining.

## Refinement Criteria

An issue is refined when it has ALL of:

| Criterion | GitHub Issues | Issues API |
|-----------|--------------|------------|
| Clear title | Descriptive, categorized via labels | Same |
| Acceptance criteria | Checkboxes defining "done" | `--acceptance-criteria` field |
| Estimate | `estimate:N` label (1-13) | Story points field (`--points N`) |
| Priority | `priority:high`, `priority:medium`, or `priority:low` label | Priority field (`--priority N`) |
| Type label | Label by name: bug, enhancement, etc. | Label by ID (use `mcp__issues__label_list` or `issues label list --json` to resolve) |
| Blockers linked | Via GitHub dependencies API | `issues block add --blocker X --blocked Y --json` |
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
