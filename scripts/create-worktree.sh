#!/bin/bash
# Create a new worktree and branch for feature development
#
# Usage: ./scripts/create-worktree.sh <branch-name>
# Example: ./scripts/create-worktree.sh 42-add-sound-effects
#
# Branch names MUST be prefixed with the GitHub issue number.

set -e

WORKTREES_DIR=".worktrees"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect default branch
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

# Check for required argument
if [ -z "$1" ]; then
  echo "Usage: $0 <branch-name>"
  echo "Example: $0 42-add-sound-effects"
  echo ""
  echo "Branch names MUST start with the issue number (e.g., 42-feature-name)"
  exit 1
fi

BRANCH_NAME="$1"

# Validate branch name format (must start with issue number)
if ! echo "$BRANCH_NAME" | grep -qE '^[0-9]+-'; then
  echo "Error: Branch name must start with an issue number followed by a hyphen"
  echo "Example: 42-add-sound-effects"
  exit 1
fi

# Run orphan check if script exists
ORPHAN_CHECK="$SCRIPT_DIR/check-orphaned-worktrees.sh"
if [ -x "$ORPHAN_CHECK" ]; then
  echo "Running pre-flight check..."
  if ! "$ORPHAN_CHECK"; then
    echo ""
    echo "Please clean up orphaned worktrees before proceeding."
    exit 1
  fi
  echo ""
fi

# Check if branch already exists locally or remotely
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME" 2>/dev/null; then
  echo "Error: Branch '$BRANCH_NAME' already exists locally"
  exit 1
fi

if git ls-remote --exit-code --heads origin "$BRANCH_NAME" >/dev/null 2>&1; then
  echo "Error: Branch '$BRANCH_NAME' already exists on remote"
  exit 1
fi

# Check if worktree directory already exists
if [ -d "$WORKTREES_DIR/$BRANCH_NAME" ]; then
  echo "Error: Worktree directory '$WORKTREES_DIR/$BRANCH_NAME' already exists"
  exit 1
fi

# Create worktrees directory if needed
mkdir -p "$WORKTREES_DIR"

# Create the worktree and branch
echo "Creating worktree and branch '$BRANCH_NAME'..."
git worktree add "$WORKTREES_DIR/$BRANCH_NAME" -b "$BRANCH_NAME" "origin/$DEFAULT_BRANCH"

echo ""
echo "Worktree created successfully!"
echo "  Directory: $WORKTREES_DIR/$BRANCH_NAME"
echo "  Branch: $BRANCH_NAME"
echo "  Based on: origin/$DEFAULT_BRANCH"
echo ""
echo "To work in this worktree:"
echo "  cd $WORKTREES_DIR/$BRANCH_NAME"
