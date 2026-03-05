#!/bin/bash
# List all available Claude Code agents with their frontmatter metadata.
# The lead agent runs this to discover specialists at runtime.
#
# Scans .claude/agents/ for project-local and plugin-installed agents.
#
# Usage: ./scripts/list-agents.sh

set -e

for f in .claude/agents/*.md; do
  [ -f "$f" ] || continue
  # Extract only the first frontmatter block (lines 1 through second ---)
  awk 'NR==1 && /^---$/{found=1; print; next} found && /^---$/{print; exit} found{print}' "$f"
  echo ""
done
