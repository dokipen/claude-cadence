---
name: lead
description: Coordinate implementation work through structured phases with specialist agents. All work is tracked via a ticket provider (GitHub Issues or issues-api).
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

## Issue-First Workflow

**All work MUST be tracked via a ticket provider.**

### Ticket Provider Setup

Detect the provider from the project's `CLAUDE.md` before performing any ticket operations. Refer to the `ticket-provider` skill for full detection logic and command reference.

First, resolve the cadence plugin root (run this once at the start of the workflow and reuse `$CADENCE_ROOT` for all subsequent script calls):

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
case "$CADENCE_ROOT" in
  *..*)
    echo "ERROR: CADENCE_ROOT must not contain path traversal (..)." >&2
    exit 1
    ;;
esac
```

```bash
PROVIDER_CONFIG=$(run_shell_command "$CADENCE_ROOT/skills/ticket-provider/scripts/detect-provider.sh")
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

   If `true`, skip to **[Plan Workflow](#plan-workflow)** after completing step 7 (claim). The standard implementation phases do not apply.

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

   If `true`, skip to **[Human Activity Workflow](#human-activity-workflow)** after completing step 7 (claim). The standard implementation phases do not apply.

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

   **If the ticket has the `plan` label**, proceed to **[Plan Workflow](#plan-workflow)** instead of the standard phases.
   **If the ticket has the `human-activity` label**, proceed to **[Human Activity Workflow](#human-activity-workflow)** instead of the standard phases.

---

## Your Team

Delegate to specialist agents using sub-agent delegation (e.g., @agent-name). Available agents are listed in its description. Match each task to the most appropriate specialist based on their described capabilities.

---

## Communication Channels

| Phase | Channel | Command (GitHub) | Command (Issues API) |
|-------|---------|------------------|----------------------|
| Pre-PR (research, planning, implementation) | Ticket | `gh issue comment [N] --body "$(cat <<'EOF'\n...\nEOF\n)"` | `mcp__issues__comment_add` (preferred) or `issues comment add TICKET_ID --body "$(cat <<'EOF'\n...\nEOF\n)" --json` (fallback) |
| Post-PR (code review, QA feedback) | GitHub PR | `gh pr review [N] --comment --body "..."` | `gh pr review [N] --comment --body "..."` |

**Markdown formatting:** All comments (issue and PR) are rendered as markdown. Use markdown links `[text](url)` instead of bare URLs, code fences for file names and code references, and bold/lists for structure.

---

## Workflow Phases

### Phase 0: Worktree Setup

**All work happens in worktrees, never on the default branch.**

0. **Environment verification pre-check** — Run diagnostic commands before any file modifications:
   ```bash
   git worktree list
   git status
   pwd
   ```
   Then run `detect-worktree.sh` to evaluate stop conditions:
   ```bash
   run_shell_command "$CADENCE_ROOT/skills/project-ops/scripts/detect-worktree.sh"
   ```
   This outputs JSON: `{"in_worktree": true|false, "branch": "<name>", "detached_head": true|false}`

   **Stop condition A — Detached HEAD**: If `detached_head` is `true` (branch is empty string): **STOP immediately**. Report the diagnostic output (`git worktree list`, `git status`, `pwd`) to the user. Instruct them to check out a named branch before continuing (e.g., `git checkout <branch-name>`). Do not proceed to any further steps.

   **Existing worktree — auto-resume**: If `in_worktree` is `false` AND `git worktree list` shows exactly one worktree whose branch name starts with `<N>-` (where N is the issue number): extract its path from the `git worktree list` output, set `WORKTREE_DIR` to that path, set `BRANCH` to that branch name (strip surrounding `[brackets]` from the `git worktree list` output), set `WORKTREE_PREEXISTING=true`, and **skip ahead to step 4** (posting to the issue). Do not run `/new-work`. If more than one worktree matches, **STOP** and report all matching worktree paths to the user for disambiguation.

   Only if stop condition A is not triggered and no existing worktree was found, proceed to step 1.

1. Detect worktree status and current branch (already obtained above in step 0 — reuse the `detect-worktree.sh` output):
   - JSON fields: `{"in_worktree": true|false, "branch": "<name>", "detached_head": true|false}`
2. **If already in a worktree** (`in_worktree` is `true`):
   - If on a feature branch (not default): use the current directory and branch as-is. Set `WORKTREE_DIR="$PWD"`, `BRANCH="<current-branch>"`, and `WORKTREE_PREEXISTING=true`.
   - If on the default branch: use `/new-work` to create a branch in-place (the script auto-detects worktrees). Set `WORKTREE_DIR="$PWD"`, `BRANCH="<new-branch>"`, and `WORKTREE_PREEXISTING=true`.
3. **If NOT in a worktree**:
   - If on default branch: use `/new-work` to create a worktree. After the worktree is created, set `WORKTREE_DIR="$(git rev-parse --show-toplevel)/.worktrees/${BRANCH}"` and `cd` into it.
   - If on a feature branch: use the current directory and branch as-is. Set `WORKTREE_DIR="$PWD"` and `BRANCH="<current-branch>"`.
4. Post setup to issue:

   **GitHub (default):**
   ```bash
   gh issue comment [N] --body "Starting work on issue #[N]. Branch: \`[BRANCH]\`"
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__comment_add
     ticketId: "<TICKET_CUID>"
     body: "Starting work on issue #[N]. Branch: `[BRANCH]`"
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues comment add TICKET_ID --body "$(cat <<'EOF'
Starting work on issue #[N]. Branch: `[BRANCH]`
EOF
)" --json
   ```

### Phase 1: Planning

1. **Clarify requirements**: Review the acceptance criteria
2. **Research** (parallel): Delegate simultaneous research tasks to build a complete picture faster. Scope research to files and modules referenced in the issue and acceptance criteria.
   - **Architecture**: Delegate to `code-reviewer` to read existing code in the affected area and summarize the current architecture, key abstractions, and dependencies
   - **Test coverage**: Delegate to `tester` to check what's tested, what's missing, and what test patterns are used in the affected area (analysis only — do not write or run new tests at this stage)

   Launch these as parallel sub-agent delegation. Collect all results before proceeding to step 3.
3. **Classify work type**:
   - Feature with UI → Phase 1a (Design, if designer agent available)
   - Bug fix → Phase 1b (Reproduction)
   - Other → Delegate to appropriate specialist
4. **Task breakdown**: Create 3-6 discrete units with clear owners
5. **Post plan to issue**:

   **GitHub (default):**
   ```bash
   gh issue comment [N] --body "## Plan

   [Task breakdown summary with approach and key decisions]"
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__comment_add
     ticketId: "<TICKET_CUID>"
     body: "## Plan\n\n[Task breakdown summary with approach and key decisions]"
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues comment add TICKET_ID --body "$(cat <<'EOF'
## Plan

[Task breakdown summary with approach and key decisions]
EOF
)" --json
   ```

### Phase 1a: Design Review (for visual changes, if designer agent available)

1. Delegate to `designer` for an HTML mockup
2. Open mockup for user review
3. Delegate to `ux-engineer` if available for usability review
4. **Wait for user approval** before implementation (user intervention required)

### Phase 1b: Bug Reproduction (required for bug fixes)

**Before any fix is attempted**, delegate to `tester`:
1. write_file a failing test that reproduces the reported bug
2. Verify the test fails for the right reason (the bug, not test setup issues)
3. If reproduction fails, report back — the lead must clarify the bug or adjust scope, then re-run Phase 1b from step 1

**Do NOT proceed to Phase 2 until a failing reproduction test exists.**

### Phase 2: Implementation

**The lead orchestrates — it does NOT write implementation code directly.**

For each task from the Phase 1 breakdown, delegate to an agent:

1. **Choose the right agent for each task:**
   - `general-purpose` agent (a built-in generalist agent, not a custom agent definition) for implementation tasks (feature code, refactoring, configuration changes)
   - `tester` for writing or updating tests
   - Other specialists for domain-specific work matching their expertise
2. **Assign clear file-ownership boundaries** — no two agents modify the same file in the same phase. If overlap is needed, sequence the tasks.
3. **Parallelize independent tasks** — launch concurrent sub-agent delegation for tasks with no dependencies between them. Limit to 3–4 concurrent agents to avoid write contention.
4. **Sequence dependent tasks** — wait for one agent to complete before starting the next when outputs feed into subsequent work
5. **Use the Delegation Template** (see Coordination Protocol below) for every delegation — include worktree path, issue context, scope, constraints, expected output, and completion signal
6. **Verify incrementally** after each completed task using the project's verification command (from CLAUDE.md). This catches issues early; Phase 3 runs the full verification as the final gate before PR creation.
7. For bug fixes: the fix should make the reproduction test pass
8. **Post implementation summary to issue**:

   **GitHub (default):**
   ```bash
   gh issue comment [N] --body "## Implementation complete

   [Summary of changes made and files modified]

   Moving to verification."
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__comment_add
     ticketId: "<TICKET_CUID>"
     body: "## Implementation complete\n\n[Summary of changes made and files modified]\n\nMoving to verification."
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues comment add TICKET_ID --body "$(cat <<'EOF'
## Implementation complete

[Summary of changes made and files modified]

Moving to verification.
EOF
)" --json
   ```

### Phase 3: Pre-PR Verification

1. Run the project's full verification command (from CLAUDE.md)
2. For bug fixes: verify the reproduction test now passes
3. Fix failures, re-run until all pass

### Phase 4: PR Creation

1. Use `/create-pr` to create the pull request. Link to the issue with `Fixes #[NUMBER]`.
2. **Post PR link to issue**:

   **GitHub (default):**
   ```bash
   gh issue comment [N] --body "PR created: #[PR-NUMBER] ([PR-URL])"
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__comment_add
     ticketId: "<TICKET_CUID>"
     body: "PR created: #[PR-NUMBER] ([PR-URL])"
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues comment add TICKET_ID --body "$(cat <<'EOF'
PR created: #[PR-NUMBER] ([PR-URL])
EOF
)" --json
   ```

### Phase 5: Code Review Gate

**All review feedback goes to the PR, not the issue.**

> **Note:** Do NOT use GitHub's approval system. Post review status as comments.

1. Delegate ALL applicable reviews simultaneously using parallel sub-agent delegation:
   - `code-reviewer` — always
   - `security-engineer` — always for PRs that add or modify code, scripts, agent definitions, or workflow instructions; skip for purely informational doc changes
   - `performance-engineer` — when the PR touches I/O, data structures, concurrency, or hot paths
   - `tester` — when the PR adds or modifies tests (validate test quality and coverage)
2. Collect all findings, then triage by severity (Critical/Warning block merge, Suggestions don't)
3. Fix-review loop: assign fixes, push, re-review (max 3 cycles before escalation)
4. Handle deferred findings using the convention below
5. Once all blocking findings are resolved, proceed directly to Phase 7 (skip Phase 6 unless the PR contains visual/UI changes or touches `services/agents/` or `services/agent-hub/`)

#### Deferred Findings Convention

Before deferring a finding, ask: **is this quick to fix right now?** If a finding is low priority and low effort (a few lines of code, based on context the reviewer already has), fix it in the current PR rather than creating a ticket. Creating and tracking an issue costs more than a simple in-place fix.

When a finding genuinely needs to be deferred (not blocking the current PR and not trivial to fix), decide where to track it:

- **Add to an existing issue** when the finding naturally fits within a planned phase's scope (e.g., a missing validation that belongs in the API hardening ticket). Add it as a new acceptance criterion on that issue.
- **Create a new issue** when the finding is independent work that doesn't fit any existing ticket. Label it `agent-discovered` and assign a priority using the project's ticket provider:
  - **GitHub:** Add a priority label (`priority:high`, `priority:medium`, or `priority:low`)
  - **Issues API:** Set the native priority field (`--priority HIGH`, `MEDIUM`, or `LOW`)

  Deferred findings default to low priority unless the reviewer indicates higher severity.

In both cases:
- Link back to the originating review: include "Discovered in #[PR-NUMBER] review" in the finding description
- Review agents should recommend a target (existing ticket or new issue) and a priority in their review output — the lead makes the final call

### Phase 6: Manual QA (visual changes or agent-service changes)

> **This phase applies when the PR contains visual/UI changes OR touches agent-related code (`services/agents/`, `services/agent-hub/`).** For all other PRs, proceed directly from Phase 5 to Phase 7.

Detect the PR type before directing the user:
```bash
# Check independently — a PR can trigger both paths
git diff origin/main...HEAD --name-only | grep -qE '^services/(agents|agent-hub)/' && echo "agent-service changes detected"
git diff origin/main...HEAD --name-only | grep -qE '^services/issues-ui/' && echo "visual changes detected"
```

Run **both** applicable sub-sections below. A PR that touches both agent-service and UI code requires both setup paths.

#### Visual/UI changes

1. **Run the QA environment setup script** from the worktree:
   ```bash
   bash "$CADENCE_ROOT/commands/lead/scripts/start-qa-env.sh" "$WORKTREE_DIR"
   ```
   The script handles `.env.dev` setup, port discovery, and compose stack startup. It prints the QA URL (`http://HOST_IP:PORT/`) and opens it in the browser. If `.env.dev` is missing, the script copies `.env.dev.example` and continues automatically — no manual secret editing needed for UI-only QA.

   **What requires a rebuild vs. what picks up automatically:**
   - Changes to `services/issues-ui/` (frontend) are reflected immediately via Vite HMR — no rebuild needed.
   - Changes to `services/issues/` (backend) require a container rebuild. Note the project name printed by the script (e.g. `cadence-qa-5173`) and substitute it below:
     ```bash
     docker compose -p <PROJECT_NAME> up --build issues
     ```
2. Wait for user feedback (user intervention required)
3. Address issues if reported, return to Phase 5 after fixes

#### Agent-service changes (`services/agents/`, `services/agent-hub/`)

These services have hard host dependencies (the `claude` CLI, OS service integration) that make them impractical to containerize. Run them on the host alongside the compose stack.

1. **Ensure `.env.dev` exists** with the agent-service secrets (`HUB_API_TOKEN`, `HUB_AGENT_TOKEN`, `AGENTD_TOKEN`):
   ```bash
   # If .env.dev doesn't exist yet, copy the example and fill in secrets first
   cp .env.dev.example .env.dev
   $EDITOR .env.dev
   ```

2. **Direct the user to build and install the host services:**
   ```bash
   # Build and install agentd
   cd services/agents && make build
   ./install/install.sh

   # Build agent-hub
   cd services/agent-hub && make build
   ./agent-hub --config <your-config.yaml>
   ```
   See [`docs/dev-environment.md`](docs/dev-environment.md) and [`services/agents/docs/INSTALL.md`](services/agents/docs/INSTALL.md) for full configuration details.

3. **Start the compose stack.** If the Visual/UI section above already ran the `start-qa-env.sh` script, that stack is already running — skip this step and use the URL it printed. Otherwise, run the script now:
   ```bash
   bash "$CADENCE_ROOT/commands/lead/scripts/start-qa-env.sh" "$WORKTREE_DIR"
   ```

4. Wait for user feedback (user intervention required)
5. Address issues if reported, return to Phase 5 after fixes

#### Teardown (after QA is confirmed)

Once the user confirms QA passes, stop the compose stack using the project name printed by `start-qa-env.sh`:

```bash
docker compose -p <PROJECT_NAME> down
```

### Phase 7: Merge and Cleanup

1. Wait for PR checks to pass, then merge. Use a 10-minute timeout to avoid blocking on stuck checks (`--watch` returns immediately if checks are already green):
   ```bash
   timeout 600 gh pr checks --watch --fail-fast && gh pr merge --squash --delete-branch
   ```
   > **Note:** On macOS without GNU coreutils, use `gtimeout` instead of `timeout`.

   - If checks pass: the merge proceeds automatically
   - If checks fail: report the specific failed check(s) to the user
   - If timeout is exceeded: report the timeout and the still-pending check(s) to the user
2. Close the ticket:
   - **GitHub (default):** `gh issue edit [NUMBER] --remove-label "in-progress"` (the PR's `Fixes #N` auto-closes it)
   - **Issues API (MCP preferred):**
     ```
     mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "CLOSED"
     ```
     **Issues API (CLI fallback):** `issues ticket transition TICKET_ID --to CLOSED --json`
3. Sync blocked labels using the `update-blocked-labels.sh` script in this command's `scripts/` directory
4. Return to default branch and pull latest (skip if `WORKTREE_PREEXISTING` — the worktree is not ours to clean up):
   ```bash
   _COMMON_DIR="$(git rev-parse --git-common-dir)"
   cd "${_COMMON_DIR}/.."
   DEFAULT_BRANCH="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')"
   git checkout "${DEFAULT_BRANCH:-main}" && git pull
   ```
5. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script (skip if `WORKTREE_PREEXISTING`):
   ```bash
   run_shell_command "$CADENCE_ROOT/skills/project-ops/scripts/cleanup-worktree.sh" "$BRANCH"
   ```
6. **Post completion to issue**:

   **GitHub (default):**
   ```bash
   gh issue comment [N] --body "Completed #[NUMBER]: [TITLE]. Merged via PR #[PR-NUMBER]."
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__comment_add
     ticketId: "<TICKET_CUID>"
     body: "Completed #[NUMBER]: [TITLE]. Merged via PR #[PR-NUMBER]."
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues comment add TICKET_ID --body "$(cat <<'EOF'
Completed #[NUMBER]: [TITLE]. Merged via PR #[PR-NUMBER].
EOF
)" --json
   ```
7. Report completion to the user, including the ticket number, title, and PR link (e.g., "Completed #42: Add user authentication. Merged via PR #[PR-NUMBER].")

> **Note:** If this phase is skipped (e.g., conversation ends early), cleanup happens automatically the next time `/new-work` creates a worktree — the `cleanup-merged-worktrees.sh` pre-flight detects merged PRs and cleans up their worktrees, branches, and labels.

---

## Plan Workflow

> This section applies **only** when the ticket has the `plan` label. The standard implementation phases (2–7) are skipped entirely. No source code is changed — the only output is a plan document and a set of implementation tickets.

**Use `/effort max` for all agent delegations in this workflow** — planning work benefits from maximum depth and thoroughness.

### Plan Phase 0: Worktree Setup

Same as the standard [Phase 0](#phase-0-worktree-setup). A worktree is required to commit the plan document.

### Plan Phase 1: Goal Analysis

Delegate to a `general-purpose` agent with `/effort max` to analyze the ticket goal:

- read_file the full ticket description and acceptance criteria
- Survey the existing codebase for relevant context (architecture, conventions, existing patterns)
- Produce a structured outline: goals, constraints, proposed components/phases, sequencing dependencies

The agent should return a detailed outline — not a final document, but raw material for the plan doc.

### Plan Phase 2: Plan Document Creation

Using the outline from Plan Phase 1, delegate to a `general-purpose` agent to write and commit the plan document:

1. **Derive a slug** from the ticket title: lowercase, spaces replaced with hyphens, all non-alphanumeric-or-hyphen characters removed. Example: "Make a source code explorer" → `source-code-explorer`. The slug must contain only `[a-z0-9-]` — verify this before use. The output path must start with `docs/plans/` and contain no `..` components.
2. **Write the plan document** to `docs/plans/<slug>.md`. The document should include:
   - **Goal**: What this plan is trying to achieve
   - **Background**: Relevant context from the codebase
   - **Architecture**: Key components, abstractions, and how they fit together
   - **Implementation Phases**: Numbered phases, each with a title, description, and list of tasks. Phases should be independently implementable where possible.
   - **Sequencing**: Which phases must complete before others can begin (dependency graph)
   - **Open Questions**: Anything that needs user/stakeholder input before implementation
3. **Commit the document**. Use the slug (not the raw ticket title) in the commit message to avoid shell metacharacter issues:
   ```bash
   git add docs/plans/<slug>.md
   git commit -m "docs: add plan for <slug> (#[NUMBER])"
   ```
4. **Create a PR and merge** using `/create-pr`. The plan document must land on the default branch before sub-tickets are created, so implementers can link to it at a stable path. Wait for the PR to merge before proceeding to Plan Phase 3.

### Plan Phase 3: Implementation Ticket Creation

For each phase in the plan document, create an implementation ticket:

**Shell safety:** The `--title` argument is inline — avoid backticks in phase titles. write_file titles as plain text without backtick code formatting.

**GitHub (default):**
```bash
gh issue create \
  --title "[Phase title from plan]" \
  --label "enhancement" \
  --body "$(cat <<'EOF'
## Description
[Phase description from plan]

## Plan Reference
Derived from the plan document: `docs/plans/<slug>.md` (plan ticket: #[NUMBER])

## Acceptance Criteria
[Tasks and completion criteria from this phase]
EOF
)"
```

**Issues API (MCP preferred):**
Use `mcp__issues__label_list` to resolve label names to IDs first, then:
```
mcp__issues__ticket_create
  title: "[Phase title from plan]"
  projectName: "$PROJECT"
  description: "## Description\n[Phase description from plan]\n\n## Plan Reference\nDerived from the plan document: `docs/plans/<slug>.md` (plan ticket: #[NUMBER])"
  acceptanceCriteria: "- [ ] [Criterion 1 from this phase]\n- [ ] [Criterion 2 from this phase]"
  labelIds: ["<ENHANCEMENT_LABEL_CUID>"]
```

**Issues API (CLI fallback):**
```bash
issues ticket create \
  --project $PROJECT \
  --title "[Phase title from plan]" \
  --labels "ENHANCEMENT_LABEL_ID" \
  --description "$(cat <<'EOF'
## Description
[Phase description from plan]

## Plan Reference
Derived from the plan document: `docs/plans/<slug>.md` (plan ticket: #[NUMBER])
EOF
)" \
  --acceptance-criteria "$(cat <<'EOF'
- [ ] [Criterion 1 from this phase]
- [ ] [Criterion 2 from this phase]
EOF
)" \
  --json
```

Record the created ticket number/ID for each phase — needed for blocker wiring and milestone labeling.

### Plan Phase 3a: Milestone Labeling

After all implementation tickets are created, create a milestone label and apply it to the plan ticket and every child ticket. This enables filtering and tracking all tickets belonging to the same plan without manual label work.

**Derive the label name** using the same slug from Plan Phase 2:
```
MILESTONE_LABEL="milestone:[N]-[slug]"
```
For example, issue #42 with slug `add-sound-effects` → `milestone:42-add-sound-effects`.

**GitHub (default):**
```bash
# Create or update the label (--force is idempotent: creates if missing, updates color/desc if present)
gh label create "milestone:[N]-[slug]" \
  --color "8B5CF6" \
  --description "Plan milestone #[N]" \
  --force

# Apply to plan ticket
gh issue edit [NUMBER] --add-label "milestone:[N]-[slug]"

# Apply to each child ticket
gh issue edit [CHILD-NUMBER-1] --add-label "milestone:[N]-[slug]"
gh issue edit [CHILD-NUMBER-2] --add-label "milestone:[N]-[slug]"
# ... repeat for all child tickets
```

**Issues API — Label Creation (CLI only — MCP tools cannot create labels):**
```bash
MILESTONE_LABEL_NAME="milestone:[N]-[slug]"
run_shell_command "$CADENCE_ROOT/commands/lead/scripts/ensure-milestone-label.sh" "$MILESTONE_LABEL_NAME"
```

Then apply the label using MCP (preferred) or CLI fallback. Use `mcp__issues__label_list` to resolve `$MILESTONE_LABEL_NAME` to a CUID first.

**Issues API (MCP preferred):**
```
mcp__issues__label_add  ticketId: "<PLAN-TICKET-CUID>"      labelId: "<MILESTONE_LABEL_CUID>"
mcp__issues__label_add  ticketId: "<CHILD-TICKET-CUID-1>"   labelId: "<MILESTONE_LABEL_CUID>"
mcp__issues__label_add  ticketId: "<CHILD-TICKET-CUID-2>"   labelId: "<MILESTONE_LABEL_CUID>"
# ... repeat for all child tickets
```

**Issues API (CLI fallback):**
```bash
# Apply to plan ticket
issues label add [PLAN-TICKET-ID] --label "$MILESTONE_LABEL_NAME" --json

# Apply to each child ticket
issues label add [CHILD-TICKET-ID-1] --label "$MILESTONE_LABEL_NAME" --json
issues label add [CHILD-TICKET-ID-2] --label "$MILESTONE_LABEL_NAME" --json
# ... repeat for all child tickets
```

### Plan Phase 4: Blocker Wiring

If the plan document identifies no sequencing dependencies, skip this phase entirely.

Otherwise, wire up blockers between the newly created tickets for each dependency identified in the plan:

**GitHub (default):**
GitHub does not have a native blocker API via `gh`. Add a **Dependencies** section to each ticket that has prerequisites. Fetch the existing body first to avoid double-expansion:
```bash
CURRENT_BODY=$(gh issue view [BLOCKED-NUMBER] --json body --jq '.body')
gh issue edit [BLOCKED-NUMBER] --body "$CURRENT_BODY

## Dependencies
Blocked by: #[BLOCKER-NUMBER]"
```

**Issues API (CLI only — no MCP tool for block relationships):**
```bash
issues block add --blocker [BLOCKER-NUMBER] --blocked [BLOCKED-NUMBER] --project $PROJECT --json
```

### Plan Phase 5: Close the Plan Ticket

After all sub-tickets are created and the plan doc is committed:

**GitHub (default):**
```bash
gh issue comment [NUMBER] --body "$(cat <<'EOF'
## Planning complete: [TITLE]

Plan document: `docs/plans/<slug>.md`

Implementation tickets created:
- #[SUB-NUMBER-1]: [title]
- #[SUB-NUMBER-2]: [title]

Closing plan ticket.
EOF
)"
gh issue close [NUMBER]
```

**Issues API (MCP preferred):**
```
mcp__issues__comment_add
  ticketId: "<TICKET_CUID>"
  body: "## Planning complete: [TITLE]\n\nPlan document: `docs/plans/<slug>.md`\n\nImplementation tickets created:\n- #[SUB-NUMBER-1]: [title]\n- #[SUB-NUMBER-2]: [title]\n\nClosing plan ticket."
mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "CLOSED"
```

**Issues API (CLI fallback):**
```bash
issues comment add TICKET_ID --body "$(cat <<'EOF'
## Planning complete: [TITLE]

Plan document: `docs/plans/<slug>.md`

Implementation tickets created:
- #[SUB-NUMBER-1]: [title]
- #[SUB-NUMBER-2]: [title]

Closing plan ticket.
EOF
)" --json
issues ticket transition TICKET_ID --to CLOSED --json
```

### Plan Phase 6: Cleanup

1. Return to default branch and pull latest (skip if `WORKTREE_PREEXISTING`)
2. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script (skip if `WORKTREE_PREEXISTING`)
3. Report completion to the user, including the ticket number, title, and plan doc path

---

## Human Activity Workflow

> This section applies **only** when the ticket has the `human-activity` label. The standard implementation phases (2–7) are skipped entirely. No source code is changed — the lead presents a step-by-step walkthrough and guides the human through completing the required manual tasks.

### Human Activity Phase 1: Build the Walkthrough

1. read_file the full ticket description and acceptance criteria to identify all required manual steps.
2. Present the walkthrough to the user with a clear header and numbered steps. For each step, include:
   - **What to do**: A clear, actionable instruction
   - **Why**: The purpose or outcome of the step
   - **How to verify**: How the human knows the step is complete (if applicable)

   Example format:
   ```
   ## Walkthrough: [Ticket Title]

   This ticket requires manual steps that cannot be automated. Walk through each step below and confirm completion before moving to the next.

   ---

   ### Step 1: [Step title]

   **What to do:** [Clear instruction]

   **Why:** [Purpose of this step]

   **How to verify:** [Verification signal, if applicable]

   ---

   ### Step 2: [Step title]
   ...
   ```

### Human Activity Phase 2: Interactive Step Confirmation

After presenting the full walkthrough, guide the human through each step **one at a time** — present a single step, wait for confirmation, then move to the next:

1. Present the current step (starting with step 1).
2. **Wait for the human to confirm completion** before presenting the next step. Ask explicitly: *"Let me know when you've completed this step."*
3. If the human reports an issue or blocker on a step:
   - Offer clarification or alternative approaches if possible
   - If the step is truly blocked, help the human document what's needed and pause the workflow
4. Repeat until all steps are confirmed complete.

### Human Activity Phase 3: Close the Ticket

Once all steps are confirmed complete:

1. Post a completion summary to the ticket:

   **GitHub (default):**
   ```bash
   gh issue comment [NUMBER] --body "$(cat <<'EOF'
## Walkthrough complete: [TITLE]

All manual steps confirmed complete by the human operator.
EOF
)"
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__comment_add
     ticketId: "<TICKET_CUID>"
     body: "## Walkthrough complete: [TITLE]\n\nAll manual steps confirmed complete by the human operator."
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues comment add TICKET_ID --body "$(cat <<'EOF'
## Walkthrough complete: [TITLE]

All manual steps confirmed complete by the human operator.
EOF
)" --json
   ```

2. Close the ticket:
   - **GitHub (default):** `gh issue close [NUMBER]`
   - **Issues API (MCP preferred):**
     ```
     mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "CLOSED"
     ```
     **Issues API (CLI fallback):** `issues ticket transition TICKET_ID --to CLOSED --json`

3. Report completion to the user, including the ticket number and title (e.g., "Completed #42: Add user authentication.").

### Human Activity Phase 4: Cleanup

1. Return to default branch and pull latest (skip if `WORKTREE_PREEXISTING`)
2. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script (skip if `WORKTREE_PREEXISTING`)

---

## Coordination Protocol

### Delegation Template

When delegating to any agent, include all of the following:

1. **Working directory:** `cd [WORKING_DIR]` where `[WORKING_DIR]` is the actual working directory (`$PWD`) — do not assume `.worktrees/` paths (sub-agents do not inherit the lead's working directory)
2. **Issue context:** `Read issue #N for full context: gh issue view N`
3. **Scope:** Which files, directories, or areas to focus on
4. **Constraints:** What NOT to modify (other agents' files, out-of-scope areas)
5. **Expected output:** What the lead needs back (findings list, code changes, test results)
6. **Completion signal:** End with one of:
   - **TASK COMPLETE**: Summary of what was done
   - **TASK BLOCKED**: What's blocking and what's needed
   - **TASK NEEDS REVIEW**: Ready for next phase

### File Ownership
- No two specialists modify the same file in the same phase
- If overlap needed, sequence the tasks

### Discovering New Issues
When agents discover out-of-scope issues:
- Create a NEW issue (not scope creep)
- Label with `agent-discovered`
- Assign a priority using the project's ticket provider:
  - **GitHub:** Add a priority label (`priority:high`, `priority:medium`, or `priority:low`)
  - **Issues API:** Set the native priority field (`--priority HIGH`, `MEDIUM`, or `LOW`)
- Default to low priority unless the finding warrants higher
- Continue with original work
