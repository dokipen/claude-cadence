#!/bin/sh
# List all available Claude Code agents with their frontmatter metadata.
# The lead agent runs this to discover specialists at runtime.
#
# Scans three locations in cascading priority (local wins over global wins over plugin):
#   1. .claude/agents/          (project-local)
#   2. ~/.claude/agents/        (global user agents)
#   3. ~/.claude/plugins/marketplaces/claude-cadence/agents/  (plugin defaults)
#
# If an agent name exists in multiple locations, only the highest-priority one is shown.
#
# Usage: ./scripts/list-agents.sh

set -e

seen=""

for dir in \
  ".claude/agents" \
  "$HOME/.claude/agents" \
  "$HOME/.claude/plugins/marketplaces/claude-cadence/agents"
do
  [ -d "$dir" ] || continue
  for f in "$dir"/*.md; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    case ",$seen," in
      *",$name,"*) continue ;;
    esac
    seen="$seen,$name"
    echo "# source: $f"
    # Extract only the first frontmatter block (lines 1 through second ---)
    awk 'NR==1 && /^---$/{found=1; print; next} found && /^---$/{print; exit} found{print}' "$f"
    echo ""
  done
done
