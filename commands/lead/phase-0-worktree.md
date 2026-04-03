### Phase 0: Worktree Setup

> **Skip this phase entirely** if the ticket has the `human-activity` label. The human-activity workflow makes no code changes and requires no worktree. After completing step 7 (claim), proceed directly to the [Human Activity Workflow](human-activity-workflow.md). Do not set `WORKTREE_DIR` or `BRANCH` — leave them unset so Phase 4 cleanup is skipped automatically.

**All work happens in worktrees, never on the default branch.**

0. **Environment verification pre-check** — Run diagnostic commands before any file modifications:
   ```bash
   git worktree list
   git status
   pwd
   ```
   Then run `detect-worktree.sh` to evaluate stop conditions:
   ```bash
   bash "$CADENCE_ROOT/skills/project-ops/scripts/detect-worktree.sh"
   ```
   This outputs JSON: `{"in_worktree": true|false, "branch": "<name>", "detached_head": true|false}`

   **Stop condition A — Detached HEAD**: If `detached_head` is `true` (branch is empty string): **STOP immediately**. Report the diagnostic output (`git worktree list`, `git status`, `pwd`) to the user. Instruct them to check out a named branch before continuing (e.g., `git checkout <branch-name>`). Do not proceed to any further steps.

   **Existing worktree — auto-resume**: If `in_worktree` is `false` AND `git worktree list` shows exactly one worktree whose branch name starts with `<N>-` (where N is the issue number): extract its path from the `git worktree list` output, set `WORKTREE_DIR` to that path, set `BRANCH` to that branch name (strip surrounding `[brackets]` from the `git worktree list` output), set `WORKTREE_PREEXISTING=true`. Do not run `/new-work`. If more than one worktree matches, **STOP** and report all matching worktree paths to the user for disambiguation. Before skipping ahead to step 4, apply the two checks below.

   **Dirty worktree — warn and continue**: Check for uncommitted changes in the auto-resumed worktree:
   ```bash
   git -C "$WORKTREE_DIR" status --porcelain
   ```
   If the output is non-empty, print a warning: "Warning: worktree `$BRANCH` has uncommitted changes. Review and commit or stash before proceeding." Then continue — do not abort or stash automatically. Uncommitted changes are normal in interrupted work and should not block resuming.

   **Branch behind origin — pull and continue**: Check whether the remote branch has commits not present locally. First fetch the remote branch (silently ignore errors if the branch is not yet pushed):
   ```bash
   git -C "$WORKTREE_DIR" fetch origin "$BRANCH" 2>/dev/null
   BEHIND=$(git -C "$WORKTREE_DIR" rev-list --count HEAD..origin/"$BRANCH" 2>/dev/null || echo 0)
   ```
   If `$BEHIND` is greater than zero, pull the remote changes:
   ```bash
   git -C "$WORKTREE_DIR" pull --ff-only
   ```
   If the fast-forward succeeds, continue. If it fails (diverged history), print a warning: "Warning: branch `$BRANCH` cannot be fast-forwarded from origin — manual merge may be needed (run `git merge origin/$BRANCH` or `git rebase origin/$BRANCH` to resolve)." Then continue without pulling.

   After both checks, **skip ahead to step 4** (posting to the issue).

   Only if stop condition A is not triggered and no existing worktree was found, proceed to step 1.

1. Detect worktree status and current branch (already obtained above in step 0 — reuse the `detect-worktree.sh` output):
   - JSON fields: `{"in_worktree": true|false, "branch": "<name>", "detached_head": true|false}`
2. **If already in a worktree** (`in_worktree` is `true`):
   - If on a feature branch (not default): use the current directory and branch as-is. Set `WORKTREE_DIR="$PWD"`, `BRANCH="<current-branch>"`, and `WORKTREE_PREEXISTING=true`.
   - If on the default branch: use `/new-work` to create a branch in-place (the script auto-detects worktrees). Set `WORKTREE_DIR="$PWD"`, `BRANCH="<new-branch>"`, and `WORKTREE_PREEXISTING=true`.
3. **If NOT in a worktree**:
   - If on default branch: use `/new-work` to create a worktree. After the worktree is created, set `WORKTREE_DIR="$(git rev-parse --show-toplevel)/.worktrees/${BRANCH}"` and `cd` into it.
   - If on a feature branch: use the current directory and branch as-is. Set `WORKTREE_DIR="$PWD"` and `BRANCH="<current-branch>"`.
4. Post setup to issue (see ticket-provider skill — **Comment** operation):

   Include the branch, session ID (for resumption), and the initial prompt. If `$AGENTD_SESSION_ID` is not set (e.g., running outside agentd), omit the session line.

   ```
   Starting work on issue #[N]. Branch: `[BRANCH]`

   **Session ID:** `[AGENTD_SESSION_ID]` — resume with `/resume [AGENTD_SESSION_ID]`
   **Initial prompt:** `/lead [N]`
   ```
