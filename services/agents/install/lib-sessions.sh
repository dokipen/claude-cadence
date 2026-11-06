#!/usr/bin/env bash
# Shared helpers for detecting live agentd sessions before a restart.
# Sourced by deploy.sh and install.sh; the functions are also shipped to remote
# hosts over ssh via `declare -f`, so they must be self-contained and must not
# depend on any other function or variable in the calling script.

# live_sessions <config-path> [sudo]
#
# Reads session.dir from the agentd config, scans the persisted session JSON
# files, and prints one "<name> (<id>, pid <pid>)" line per session whose
# persisted state is creating (1) or running (2) and whose agent process is
# still alive. Pass "sudo" as the second argument to read/probe as root.
#
# Exit status: 0 = detection worked (output may be empty), 2 = detection
# unavailable (no config, no session.dir, or unreadable directory).
live_sessions() {
    local config="$1" use_sudo="${2:-}"
    local -a sudo_cmd=()
    [[ "$use_sudo" == "sudo" ]] && sudo_cmd=(sudo)

    local dir
    dir="$("${sudo_cmd[@]}" cat "$config" 2>/dev/null | awk '
        /^session:/ { in_s = 1; next }
        /^[^ \t#]/ { in_s = 0 }
        in_s && /^[ \t]+dir:/ {
            sub(/^[^:]*:[ \t]*/, "")
            sub(/[ \t]*#.*$/, "")
            gsub(/["\047]/, "")
            print
            exit
        }')" || return 2
    [[ -z "$dir" ]] && return 2
    # shellcheck disable=SC2088  # literal ~ match is intentional
    if [[ "$dir" == "~/"* ]]; then dir="$HOME/${dir#\~/}"; fi
    "${sudo_cmd[@]}" test -d "$dir" || return 2

    local f content state pid name id files
    files="$("${sudo_cmd[@]}" find "$dir" -maxdepth 1 -name '*.json' 2>/dev/null)" || return 2
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        content="$("${sudo_cmd[@]}" cat "$f" 2>/dev/null)" || continue
        state="$(printf '%s' "$content" | sed -n 's/.*"state":\([0-9][0-9]*\).*/\1/p')"
        [[ "$state" == "1" || "$state" == "2" ]] || continue
        pid="$(printf '%s' "$content" | sed -n 's/.*"agent_pid":\([0-9][0-9]*\).*/\1/p')"
        [[ -n "$pid" && "$pid" -gt 0 ]] || continue
        "${sudo_cmd[@]}" kill -0 "$pid" 2>/dev/null || continue
        id="$(printf '%s' "$content" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
        name="$(printf '%s' "$content" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
        printf '%s (%s, pid %s)\n' "${name:-unnamed}" "${id:-$(basename "$f" .json)}" "$pid"
    done <<< "$files"
    return 0
}

# guard_live_sessions <force> <where> <sessions-output> <detect-status>
# Errors out (exit 1) when live sessions exist and force != "true".
guard_live_sessions() {
    local force="$1" where="$2" output="$3" status="$4"
    if [[ "$status" -ne 0 ]]; then
        warn "Could not detect live sessions on $where (session persistence not configured or unreadable); continuing."
        return 0
    fi
    [[ -z "$output" ]] && return 0
    local count
    count="$(printf '%s\n' "$output" | grep -c .)"
    if [[ "$force" == "true" ]]; then
        warn "$count live session(s) on $where will be terminated (--force):"
        printf '%s\n' "$output" | sed 's/^/    /' >&2
        return 0
    fi
    printf '%s\n' "$output" | sed 's/^/    /' >&2
    error "$count live session(s) on $where would be terminated by restarting agentd (PTY children die with the daemon). Stop/finish them first, or re-run with --force."
}
