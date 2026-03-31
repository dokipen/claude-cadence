---
name: lead
description: Coordinate implementation work through structured phases with specialist agents. All work is tracked via a ticket provider (GitHub Issues or issues-api).
disable-model-invocation: true
---

# Lead Workflow

You are now acting as the technical lead, coordinating specialist agents on this task.

## Filesystem Scope

> **IMPORTANT:** Only access files within the project repository (the directory containing `CLAUDE.md`). This applies to all tools — `Read`, `Glob`, `Grep`, and `Bash` alike. Never run Bash commands (e.g., `find`, `cat`, `ls`) targeting paths outside the repository, and never use absolute paths to home directories or system paths. Do not use `$HOME`, `~`, or any environment variable that may expand to a path outside the project repository (e.g., `$XDG_CONFIG_HOME`, `$TMPDIR`, `$XDG_DATA_HOME`, `$XDG_RUNTIME_DIR`, `$XDG_CACHE_HOME`, `$PATH`, `$SHELL`, `$OLDPWD`), do not use path traversal (e.g., `../`) to navigate above the repo root, do not run `readlink` or `realpath` on paths that would resolve outside the project directory, do not follow symlinks that lead outside the project directory, do not use `printenv` or `env` to read environment variables as path components, do not use `which`, `command -v`, or `type` to locate system tools, and do not use command substitution with any of these commands to construct file paths (e.g., `$(which python3)`, `$(printenv GOPATH)/src`, `$(command -v git)`). Use relative paths and `Glob`/`Grep` within the project directory.

**Autonomy principle:** Drive through all phases without pausing for confirmation. Only interrupt the user when:
- Acceptance criteria are ambiguous and you cannot resolve them from context
- A decision requires user judgement (e.g., breaking down a large issue, choosing between approaches)
- Manual QA is needed (Phase 6, visual changes or agent-service changes)
- A phase is blocked and you cannot unblock it yourself

**Completion rule:** Do not treat "implementation done", "tests passed", "status update sent", or "PR created" as stopping points. `/lead` is complete only when the workflow reaches its terminal phase:
- Standard implementation workflow: finish through **Phase 7: Merge and Cleanup**
- `plan` workflow: finish through the plan workflow cleanup/reporting steps
- `human-activity` workflow: finish through the walkthrough cleanup/reporting steps

**Codex guardrail:** If you are an agent that tends to pause after making code changes, after posting a progress update, or after answering a brief user question like "how's it going?", explicitly resume at the next unfinished `/lead` phase instead of waiting for another instruction. Brief conversational replies are status updates, not stop conditions.

## Issue-First Workflow

**All work MUST be tracked via a ticket provider.**

### Ticket Provider Setup

Detect the provider from the project's `CLAUDE.md` before performing any ticket operations. Refer to the `ticket-provider` skill for full detection logic and command reference.

First, resolve the cadence plugin root (run this once at the start of the workflow and reuse `$CADENCE_ROOT` for all subsequent script calls):

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
```

```bash
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

1. **Search for existing issue**:

   **GitHub (default):**
   ```bash
   gh issue list --search "[relevant keywords]" --state open
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__ticket_list
     projectName: "$PROJECT"
     labelNames: ["[relevant label]"]
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues ticket list --project $PROJECT --label "[relevant label]" --json
   ```

2. **If issue exists**: Verify it has clear acceptance criteria

   **GitHub (default):**
   ```bash
   gh issue view [NUMBER]
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__ticket_get
     number: [NUMBER]
     projectName: "$PROJECT"
   ```
   Save the output as `$TICKET_JSON` — it is reused for label detection in step 5.

   **Issues API (CLI fallback):**
   ```bash
   TICKET_JSON=$(issues ticket view [NUMBER] --project $PROJECT --json)
   echo "$TICKET_JSON"
   ```
   Save the output as `$TICKET_JSON` — it is reused for label detection in step 5.

3. **If no issue exists**: Create one with a descriptive title and initial context. **Shell safety:** The `--title` argument is inline — avoid backticks in the title.

   **GitHub (default):**
   ```bash
   gh issue create \
     --title "Descriptive title" \
     --label "bug" \
     --body "$(cat <<'EOF'
## Description
[Clear explanation of the work]

## Notes
[Any additional context]
EOF
)"
   ```

   **Issues API (MCP preferred):**
   Use `mcp__issues__label_list` to resolve label names to IDs first, then:
   ```
   mcp__issues__ticket_create
     title: "Descriptive title"
     projectName: "$PROJECT"
     description: "## Description\n[Clear explanation of the work]\n\n## Notes\n[Any additional context]"
     labelIds: ["<BUG_LABEL_CUID>"]
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues ticket create \
     --project $PROJECT \
     --title "Descriptive title" \
     --labels "BUG_LABEL_ID" \
     --description "$(cat <<'EOF'
## Description
[Clear explanation of the work]

## Notes
[Any additional context]
EOF
)" \
     --json
   ```

4. **Ensure issue is refined**:

   **GitHub (default):**
   ```bash
   gh issue view [NUMBER] --json labels --jq '.labels[].name | select(. == "refined")'
   ```
   If the `refined` label is missing, run `/refine [NUMBER]` before proceeding.

   **Issues API (MCP preferred):**
   ```
   mcp__issues__ticket_get
     number: [NUMBER]
     projectName: "$PROJECT"
   ```
   If the `state` field is not `REFINED` (or later), run `/refine [NUMBER]` before proceeding.

   **Issues API (CLI fallback):**
   ```bash
   issues ticket view [NUMBER] --project $PROJECT --json
   ```
   If the `state` field is not `REFINED` (or later), run `/refine [NUMBER]` before proceeding.

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

7. **Claim the issue**:

   **GitHub (default):**
   ```bash
   gh issue edit [NUMBER] --add-label "in-progress"
   ```

   **Issues API (MCP preferred):**
   Check the ticket's current state first with `mcp__issues__ticket_get`. Then transition through required intermediate states:
   - If `BACKLOG`:
     ```
     mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "REFINED"
     mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "IN_PROGRESS"
     ```
   - If `REFINED`:
     ```
     mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "IN_PROGRESS"
     ```
   - If already `IN_PROGRESS` → skip the transition
   - If `CLOSED`:
     ```
     mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "BACKLOG"
     mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "REFINED"
     mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "IN_PROGRESS"
     ```

   **Issues API (CLI fallback):**
   Check the ticket's current state first with `issues ticket view`. Then transition through required intermediate states:
   - If `BACKLOG`:
     ```bash
     issues ticket transition TICKET_ID --to REFINED --json
     issues ticket transition TICKET_ID --to IN_PROGRESS --json
     ```
   - If `REFINED`:
     ```bash
     issues ticket transition TICKET_ID --to IN_PROGRESS --json
     ```
   - If already `IN_PROGRESS` → skip the transition
   - If `CLOSED`:
     ```bash
     issues ticket transition TICKET_ID --to BACKLOG --json
     issues ticket transition TICKET_ID --to REFINED --json
     issues ticket transition TICKET_ID --to IN_PROGRESS --json
     ```

   **If the ticket has the `plan` label**, proceed to **[Plan Workflow](plan-workflow.md)** instead of the standard phases.
   **If the ticket has the `human-activity` label**, proceed to **[Human Activity Workflow](human-activity-workflow.md)** instead of the standard phases.

---

## Your Team

Delegate to specialist agents using the Agent tool. Available agents are listed in its description. Match each task to the most appropriate specialist based on their described capabilities.

---

## Communication Channels

| Phase | Channel | Command (GitHub) | Command (Issues API) |
|-------|---------|------------------|----------------------|
| Pre-PR (research, planning, implementation) | Ticket | `gh issue comment [N] --body "$(cat <<'EOF'\n...\nEOF\n)"` | `mcp__issues__comment_add` (preferred) or `issues comment add TICKET_ID --body "$(cat <<'EOF'\n...\nEOF\n)" --json` (fallback) |
| Post-PR (code review, QA feedback) | GitHub PR | `gh pr review [N] --comment --body "..."` | `gh pr review [N] --comment --body "..."` |

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
