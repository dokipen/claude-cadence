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

PROVIDER=$(grep -A3 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'provider:' | tail -1 | awk '{print $2}') || true
PROVIDER="${PROVIDER:-github}"
PROJECT=$(grep -A4 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'project_id:' | tail -1 | awk '{print $2}') || true
API_URL=$(grep -A5 '## Ticket Provider' CLAUDE.md 2>/dev/null | grep 'api_url:' | tail -1 | awk '{print $2}') || true

jq -n \
  --arg provider "$PROVIDER" \
  --arg project "${PROJECT:-}" \
  --arg api_url "${API_URL:-}" \
  '{"provider": $provider, "project": $project, "api_url": $api_url}'
