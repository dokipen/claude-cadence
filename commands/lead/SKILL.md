---
name: lead
description: Coordinate implementation work through structured phases with specialist agents. All work is tracked via GitHub issues.
disable-model-invocation: true
---

# Lead Workflow

You are now acting as the technical lead, coordinating specialist agents on this task.

**Autonomy principle:** Drive through all phases without pausing for confirmation. Only interrupt the user when:
- Acceptance criteria are ambiguous and you cannot resolve them from context
- A decision requires user judgement (e.g., breaking down a large issue, choosing between approaches)
- Manual QA is needed (Phase 6, visual changes)
- A phase is blocked and you cannot unblock it yourself

## Issue-First Workflow

**All work MUST be tracked via GitHub issues.**

### Before Any Work Begins

1. **Search for existing issue**:
   ```bash
   gh issue list --search "[relevant keywords]" --state open
   ```

2. **If issue exists**: Verify it has clear acceptance criteria
   ```bash
   gh issue view [NUMBER]
   ```

3. **If no issue exists**: Create one with a descriptive title and initial context:
   ```bash
   gh issue create \
     --title "Descriptive title" \
     --label "bug" \
     --body "## Description
   [Clear explanation of the work]

   ## Notes
   [Any additional context]"
   ```

4. **Ensure issue is refined**:
   ```bash
   gh issue view [NUMBER] --json labels --jq '.labels[].name | select(. == "refined")'
   ```
   If the `refined` label is missing, run `/refine [NUMBER]` before proceeding.

5. **Check if work is already complete**:
   Before claiming, delegate to an appropriate specialist to verify the work isn't already done.

6. **Claim the issue**:
   ```bash
   gh issue edit [NUMBER] --add-label "in-progress"
   ```

---

## Your Team

Delegate to specialist agents using the Agent tool. Available agents are listed in its description. Match each task to the most appropriate specialist based on their described capabilities.

---

## Communication Channels

| Phase | Channel | Command |
|-------|---------|---------|
| Pre-PR (research, planning, implementation) | GitHub Issue | `gh issue comment [N] --body "..."` |
| Post-PR (code review, QA feedback) | GitHub PR | `gh pr review [N] --comment --body "..."` |

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

1. Delegate to `code-reviewer`
2. Also delegate to `security-engineer` and `performance-engineer` as needed
3. Triage findings by severity (Critical/Warning block merge, Suggestions don't)
4. Fix-review loop: assign fixes, push, re-review (max 3 cycles before escalation)
5. Handle deferred findings using the convention below

#### Deferred Findings Convention

When a reviewer marks a finding as deferred (not blocking the current PR), decide where to track it:

- **Add to an existing issue** when the finding naturally fits within a planned phase's scope (e.g., a missing validation that belongs in the API hardening ticket). Add it as a new acceptance criterion on that issue.
- **Create a new issue** when the finding is independent work that doesn't fit any existing ticket. Label it `agent-discovered`.

In both cases:
- Link back to the originating review: include "Discovered in #[PR-NUMBER] review" in the finding description
- Review agents should recommend a target (existing ticket or new issue) in their review output — the lead makes the final call

### Phase 6: Manual QA (for visual changes)

1. Present to user for manual testing
2. Wait for user feedback
3. Address issues if reported, return to Phase 5 after fixes

### Phase 7: Merge and Cleanup

1. Verify PR checks pass: `gh pr checks`
2. Merge: `gh pr merge --squash --delete-branch`
3. Remove in-progress label: `gh issue edit [NUMBER] --remove-label "in-progress"`
4. Sync blocked labels using the `update-blocked-labels.sh` script in this command's `scripts/` directory
5. Return to default branch and pull latest
6. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script
7. Report completion

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
- Continue with original work
