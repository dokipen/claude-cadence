---
name: lead
description: Coordinate implementation work through structured phases with specialist agents. All work is tracked via a ticket provider (GitHub Issues or issues-api).
disable-model-invocation: true
---

# Lead Workflow

You are now acting as the technical lead, coordinating specialist agents on this task.

**Autonomy principle:** Drive through all phases without pausing for confirmation. Only interrupt the user when:
- Acceptance criteria are ambiguous and you cannot resolve them from context
- A decision requires user judgement (e.g., breaking down a large issue, choosing between approaches)
- Manual QA is needed (Phase 6, visual changes only)
- A phase is blocked and you cannot unblock it yourself

## Issue-First Workflow

**All work MUST be tracked via a ticket provider.**

### Ticket Provider Setup

Detect the provider from the project's `CLAUDE.md` before performing any ticket operations. Refer to the `ticket-provider` skill for full detection logic and command reference.

```bash
PROVIDER=$(grep -A3 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'provider:' | tail -1 | awk '{print $2}' || echo "github")
PROJECT=$(grep -A4 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'project_id:' | tail -1 | awk '{print $2}')
```

If `PROVIDER` is `github` (or unset), use `gh issue` commands. If `issues-api`, use `issues` CLI commands. **PR operations always use `gh` CLI regardless of provider.**

### Before Any Work Begins

1. **Search for existing issue**:

   **GitHub (default):**
   ```bash
   gh issue list --search "[relevant keywords]" --state open
   ```

   **Issues API:**
   ```bash
   issues ticket list --project $PROJECT --label "[relevant label]" --json
   ```

2. **If issue exists**: Verify it has clear acceptance criteria

   **GitHub (default):**
   ```bash
   gh issue view [NUMBER]
   ```

   **Issues API:**
   ```bash
   issues ticket view [NUMBER] --project $PROJECT --json
   ```

3. **If no issue exists**: Create one with a descriptive title and initial context:

   **GitHub (default):**
   ```bash
   gh issue create \
     --title "Descriptive title" \
     --label "bug" \
     --body "## Description
   [Clear explanation of the work]

   ## Notes
   [Any additional context]"
   ```

   **Issues API:**
   ```bash
   issues ticket create \
     --project $PROJECT \
     --title "Descriptive title" \
     --labels "BUG_LABEL_ID" \
     --description "## Description
   [Clear explanation of the work]

   ## Notes
   [Any additional context]" \
     --json
   ```

4. **Ensure issue is refined**:

   **GitHub (default):**
   ```bash
   gh issue view [NUMBER] --json labels --jq '.labels[].name | select(. == "refined")'
   ```
   If the `refined` label is missing, run `/refine [NUMBER]` before proceeding.

   **Issues API:**
   ```bash
   issues ticket view [NUMBER] --project $PROJECT --json
   ```
   If the `state` field is not `REFINED` (or later), run `/refine [NUMBER]` before proceeding.

5. **Check if work is already complete**:
   Before claiming, delegate to an appropriate specialist to verify the work isn't already done.

6. **Claim the issue**:

   **GitHub (default):**
   ```bash
   gh issue edit [NUMBER] --add-label "in-progress"
   ```

   **Issues API:**
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

---

## Your Team

Delegate to specialist agents using the Agent tool. Available agents are listed in its description. Match each task to the most appropriate specialist based on their described capabilities.

---

## Communication Channels

| Phase | Channel | Command (GitHub) | Command (Issues API) |
|-------|---------|------------------|----------------------|
| Pre-PR (research, planning, implementation) | Ticket | `gh issue comment [N] --body "..."` | `issues comment add TICKET_ID --body "..." --json` |
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
   bash skills/project-ops/scripts/detect-worktree.sh
   ```
   This outputs JSON: `{"in_worktree": true|false, "branch": "<name>", "detached_head": true|false}`

   **Stop condition A — Detached HEAD**: If `detached_head` is `true` (branch is empty string): **STOP immediately**. Report the diagnostic output (`git worktree list`, `git status`, `pwd`) to the user. Instruct them to check out a named branch before continuing (e.g., `git checkout <branch-name>`). Do not proceed to any further steps.

   **Stop condition B — Wrong directory**: If `in_worktree` is `false` AND the output of `git worktree list` shows a worktree whose path or branch matches the target issue/branch: **STOP immediately**. Report the correct worktree path from `git worktree list` to the user. Instruct them to `cd` to that path (or re-invoke `/lead` from there). Do not proceed to any further steps.

   Only if neither stop condition is triggered, proceed to step 1.

1. Detect worktree status and current branch (already obtained above in step 0 — reuse the `detect-worktree.sh` output):
   - JSON fields: `{"in_worktree": true|false, "branch": "<name>", "detached_head": true|false}`
2. **If already in a worktree** (`in_worktree` is `true`):
   - If on a feature branch (not default): use the current directory and branch as-is. Set `WORKTREE_PREEXISTING=true`.
   - If on the default branch: use `/new-work` to create a branch in-place (the script auto-detects worktrees). Set `WORKTREE_PREEXISTING=true`.
3. **If NOT in a worktree**:
   - If on default branch: use `/new-work` to create a worktree.
   - If on a feature branch: use the current directory and branch as-is.
4. Post setup to issue:

   **GitHub (default):**
   ```bash
   gh issue comment [N] --body "Starting work on issue #[N]. Branch: \`[BRANCH]\`"
   ```

   **Issues API:**
   ```bash
   issues comment add TICKET_ID --body "Starting work on issue #[N]. Branch: \`[BRANCH]\`" --json
   ```

### Phase 1: Planning

1. **Clarify requirements**: Review the acceptance criteria
2. **Research** (parallel): Delegate simultaneous research tasks to build a complete picture faster. Scope research to files and modules referenced in the issue and acceptance criteria.
   - **Architecture**: Delegate to `code-reviewer` to read existing code in the affected area and summarize the current architecture, key abstractions, and dependencies
   - **Test coverage**: Delegate to `tester` to check what's tested, what's missing, and what test patterns are used in the affected area (analysis only — do not write or run new tests at this stage)

   Launch these as parallel Agent tool calls. Collect all results before proceeding to step 3.
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

   **Issues API:**
   ```bash
   issues comment add TICKET_ID --body "## Plan

   [Task breakdown summary with approach and key decisions]" --json
   ```

### Phase 1a: Design Review (for visual changes, if designer agent available)

1. Delegate to `designer` for an HTML mockup
2. Open mockup for user review
3. Delegate to `ux-engineer` if available for usability review
4. **Wait for user approval** before implementation (user intervention required)

### Phase 1b: Bug Reproduction (required for bug fixes)

**Before any fix is attempted**, delegate to `tester`:
1. Write a failing test that reproduces the reported bug
2. Verify the test fails for the right reason (the bug, not test setup issues)
3. If reproduction fails, report back — the lead must clarify the bug or adjust scope, then re-run Phase 1b from step 1

**Do NOT proceed to Phase 2 until a failing reproduction test exists.**

### Phase 2: Implementation

**The lead orchestrates — it does NOT write implementation code directly.**

For each task from the Phase 1 breakdown, delegate to an agent:

1. **Choose the right agent for each task:**
   - `general-purpose` agent (a built-in Agent tool type, not a custom agent definition) for implementation tasks (feature code, refactoring, configuration changes)
   - `tester` for writing or updating tests
   - Other specialists for domain-specific work matching their expertise
2. **Assign clear file-ownership boundaries** — no two agents modify the same file in the same phase. If overlap is needed, sequence the tasks.
3. **Parallelize independent tasks** — launch concurrent Agent tool calls for tasks with no dependencies between them. Limit to 3–4 concurrent agents to avoid write contention.
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

   **Issues API:**
   ```bash
   issues comment add TICKET_ID --body "## Implementation complete

   [Summary of changes made and files modified]

   Moving to verification." --json
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

   **Issues API:**
   ```bash
   issues comment add TICKET_ID --body "PR created: #[PR-NUMBER] ([PR-URL])" --json
   ```

### Phase 5: Code Review Gate

**All review feedback goes to the PR, not the issue.**

> **Note:** Do NOT use GitHub's approval system. Post review status as comments.

1. Delegate ALL applicable reviews simultaneously using parallel Agent tool calls:
   - `code-reviewer` — always
   - `security-engineer` — always for PRs that add or modify code, scripts, agent definitions, or workflow instructions; skip for purely informational doc changes
   - `performance-engineer` — when the PR touches I/O, data structures, concurrency, or hot paths
   - `tester` — when the PR adds or modifies tests (validate test quality and coverage)
2. Collect all findings, then triage by severity (Critical/Warning block merge, Suggestions don't)
3. Fix-review loop: assign fixes, push, re-review (max 3 cycles before escalation)
4. Handle deferred findings using the convention below
5. Once all blocking findings are resolved, proceed directly to Phase 7 (skip Phase 6 unless the PR contains visual/UI changes)

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

### Phase 6: Manual QA (visual changes only — skip for non-visual PRs)

> **This phase only applies when the PR contains visual/UI changes.** For all other PRs, proceed directly from Phase 5 to Phase 7.

1. Present to user for manual testing
2. Wait for user feedback (user intervention required)
3. Address issues if reported, return to Phase 5 after fixes

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
   - **Issues API:** `issues ticket transition TICKET_ID --to CLOSED --json`
3. Sync blocked labels using the `update-blocked-labels.sh` script in this command's `scripts/` directory
4. Return to default branch and pull latest (skip if `WORKTREE_PREEXISTING` — the worktree is not ours to clean up)
5. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script (skip if `WORKTREE_PREEXISTING`)
6. **Post completion to issue**:

   **GitHub (default):**
   ```bash
   gh issue comment [N] --body "Issue completed. Merged via PR #[PR-NUMBER]."
   ```

   **Issues API:**
   ```bash
   issues comment add TICKET_ID --body "Issue completed. Merged via PR #[PR-NUMBER]." --json
   ```
7. Report completion

> **Note:** If this phase is skipped (e.g., conversation ends early), cleanup happens automatically the next time `/new-work` creates a worktree — the `cleanup-merged-worktrees.sh` pre-flight detects merged PRs and cleans up their worktrees, branches, and labels.

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
