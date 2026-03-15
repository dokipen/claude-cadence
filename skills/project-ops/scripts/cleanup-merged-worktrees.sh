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
# Safe to run at any time — skips the current worktree and active PRs.

set -e

WORKTREES_DIR=".worktrees"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$WORKTREES_DIR" ]; then
  exit 0
fi

# Get current branch to avoid cleaning up the worktree we're working in
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")

cleaned=0
for dir in "$WORKTREES_DIR"/*/; do
  [ -d "$dir" ] || continue
  branch_name=$(basename "$dir")

  # Skip the current worktree
  if [ "$branch_name" = "$CURRENT_BRANCH" ]; then
    continue
  fi

  # Extract issue number from branch name (e.g., "42-add-feature" -> "42")
  issue_number=$(echo "$branch_name" | grep -oE '^[0-9]+')
  if [ -z "$issue_number" ]; then
    continue
  fi

  # Check if a merged PR exists for this branch
  merged_pr=$(gh pr list --head "$branch_name" --state merged --json number --jq '.[0].number' 2>/dev/null || echo "")
  if [ -z "$merged_pr" ]; then
    continue
  fi

  echo "Cleaning up worktree '$branch_name' (PR #$merged_pr merged)..."

  # Delete remote branch (may already be deleted by PR merge)
  git push origin --delete "$branch_name" 2>/dev/null || true

  # Remove worktree
  if [ -d "$WORKTREES_DIR/$branch_name" ]; then
    git worktree remove "$WORKTREES_DIR/$branch_name" 2>/dev/null || \
      git worktree remove --force "$WORKTREES_DIR/$branch_name" 2>/dev/null || \
      rm -rf "$WORKTREES_DIR/$branch_name"
  fi

  # Delete local branch
  git branch -D "$branch_name" 2>/dev/null || true

  # Remove in-progress label from the issue
  gh issue edit "$issue_number" --remove-label "in-progress" 2>/dev/null || true

  echo "  Cleaned up: worktree, branch, and in-progress label for issue #$issue_number"
  cleaned=$((cleaned + 1))
done

# Prune orphaned worktree references
if [ $cleaned -gt 0 ]; then
  git worktree prune
  echo ""
  echo "Cleaned up $cleaned merged worktree(s)."
fi
