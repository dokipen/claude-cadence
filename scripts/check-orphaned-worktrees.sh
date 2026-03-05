#!/bin/bash
# Check for orphaned worktree directories that aren't tracked by git worktree

set -e

WORKTREES_DIR=".worktrees"

if [ ! -d "$WORKTREES_DIR" ]; then
  echo "No $WORKTREES_DIR directory exists yet"
  exit 0
fi

found_orphans=0
for dir in "$WORKTREES_DIR"/*/; do
  [ -d "$dir" ] || continue
  dir_name=$(basename "$dir")

  # Check if this directory is tracked by git worktree
  if ! git worktree list | grep -q "\.worktrees/$dir_name "; then
    echo "Warning: Found orphaned worktree directory: $dir"
    echo "  Run: rm -rf $dir"
    found_orphans=1
  fi
done

if [ $found_orphans -eq 0 ]; then
  echo "Pre-flight check complete: no orphaned worktrees"
else
  echo ""
  echo "Clean up orphaned directories before proceeding"
fi
