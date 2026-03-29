#!/bin/bash
# Automatically clean up worktrees whose associated PRs have been merged.
#
# For each worktree in .worktrees/:
# 1. Extract the issue number from the branch name
# 2. Check if a merged PR exists for that branch
# 3. If merged, clean up the worktree, remote branch, and in-progress label
#
# Usage: ./scripts/cleanup-merged-worktrees.sh
#
# Safe to run at any time — skips worktrees in active use by any session.
# Note: Only detects PRs opened from branches in the same repo (not forks).

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"

if [ ! -d "$WORKTREES_DIR" ]; then
  exit 0
fi

# Collect all branches currently checked out in any worktree (not just CWD).
# This protects against removing worktrees in use by concurrent agent sessions.
ACTIVE_BRANCHES=$(git worktree list --porcelain 2>/dev/null | grep '^branch ' | sed 's|^branch refs/heads/||')

cleaned=0
for dir in "$WORKTREES_DIR"/*/; do
  [ -d "$dir" ] || continue
  branch_name=$(basename "$dir")

  # Validate branch name format (issue-number prefix, alphanumeric with hyphens/underscores)
  if [[ ! "$branch_name" =~ ^[0-9]+-[a-zA-Z0-9_-]+$ ]]; then
    continue
  fi

  # Skip worktrees with branches checked out in any active session
  if echo "$ACTIVE_BRANCHES" | grep -qx "$branch_name"; then
    echo "Skipping '$branch_name' — currently checked out in an active worktree"
    continue
  fi

  # Extract issue number from branch name (e.g., "42-add-feature" -> "42")
  issue_number=$(echo "$branch_name" | grep -oE '^[0-9]+')

  # Check if a merged PR exists for this branch
  merged_pr=$(gh pr list --head "$branch_name" --state merged --json number --jq '.[0].number' 2>/dev/null || echo "")
  if [[ ! "$merged_pr" =~ ^[0-9]+$ ]]; then
    continue
  fi

  echo "Cleaning up worktree '$branch_name' (PR #$merged_pr merged)..."

  # Re-check active worktrees immediately before destructive steps to narrow TOCTOU window
  if git worktree list --porcelain 2>/dev/null | grep -q "^branch refs/heads/$branch_name$"; then
    echo "Skipping '$branch_name' — became active since scan started"
    continue
  fi

  # Delete remote branch (may already be deleted by PR merge)
  git push origin --delete "$branch_name" 2>/dev/null || true

  # Remove worktree
  if [ -d "$WORKTREES_DIR/$branch_name" ]; then
    git worktree remove "$WORKTREES_DIR/$branch_name" 2>/dev/null \
      || git worktree remove --force "$WORKTREES_DIR/$branch_name" 2>/dev/null \
      || rm -rf "${WORKTREES_DIR:?}/${branch_name:?}" \
      || echo "  Warning: failed to remove worktree directory"
  fi

  # Delete local branch
  git branch -D "$branch_name" 2>/dev/null || true

  # Remove in-progress label from the issue
  gh issue edit "$issue_number" --remove-label "in-progress" 2>/dev/null || true

  echo "  Cleaned up: worktree, branch, and in-progress label for issue #$issue_number"
  cleaned=$((cleaned + 1))
done

# Prune orphaned worktree references (idempotent and cheap)
git worktree prune 2>/dev/null || true

if [ $cleaned -gt 0 ]; then
  echo ""
  echo "Cleaned up $cleaned merged worktree(s)."
fi
