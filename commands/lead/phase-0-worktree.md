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
   bash "$CADENCE_ROOT/skills/project-ops/scripts/detect-worktree.sh"
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
