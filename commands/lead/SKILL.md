---
name: lead
description: Coordinate implementation work through structured phases with specialist agents. All work is tracked via a ticket provider (GitHub Issues or issues-api).
disable-model-invocation: true
---

# Lead Workflow

You are now acting as the technical lead, coordinating specialist agents on this task.

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

**Autonomy principle:** Drive through all phases without pausing for confirmation. Only interrupt the user when:
- Acceptance criteria are ambiguous and you cannot resolve them from context
- A decision requires user judgement (e.g., breaking down a large issue, choosing between approaches)
- Manual QA is needed (Phase 6, visual changes or agent-service changes)
- A phase is blocked and you cannot unblock it yourself

**Completion rule:** Do not treat "implementation done", "tests passed", "status update sent", or "PR created" as stopping points. `/lead` is complete only when the workflow reaches its terminal phase:
- Standard implementation workflow: finish through **Phase 7: Merge and Cleanup**
- `plan` workflow: finish through the plan workflow cleanup/reporting steps
- `human-activity` workflow: finish through the walkthrough cleanup/reporting steps

**Continuation guardrail:** If you are an agent that tends to pause after making code changes, after posting a progress update, or after answering a brief user question like "how's it going?", explicitly resume at the next unfinished `/lead` phase instead of waiting for another instruction. Brief conversational replies are status updates, not stop conditions.

## Issue-First Workflow

**All work MUST be tracked via a ticket provider.**

### Ticket Provider Setup

Detect the provider from the project's `CLAUDE.md` before performing any ticket operations. Refer to the `ticket-provider` skill for full detection logic and command reference.

First, check if `$CADENCE_ROOT` is already set (run once at the start of the workflow; reuse for all subsequent script calls):

```bash
echo "${CADENCE_ROOT:-}"
```

If the output is empty, resolve it:

```bash
# Resolve cadence plugin root. Checks (in order):
# 1. Current directory (running directly from the cadence repo)
# 2. .claude/plugins/cadence/ (locally installed plugin)
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
  *..*)
    echo "ERROR: CADENCE_ROOT must not contain path traversal (..)." >&2
    exit 1
    ;;
esac
PROVIDER_CONFIG=$(bash "$CADENCE_ROOT/skills/ticket-provider/scripts/detect-provider.sh")
PROVIDER=$(echo "$PROVIDER_CONFIG" | jq -r '.provider')
PROJECT=$(echo "$PROVIDER_CONFIG" | jq -r '.project')
```

If `PROVIDER` is `github` (or unset), use `gh issue` commands. If `issues-api`, use `issues` CLI commands. **PR operations always use `gh` CLI regardless of provider.**

To target a QA or local `issues-api` instance without modifying `CLAUDE.md`, prefix the invocation with `ISSUES_API_URL`:
```bash
ISSUES_API_URL=http://192.168.1.100:5173/graphql /lead 123
```
This overrides the `api_url` configured in `CLAUDE.md`. Has no effect when provider is `github`.

### Before Any Work Begins

For provider-specific command syntax in the steps below, refer to the ticket-provider skill.

1. **Search for existing issue** (see ticket-provider skill — **Search / List Tickets** operation).

2. **If issue exists**: View it to verify acceptance criteria (see ticket-provider skill — **View Ticket** operation). Save the output as `$TICKET_JSON` — reused for label detection in step 5.

3. **If no issue exists**: Create one with a descriptive title and initial context (see ticket-provider skill — **Create Ticket** operation). **Shell safety:** Avoid backticks in the title.

4. **Ensure issue is refined**: View the ticket (see ticket-provider skill — **View Ticket** operation).
   - **GitHub:** If the `refined` label is missing, run `/refine [NUMBER]` before proceeding.
   - **Issues API:** If `state` is not `REFINED` (or later), run `/refine [NUMBER]` before proceeding.

5. **Detect ticket type**: Check if the ticket has a special workflow label.

   **Check for `plan` label:**

   **GitHub (default):**
   ```bash
   gh issue view [NUMBER] --json labels --jq '[.labels[].name] | contains(["plan"])'
   ```
   Returns `true` if the `plan` label is present.

   **Issues API (jq parse — reuse JSON from step 2, no API call):**
   ```bash
   echo "$TICKET_JSON" | jq '[.labels[].name] | contains(["plan"])'
   ```
   Returns `true` if the `plan` label is present.

   If `true`, skip to **[Plan Workflow](plan-workflow.md)** after completing step 7 (claim). The standard implementation phases do not apply.

   **Check for `human-activity` label:**

   **GitHub (default):**
   ```bash
   gh issue view [NUMBER] --json labels --jq '[.labels[].name] | contains(["human-activity"])'
   ```
   Returns `true` if the `human-activity` label is present.

   **Issues API (jq parse — reuse JSON from step 2, no API call):**
   ```bash
   echo "$TICKET_JSON" | jq '[.labels[].name] | contains(["human-activity"])'
   ```
   Returns `true` if the `human-activity` label is present.

   If `true`, skip to **[Human Activity Workflow](human-activity-workflow.md)** after completing step 7 (claim). The standard implementation phases do not apply.

6. **Check if work is already complete**:
   Before claiming, delegate to an appropriate specialist to verify the work isn't already done.

7. **Claim the issue** (see ticket-provider skill — **Claim Ticket** operation).

---

## Your Team

Delegate to specialist agents using the Agent tool. Available agents are listed in its description. Match each task to the most appropriate specialist based on their described capabilities.

> **Note:** `cadence:issues-api` is a **model-invoked skill** (an MCP tool reference), not a specialist agent. It is never a valid `subagent_type` for the Agent tool. Only use it directly via its MCP tools (`mcp__issues__*`), not via the Agent tool.

---

## Communication Channels

| Phase | Channel | How |
|-------|---------|-----|
| Pre-PR (research, planning, implementation) | Ticket | Comment on ticket — see ticket-provider skill (**Comment** operation) |
| Post-PR (code review, QA feedback) | GitHub PR | `gh pr review [N] --comment --body "..."` |

**Markdown formatting:** All comments (issue and PR) are rendered as markdown. Use markdown links `[text](url)` instead of bare URLs, code fences for file names and code references, and bold/lists for structure.

---

## Workflow Phases

The workflow is split across sub-files. Read the relevant sub-file for full phase instructions.

- **[Phase 0: Worktree Setup](phase-0-worktree.md)** — Environment check, worktree creation, branch setup
- **[Phase 1: Planning](phase-1-planning.md)** — Requirements, research, task breakdown (includes Phase 1a: Design Review and Phase 1b: Bug Reproduction)
- **[Phases 2–7: Implementation through Merge & Cleanup](phase-2-7-implementation.md)** — Implementation, verification, PR creation, code review, QA, merge
- **[Plan Workflow](plan-workflow.md)** — For tickets with the `plan` label: goal analysis, plan document, sub-ticket creation
- **[Human Activity Workflow](human-activity-workflow.md)** — For tickets with the `human-activity` label: walkthrough and step confirmation
- **[Coordination Protocol](coordination-protocol.md)** — Delegation template, file ownership, discovering new issues
