#!/usr/bin/env bash
# ensure-milestone-label.sh — Create a milestone label (issues-api) if it does not exist
#
# Creates the label with color #8B5CF6 if it is not already present.
# No-op if the label already exists.
#
# CLI-only: MCP tools are not available in shell scripts. This script uses the
# `issues` CLI directly and cannot be replaced with mcp__issues__* tools.
#
# Usage: bash commands/lead/scripts/ensure-milestone-label.sh MILESTONE_LABEL_NAME
#
# Example:
#   bash commands/lead/scripts/ensure-milestone-label.sh "milestone:42-add-sound-effects"

set -euo pipefail

LABEL_NAME="${1:?Usage: ensure-milestone-label.sh MILESTONE_LABEL_NAME}"

EXISTING_ID=$(issues label list --json | jq -r --arg name "$LABEL_NAME" '.[] | select(.name == $name) | .id')
if [ -z "$EXISTING_ID" ]; then
  issues label create --name "$LABEL_NAME" --color "#8B5CF6" --json
fi
