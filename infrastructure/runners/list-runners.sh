#!/usr/bin/env bash
set -euo pipefail

# List all self-hosted GitHub Actions runners and their systemd service status.
# Usage: list-runners.sh [--user USER] [--base-dir DIR]

# --- Defaults ---

DEFAULT_USER="github-runner"

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

# --- Argument parsing ---

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --user USER             System user runners run under (default: $DEFAULT_USER)
  --base-dir DIR          Base directory for runner installs (default: /home/<user>)
  -h, --help              Show this help
EOF
    exit 0
}

RUNNER_USER="$DEFAULT_USER"
BASE_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --user)     RUNNER_USER="$2"; shift 2 ;;
        --base-dir) BASE_DIR="$2"; shift 2 ;;
        -h|--help)  usage ;;
        *)          error "Unknown option: $1" ;;
    esac
done

[[ ! "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] && error "Invalid user name: '$RUNNER_USER'."
[[ -z "$BASE_DIR" ]] && BASE_DIR="/home/$RUNNER_USER"

case "$BASE_DIR" in
    *..*)  error "Invalid base-dir: '$BASE_DIR'. Path traversal not allowed." ;;
esac
[[ "$BASE_DIR" != /* ]] && error "Invalid base-dir: '$BASE_DIR'. Must be an absolute path."

# --- Main ---

main() {
    info "GitHub Actions Runners"
    info "  User: $RUNNER_USER"
    info "  Base: $BASE_DIR"
    echo

    if [[ ! -d "$BASE_DIR" ]]; then
        warn "Base directory $BASE_DIR does not exist."
        return 0
    fi

    local found=0
    for runner_dir in "$BASE_DIR"/actions-runner-*/; do
        [[ -d "$runner_dir" ]] || continue
        found=$((found + 1))

        local dir_name
        dir_name="$(basename "$runner_dir")"

        # Extract runner name from .runner config if available
        local runner_name="(unknown)"
        if [[ -f "$runner_dir/.runner" ]]; then
            if command -v jq >/dev/null 2>&1; then
                runner_name=$(jq -r '.agentName // "(unknown)"' "$runner_dir/.runner" 2>/dev/null || echo "(unknown)")
            else
                runner_name=$(grep -o '"agentName":"[^"]*"' "$runner_dir/.runner" 2>/dev/null | cut -d'"' -f4 || echo "(unknown)")
            fi
        fi

        # Find the systemd service name
        local svc_name=""
        if [[ -f "$runner_dir/.service" ]]; then
            svc_name=$(cat "$runner_dir/.service")
        fi

        # Get service status (validate service name before passing to systemctl)
        local status="unknown"
        if [[ -n "$svc_name" ]] && [[ "$svc_name" =~ ^[A-Za-z0-9_.@-]+$ ]] && command -v systemctl >/dev/null 2>&1; then
            status=$(systemctl is-active "$svc_name" 2>/dev/null || echo "inactive")
        fi

        printf "  %-40s  %-20s  %s\n" "$dir_name" "$runner_name" "$status"
    done

    if [[ $found -eq 0 ]]; then
        info "No runners found in $BASE_DIR."
    else
        echo
        info "$found runner(s) found."
    fi
}

main "$@"
