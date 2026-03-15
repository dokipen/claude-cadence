#!/usr/bin/env bash
set -euo pipefail

# List all self-hosted GitHub Actions runners and their service status.
# Usage: list-runners.sh [--user USER] [--base-dir DIR]

# --- Defaults ---

DEFAULT_USER="github-runner"

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

# --- Platform detection ---

detect_platform() {
    case "$(uname -s)" in
        Linux)  OS="linux" ;;
        Darwin) OS="darwin" ;;
        *)      error "Unsupported operating system: $(uname -s)" ;;
    esac
}

# --- Argument parsing ---

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --user USER             System user runners run under (default: $DEFAULT_USER, ignored on macOS)
  --base-dir DIR          Base directory for runner installs (default: platform-dependent)
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

detect_platform

[[ ! "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] && error "Invalid user name: '$RUNNER_USER'."

if [[ -z "$BASE_DIR" ]]; then
    if [[ "$OS" == "darwin" ]]; then
        BASE_DIR="$HOME/actions-runner"
    else
        BASE_DIR="/home/$RUNNER_USER"
    fi
fi

case "$BASE_DIR" in
    *..*)  error "Invalid base-dir: '$BASE_DIR'. Path traversal not allowed." ;;
esac
[[ "$BASE_DIR" != /* ]] && error "Invalid base-dir: '$BASE_DIR'. Must be an absolute path."

# --- Service status ---

get_service_status() {
    local svc_name="$1"

    # Validate service name
    if [[ ! "$svc_name" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
        echo "invalid"
        return
    fi

    if [[ "$OS" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
        systemctl is-active "$svc_name" 2>/dev/null || echo "inactive"
    elif [[ "$OS" == "darwin" ]] && command -v launchctl >/dev/null 2>&1; then
        # launchctl list exits 0 for loaded-but-crashed services.
        # Parse the PID field: a positive PID means running, "-" or "0" means not running.
        local pid
        pid=$(launchctl list "$svc_name" 2>/dev/null | awk '/PID/ {print $3}' || echo "")
        if [[ -n "$pid" ]] && [[ "$pid" != "-" ]] && [[ "$pid" -gt 0 ]] 2>/dev/null; then
            echo "active"
        elif launchctl list "$svc_name" >/dev/null 2>&1; then
            echo "loaded (not running)"
        else
            echo "inactive"
        fi
    else
        echo "unknown"
    fi
}

# --- Main ---

main() {
    info "GitHub Actions Runners"
    info "  User:     $RUNNER_USER"
    info "  Base:     $BASE_DIR"
    info "  Platform: $OS"
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

        # Find the service name
        local svc_name=""
        if [[ -f "$runner_dir/.service" ]]; then
            svc_name=$(cat "$runner_dir/.service")
        fi

        # Get service status
        local status="unknown"
        if [[ -n "$svc_name" ]]; then
            status=$(get_service_status "$svc_name")
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
