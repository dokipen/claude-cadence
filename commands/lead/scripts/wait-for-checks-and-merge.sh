#!/usr/bin/env bash
# wait-for-checks-and-merge.sh — wait for PR checks then merge
#
# Usage: bash "$CADENCE_ROOT/commands/lead/scripts/wait-for-checks-and-merge.sh"
#
# Waits up to 10 minutes for the current PR's checks to complete
# (`gh pr checks --watch --fail-fast` returns immediately if checks are
# already green), then merges with `gh pr merge --squash --delete-branch`
# on success. Resolves `gtimeout` (macOS with GNU coreutils) or falls back
# to `timeout` (standard on Linux) internally, so callers never need to
# pass a resolved timeout command. On macOS without GNU coreutils, install
# via: brew install coreutils
#
# Exit codes:
#   0 - checks passed and merge succeeded
#   1 - checks failed (merge not attempted)
#   2 - wait for checks timed out (merge not attempted)
#   3 - neither gtimeout nor timeout found on PATH

set -euo pipefail

TIMEOUT_CMD=$(command -v gtimeout || command -v timeout || true)
if [ -z "$TIMEOUT_CMD" ]; then
  echo "Error: neither gtimeout nor timeout found on PATH. On macOS, install via: brew install coreutils" >&2
  exit 3
fi

set +e
"$TIMEOUT_CMD" 600 gh pr checks --watch --fail-fast
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  gh pr merge --squash --delete-branch
  exit 0
elif [ "$STATUS" -eq 124 ]; then
  echo "Error: timed out after 600s waiting for PR checks to complete. Merge not attempted." >&2
  exit 2
else
  echo "Error: PR checks failed. Merge not attempted." >&2
  exit 1
fi
