#!/usr/bin/env bash
# Tests for lib-sessions.sh. Run: bash install/test-lib-sessions.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WARNINGS=""
warn() { WARNINGS="$WARNINGS$*"$'\n'; }
error() { echo "ERROR: $*" >&2; return 1; }
# shellcheck source=lib-sessions.sh
source "$HERE/lib-sessions.sh"

fails=0
check() { # desc expected actual
    if [[ "$2" == "$3" ]]; then echo "ok   - $1"; else echo "FAIL - $1: expected [$2] got [$3]"; fails=$((fails + 1)); fi
}

mkdir -p "$TMP/sessions"
printf 'server:\n  port: 1\nsession:\n  dir: "%s"  # comment\n' "$TMP/sessions" > "$TMP/config.yaml"
printf '{"id":"live-1","name":"alive\001one","state":2,"agent_pid":%s}' "$$" > "$TMP/sessions/a.json"
printf '{"id":"dead-1","name":"dead","state":2,"agent_pid":999999}' > "$TMP/sessions/b.json"
printf '{"id":"stop-1","name":"stopped","state":3,"agent_pid":%s}' "$$" > "$TMP/sessions/c.json"

rc=0; out="$(live_sessions "$TMP/config.yaml")" || rc=$?
check "live_sessions exit" 0 "$rc"
check "live_sessions output" "aliveone (live-1, pid $$)" "$out"

rc=0; out="$(live_sessions "$TMP/missing.yaml")" || rc=$?
check "missing config -> 2" 2 "$rc"

printf 'server:\n  port: 1\n' > "$TMP/nodir.yaml"
rc=0; out="$(live_sessions "$TMP/nodir.yaml")" || rc=$?
check "no session.dir -> 2" 2 "$rc"

printf 'session:\n  dir: ~/x\n' > "$TMP/tilde.yaml"
rc=0; out="$(live_sessions "$TMP/tilde.yaml" sudo 2>/dev/null)" || rc=$?
check "tilde with sudo -> 2 or 3" 1 "$([[ $rc -eq 2 || $rc -eq 3 ]] && echo 1 || echo 0)"

live="aliveone (live-1, pid $$)"
rc=0; (guard_live_sessions false host "$live" 0) 2>/dev/null || rc=$?
check "guard errors without force" 1 "$rc"
rc=0; (guard_live_sessions true host "$live" 0) 2>/dev/null || rc=$?
check "guard passes with force" 0 "$rc"
rc=0; (guard_live_sessions false host "" 0) 2>/dev/null || rc=$?
check "guard passes when empty" 0 "$rc"
rc=0; (guard_live_sessions false host "" 2) 2>/dev/null || rc=$?
check "guard passes when not configured" 0 "$rc"
rc=0; (guard_live_sessions false host "" 3) 2>/dev/null || rc=$?
check "guard fails closed on probe failure" 1 "$rc"
rc=0; (guard_live_sessions false host "" 255) 2>/dev/null || rc=$?
check "guard fails closed on ssh 255" 1 "$rc"
rc=0; (guard_live_sessions true host "" 255) 2>/dev/null || rc=$?
check "guard passes probe failure with force" 0 "$rc"

if [[ $fails -eq 0 ]]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
