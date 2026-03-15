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
PROVIDER=$(grep -A2 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'provider:' | awk '{print $2}' || echo "github")
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
   issues ticket list --label "[relevant label]"
   ```

2. **If issue exists**: Verify it has clear acceptance criteria

   **GitHub (default):**
   ```bash
   gh issue view [NUMBER]
   ```

   **Issues API:**
   ```bash
   issues ticket view [NUMBER]
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
     --title "Descriptive title" \
     --labels "BUG_LABEL_ID" \
     --description "## Description
   [Clear explanation of the work]

   ## Notes
   [Any additional context]"
   ```

4. **Ensure issue is refined**:

   **GitHub (default):**
   ```bash
   gh issue view [NUMBER] --json labels --jq '.labels[].name | select(. == "refined")'
   ```
   If the `refined` label is missing, run `/refine [NUMBER]` before proceeding.

   **Issues API:**
   ```bash
   issues ticket view [NUMBER]
   ```
   If the state is not `REFINED` (or later), run `/refine [NUMBER]` before proceeding.

5. **Check if work is already complete**:
   Before claiming, delegate to an appropriate specialist to verify the work isn't already done.

6. **Claim the issue**:

   **GitHub (default):**
   ```bash
   gh issue edit [NUMBER] --add-label "in-progress"
   ```

   **Issues API:**
   ```bash
   issues ticket transition [NUMBER] --to IN_PROGRESS
   ```

---

## Your Team

Delegate to specialist agents using the Agent tool. Available agents are listed in its description. Match each task to the most appropriate specialist based on their described capabilities.

---

## Communication Channels

| Phase | Channel | Command (GitHub) | Command (Issues API) |
|-------|---------|------------------|----------------------|
| Pre-PR (research, planning, implementation) | Ticket | `gh issue comment [N] --body "..."` | `issues comment add [N] --body "..."` |
| Post-PR (code review, QA feedback) | GitHub PR | `gh pr review [N] --comment --body "..."` | `gh pr review [N] --comment --body "..."` |

---

## Workflow Phases

### Phase 0: Worktree Setup

**All work happens in worktrees, never on the default branch.**

1. Check current branch: `git branch --show-current`
2. If on default branch, use `/new-work` to create a worktree first.
3. Post setup to issue.

### Phase 1: Planning

1. **Clarify requirements**: Review the acceptance criteria
2. **Research**: Delegate to specialist to understand existing code
3. **Classify work type**:
   - Feature with UI → Phase 1a (Design, if designer agent available)
   - Bug fix → Phase 1b (Reproduction)
   - Other → Delegate to appropriate specialist
4. **Task breakdown**: Create 3-6 discrete units with clear owners

### Phase 1a: Design Review (for visual changes, if designer agent available)

1. Delegate to `designer` for an HTML mockup
2. Open mockup for user review
3. Delegate to `ux-engineer` if available for usability review
4. **Wait for user approval** before implementation (user intervention required)

### Phase 1b: Bug Reproduction (for bug fixes)

1. Delegate to `tester`: Write a failing test that reproduces the bug
2. Verify the test fails for the right reason (the bug, not test setup)
3. Proceed to fix

### Phase 2: Implementation

1. Delegate to appropriate specialists in dependency order
2. For bug fixes: the fix should make the reproduction test pass
3. Avoid conflicts: each task works on different files
4. Verify after each change using the project's verification command (from CLAUDE.md)

### Phase 3: Pre-PR Verification

1. Run the project's full verification command (from CLAUDE.md)
2. For bug fixes: verify the reproduction test now passes
3. Fix failures, re-run until all pass

### Phase 4: PR Creation

Use `/create-pr` to create the pull request. Link to the issue with `Fixes #[NUMBER]`.

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
- **Create a new issue** when the finding is independent work that doesn't fit any existing ticket. Label it `agent-discovered` and assign a priority label (`priority:high`, `priority:medium`, or `priority:low`). Deferred findings default to `priority:low` unless the reviewer indicates higher severity.

In both cases:
- Link back to the originating review: include "Discovered in #[PR-NUMBER] review" in the finding description
- Review agents should recommend a target (existing ticket or new issue) and a priority in their review output — the lead makes the final call

### Phase 6: Manual QA (visual changes only — skip for non-visual PRs)

> **This phase only applies when the PR contains visual/UI changes.** For all other PRs, proceed directly from Phase 5 to Phase 7.

1. Present to user for manual testing
2. Wait for user feedback (user intervention required)
3. Address issues if reported, return to Phase 5 after fixes

### Phase 7: Merge and Cleanup

1. Wait for PR checks to pass, then merge:
   ```bash
   gh pr checks --watch --fail-fast && gh pr merge --squash --delete-branch
   ```
   Use a 10-minute timeout to avoid blocking indefinitely on stuck checks:
   ```bash
   timeout 600 gh pr checks --watch --fail-fast && gh pr merge --squash --delete-branch
   ```
   - If checks pass: the merge proceeds automatically
   - If checks fail: report the specific failed check(s) to the user
   - If timeout is exceeded: report the timeout and the still-pending check(s) to the user
3. Remove in-progress status:
   - **GitHub (default):** `gh issue edit [NUMBER] --remove-label "in-progress"`
   - **Issues API:** No-op — merging the PR with `Fixes #[NUMBER]` closes the ticket automatically
4. Sync blocked labels using the `update-blocked-labels.sh` script in this command's `scripts/` directory
5. Return to default branch and pull latest
6. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script
7. Report completion

> **Note:** If this phase is skipped (e.g., conversation ends early), cleanup happens automatically the next time `/new-work` creates a worktree — the `cleanup-merged-worktrees.sh` pre-flight detects merged PRs and cleans up their worktrees, branches, and labels.

---

## Coordination Protocol

### Working Directory for Sub-Agents

Sub-agents do not inherit the lead's working directory. Always instruct them to `cd` first:

```
First, change to the worktree directory:
cd [path-to-worktree]

Then proceed with your task...
```

### Task Assignment Guidelines

Always tell agents to:
1. `cd` to the worktree first
2. Read the issue for full context

### Task Completion

Specialists should conclude with one of:
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
- Assign a priority label (`priority:high`, `priority:medium`, or `priority:low`) — default to `priority:low` unless the finding warrants higher
- Continue with original work
