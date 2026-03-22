#!/usr/bin/env bash
# Detect if the current directory is inside a git worktree.
# Outputs JSON: {"in_worktree": true|false, "branch": "<name>", "detached_head": true|false}
# Run from repository root.
set -euo pipefail

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo '{"in_worktree": false, "branch": "", "detached_head": false}'
  exit 0
fi

_GIT_DIR=$(git rev-parse --git-dir)
_GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
BRANCH=$(git branch --show-current 2>/dev/null || echo "")

IN_WORKTREE=false
if [ "$_GIT_DIR" != "$_GIT_COMMON_DIR" ]; then
  IN_WORKTREE=true
fi

DETACHED_HEAD=false
if [ -z "$BRANCH" ]; then
  DETACHED_HEAD=true
fi

jq -n --argjson in_worktree "$IN_WORKTREE" --arg branch "$BRANCH" \
  --argjson detached_head "$DETACHED_HEAD" \
  '{in_worktree: $in_worktree, branch: $branch, detached_head: $detached_head}'
