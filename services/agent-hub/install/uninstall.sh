#!/usr/bin/env bash
set -euo pipefail

# agent-hub uninstaller
# Stops and removes the agent-hub service, binary, and optionally config/data.
# Runs locally on the target host (Linux/systemd only).

UNIT_NAME="agent-hub"
BINARY_PATH="/usr/local/bin/agent-hub"
CONFIG_DIR="/etc/agent-hub"

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

confirm() {
    local response
    printf "%s [y/N]: " "$1"
    read -r response
    [[ "$response" =~ ^[Yy]$ ]]
}

# --- Service removal ---

remove_systemd() {
    local unit="/etc/systemd/system/$UNIT_NAME.service"

    if [[ -f "$unit" ]]; then
        info "Stopping and removing systemd service..."
        sudo systemctl stop "$UNIT_NAME" 2>/dev/null || true
        sudo systemctl disable "$UNIT_NAME" 2>/dev/null || true
        sudo rm -f "$unit"
        sudo systemctl daemon-reload
        info "systemd service removed."
    else
        info "No systemd service found."
    fi
}

# --- Binary removal ---

remove_binary() {
    if [[ -f "$BINARY_PATH" ]]; then
        info "Removing binary $BINARY_PATH..."
        sudo rm -f "$BINARY_PATH"
        info "Binary removed."
    else
        info "No binary found at $BINARY_PATH."
    fi
}

# --- Config/data removal ---

remove_data() {
    if [[ -d "$CONFIG_DIR" ]]; then
        warn "Config directory exists: $CONFIG_DIR"
        warn "  This contains config.yaml and env (with auth tokens)."
        if confirm "Remove $CONFIG_DIR?"; then
            sudo rm -rf "$CONFIG_DIR"
            info "Removed $CONFIG_DIR"
        else
            info "Config directory preserved."
        fi
    else
        info "No config directory found."
    fi
}

# --- Main ---

main() {
    info "agent-hub uninstaller"
    echo

    if [[ "$(uname -s)" != "Linux" ]]; then
        error "agent-hub is only installed on Linux. This script must run on the target host."
    fi

    remove_systemd
    remove_binary
    remove_data

    echo
    info "Uninstall complete."
}

main "$@"
