#!/usr/bin/env bash
# detect-provider.sh — Extract ticket provider configuration from CLAUDE.md
#
# Reads the ## Ticket Provider section from CLAUDE.md and outputs the
# configuration as JSON for programmatic consumption.
#
# Usage:
#   PROVIDER_CONFIG=$(bash skills/ticket-provider/scripts/detect-provider.sh)
#   PROVIDER=$(echo "$PROVIDER_CONFIG" | jq -r '.provider')
#   PROJECT=$(echo "$PROVIDER_CONFIG" | jq -r '.project')
#   API_URL=$(echo "$PROVIDER_CONFIG" | jq -r '.api_url')
#
# Output fields:
#   provider — "github" (default) or "issues-api"
#   project  — project_id value, or "" if not set
#   api_url  — api_url value, or "" if not set

set -euo pipefail

# Use an awk state-machine to parse the ## Ticket Provider section, tolerating
# arbitrary field order, blank lines between fields, and additional fields.
# Stops collecting at the next ## heading so adjacent sections are not included.
_parsed=""
if [ -f CLAUDE.md ]; then
  _parsed=$(awk '
    { gsub(/\r/, "") }
    /^```/                              { in_fence = !in_fence; next }
    in_fence                            { next }
    /^## Ticket Provider[[:space:]]*$/  { in_section=1; next }
    in_section && /^## /                { in_section=0 }
    in_section && /^provider:/          { provider=$2 }
    in_section && /^project_id:/        { project=$2 }
    in_section && /^api_url:/           { api_url=$2 }
    END { print provider "\t" project "\t" api_url }
  ' CLAUDE.md)
fi

PROVIDER=$(printf '%s' "$_parsed" | cut -f1)
PROJECT=$(printf '%s' "$_parsed"  | cut -f2)
API_URL=$(printf '%s' "$_parsed"  | cut -f3)
PROVIDER="${PROVIDER:-github}"

jq -n \
  --arg provider "$PROVIDER" \
  --arg project "${PROJECT:-}" \
  --arg api_url "${API_URL:-}" \
  '{"provider": $provider, "project": $project, "api_url": $api_url}'
