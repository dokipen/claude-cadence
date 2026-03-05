#!/bin/sh
# List all available Claude Code agents with their frontmatter metadata.
# The lead agent runs this to discover specialists at runtime.
#
# Scans locations in cascading priority (first match wins):
#   1. .claude/agents/          (project-local)
#   2. ~/.claude/agents/        (global user agents)
#   3. ~/.claude/plugins/cache/claude-cadence/claude-cadence/*/agents/  (installed plugin)
#   4. ~/.claude/plugins/marketplaces/claude-cadence/agents/  (marketplace source)
#
# If an agent name exists in multiple locations, only the highest-priority one is shown.
#
# Usage: ./scripts/list-agents.sh

set -e

seen=""

# Resolve installed plugin cache path (latest version)
CACHE_DIR=""
for d in "$HOME"/.claude/plugins/cache/claude-cadence/claude-cadence/*/agents; do
  [ -d "$d" ] && CACHE_DIR="$d"
done

for dir in \
  ".claude/agents" \
  "$HOME/.claude/agents" \
  "$CACHE_DIR" \
  "$HOME/.claude/plugins/marketplaces/claude-cadence/agents"
do
  [ -n "$dir" ] && [ -d "$dir" ] || continue
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
