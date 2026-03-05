#!/bin/bash
# Sync blocked labels for all open issues
#
# Usage: ./scripts/update-blocked-labels.sh
#
# This script:
# 1. Iterates through all open issues
# 2. Checks each issue's blocker relationships via GitHub API
# 3. Adds "blocked" label if issue has open blockers
# 4. Removes "blocked" label if issue has no open blockers

set -e

REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  echo "Usage: ./scripts/update-blocked-labels.sh"
  echo ""
  echo "Syncs 'blocked' labels for all open issues based on their"
  echo "blocker relationships. Run after closing/merging issues."
  exit 0
fi

echo "Syncing blocked labels for all open issues"
echo "==========================================="

# Get all open issues
OPEN_ISSUES=$(gh issue list --repo "$REPO" --state open --limit 500 --json number --jq '.[].number')

if [ -z "$OPEN_ISSUES" ]; then
  echo "No open issues found."
  exit 0
fi

for ISSUE in $OPEN_ISSUES; do
  # Get blockers for this issue
  BLOCKERS=$(gh api "repos/${REPO}/issues/${ISSUE}/dependencies/blocked_by" 2>/dev/null || echo "[]")

  # Count open blockers
  if [ "$BLOCKERS" = "[]" ] || [ -z "$BLOCKERS" ]; then
    OPEN_BLOCKERS=0
  else
    OPEN_BLOCKERS=$(echo "$BLOCKERS" | jq '[.[] | select(.state == "open")] | length')
  fi

  # Check current labels
  HAS_BLOCKED=$(gh issue view "$ISSUE" --repo "$REPO" --json labels --jq '.labels[].name | select(. == "blocked")' 2>/dev/null || echo "")

  if [ "$OPEN_BLOCKERS" -gt 0 ]; then
    if [ -z "$HAS_BLOCKED" ]; then
      echo "#${ISSUE}: Adding 'blocked' label (${OPEN_BLOCKERS} open blocker(s))"
      gh issue edit "$ISSUE" --repo "$REPO" --add-label "blocked"
    fi
  else
    if [ -n "$HAS_BLOCKED" ]; then
      echo "#${ISSUE}: Removing 'blocked' label (no open blockers)"
      gh issue edit "$ISSUE" --repo "$REPO" --remove-label "blocked"
    fi
  fi
done

echo ""
echo "Done!"
