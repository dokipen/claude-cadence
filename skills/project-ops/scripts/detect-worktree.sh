#!/usr/bin/env bash
# Detect if the current directory is inside a git worktree.
# Outputs JSON: {"in_worktree": true|false, "branch": "<name>"}
set -euo pipefail

_GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
_GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
BRANCH=$(git branch --show-current 2>/dev/null || echo "")

IN_WORKTREE=false
if [ "$_GIT_DIR" != "$_GIT_COMMON_DIR" ]; then
  IN_WORKTREE=true
fi

echo "{\"in_worktree\": $IN_WORKTREE, \"branch\": \"$BRANCH\"}"
