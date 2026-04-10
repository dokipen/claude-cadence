#!/usr/bin/env bash
# detect-provider.sh — Extract ticket provider configuration from CLAUDE.md
#
# Reads the ## Ticket Provider section from CLAUDE.md and outputs the
# configuration as JSON for programmatic consumption.
#
# Configuration precedence (highest to lowest):
#   1. Per-repo overrides in ~/.claude/cadence.json (.repos["owner/repo"])
#   2. CLAUDE.md ## Ticket Provider section
#   3. Global defaults in ~/.claude/cadence.json (top-level provider/project_id/api_url)
#   4. Built-in default: provider=github
#
# Global defaults apply when CLAUDE.md has no ## Ticket Provider section.
# Per-repo overrides always take precedence, even over CLAUDE.md.
# ISSUES_API_URL env var overrides api_url for QA/local testing.
#
# ~/.claude/cadence.json format:
#   {
#     "provider": "issues-api",       # global default provider
#     "project_id": "my-project",     # global default project
#     "api_url": "https://...",        # global default api_url
#     "repos": {
#       "owner/repo": {               # per-repo override (takes precedence over CLAUDE.md)
#         "provider": "github",
#         "project_id": "other-project"
#       }
#     }
#   }
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
    /^## Ticket Provider[[:space:]]*$/  { in_section=1; found=1; next }
    in_section && /^## /                { in_section=0 }
    in_section && /^provider:/          { provider=$2 }
    in_section && /^project_id:/        { project=$2 }
    in_section && /^api_url:/           { api_url=$2 }
    END { print provider "\t" project "\t" api_url "\t" found }
  ' CLAUDE.md)
fi

PROVIDER=$(printf '%s' "$_parsed"    | cut -f1)
PROJECT=$(printf '%s' "$_parsed"     | cut -f2)
API_URL=$(printf '%s' "$_parsed"     | cut -f3)
_has_section=$(printf '%s' "$_parsed" | cut -f4)

_cadence_cfg="${HOME}/.claude/cadence.json"

# Global fallback from ~/.claude/cadence.json top-level fields.
# Only applies when CLAUDE.md has no ## Ticket Provider section at all.
if [ -z "$_has_section" ] && [ -f "$_cadence_cfg" ]; then
  _global_provider=$(jq -r '.provider // empty' "$_cadence_cfg" 2>/dev/null || true)
  _global_project=$(jq -r '.project_id // empty' "$_cadence_cfg" 2>/dev/null || true)
  _global_api_url=$(jq -r '.api_url // empty' "$_cadence_cfg" 2>/dev/null || true)
  [ -n "$_global_provider" ] && PROVIDER="$_global_provider"
  [ -n "$_global_project" ] && PROJECT="$_global_project"
  [ -n "$_global_api_url" ] && API_URL="$_global_api_url"
fi

PROVIDER="${PROVIDER:-github}"

# Per-repo overrides from ~/.claude/cadence.json.
# Derive owner/repo slug from git remote origin (handles HTTPS and SSH formats).
if [ -f "$_cadence_cfg" ]; then
  _remote=$(git remote get-url origin 2>/dev/null || true)
  # Normalize: strip scheme/host prefix and .git suffix to get owner/repo
  _slug=$(printf '%s' "$_remote" \
    | sed 's|^https://[^/]*/||; s|^git@[^:]*:||; s|\.git$||')
  if [ -n "$_slug" ]; then
    _override_provider=$(jq -r --arg r "$_slug" '.repos[$r].provider // empty' "$_cadence_cfg" 2>/dev/null || true)
    _override_project=$(jq -r --arg r "$_slug" '.repos[$r].project_id // empty' "$_cadence_cfg" 2>/dev/null || true)
    [ -n "$_override_provider" ] && PROVIDER="$_override_provider"
    [ -n "$_override_project" ] && PROJECT="$_override_project"
  fi
fi

# ISSUES_API_URL env var overrides api_url for QA/local testing
API_URL="${ISSUES_API_URL:-$API_URL}"

jq -n \
  --arg provider "$PROVIDER" \
  --arg project "${PROJECT:-}" \
  --arg api_url "${API_URL:-}" \
  '{"provider": $provider, "project": $project, "api_url": $api_url}'
