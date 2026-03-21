#!/bin/bash
# Run pre-flight checks before creating a PR
#
# Usage: ./scripts/pr-preflight.sh
#
# This script:
# 1. Verifies you're not on the default branch
# 2. Runs the project's verification command (from CLAUDE.md)
# 3. Shows uncommitted changes (for review)
# 4. Checks if a PR already exists for this branch
#
# Exit codes:
# 0 - All checks passed
# 1 - On default branch (cannot create PR)
# 2 - Verification command failed

set -e
shopt -s globstar  # enable ** globs for verification commands

echo "PR Pre-flight Checks"
echo "===================="
echo ""

# Detect default branch
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

# Step 1: Verify not on default branch
echo "1. Checking branch..."
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "$DEFAULT_BRANCH" ] || [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo "   ERROR: Cannot create PR from ${CURRENT_BRANCH} branch"
  exit 1
fi
echo "   Branch: ${CURRENT_BRANCH}"
echo ""

# Step 2: Run verification command from CLAUDE.md
echo "2. Running verification..."
VERIFY_CMD=""

# Look for verification command in CLAUDE.md (skipping headings inside fenced code blocks)
if [ -f "CLAUDE.md" ]; then
  VERIFY_CMD=$(awk 'BEGIN{fence=0} /^```/{fence=!fence; next} !fence && /^## Verification/{while ((getline line) > 0 && (line ~ /^[[:space:]]*$/ || line ~ /^[[:space:]]*#/)) {}; print line; exit}' CLAUDE.md)
fi

if [ -n "$VERIFY_CMD" ]; then
  echo "   Running: ${VERIFY_CMD}"
  if ! eval "$VERIFY_CMD"; then
    echo "   ERROR: Verification failed"
    exit 2
  fi
  echo "   Verification passed"
else
  echo "   No verification command found in CLAUDE.md — skipping"
fi
echo ""

# Step 3: Check for uncommitted changes
echo "3. Git status:"
git status --short
echo ""

# Step 4: Check for existing PR
echo "4. Checking for existing PR..."
if gh pr view "${CURRENT_BRANCH}" 2>/dev/null; then
  echo "   PR already exists for this branch"
else
  echo "   No existing PR — ready to create one"
fi
echo ""

echo "Pre-flight checks complete!"
