#!/bin/bash
# Clean up a worktree and its remote branch after PR merge
#
# Usage: ./scripts/cleanup-worktree.sh <branch-name>
#
# This script:
# 1. Deletes the remote branch (if it still exists)
# 2. Removes the local worktree directory
# 3. Prunes orphaned worktree references

set -e

if [ -z "$1" ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  echo "Usage: ./scripts/cleanup-worktree.sh <branch-name>"
  echo "Example: ./scripts/cleanup-worktree.sh 42-add-feature"
  exit 0
fi

BRANCH_NAME="$1"
WORKTREE_DIR=".worktrees/${BRANCH_NAME}"

echo "Cleaning up worktree: ${BRANCH_NAME}"
echo "=================================="

# Step 1: Delete remote branch (may already be deleted by PR merge)
echo "Deleting remote branch..."
git push origin --delete "${BRANCH_NAME}" 2>/dev/null && echo "  Remote branch deleted" || echo "  Remote branch already deleted or doesn't exist"

# Step 2: Remove worktree directory
echo "Removing worktree directory..."
if [ -d "${WORKTREE_DIR}" ]; then
  git worktree remove "${WORKTREE_DIR}" 2>/dev/null || \
    git worktree remove --force "${WORKTREE_DIR}" 2>/dev/null || \
    rm -rf "${WORKTREE_DIR}"
  echo "  Worktree removed: ${WORKTREE_DIR}"
else
  echo "  Worktree directory not found: ${WORKTREE_DIR}"
fi

# Step 3: Prune orphaned references
echo "Pruning orphaned worktree references..."
git worktree prune
echo "  Pruned"

echo ""
echo "Done! Worktree ${BRANCH_NAME} cleaned up."
