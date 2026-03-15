#!/usr/bin/env bash
set -euo pipefail

# agentd uninstaller
# Stops and removes the agent service, binary, and optionally data.

LABEL="com.cadence.agentd"
BINARY_NAME="agentd"
INSTALL_DIR="/usr/local/bin"

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

detect_os() {
    case "$(uname -s)" in
        Darwin) echo "darwin" ;;
        Linux)  echo "linux" ;;
        *)      error "Unsupported operating system: $(uname -s)" ;;
    esac
}

# --- Service removal ---

remove_launchd() {
    local plist="$HOME/Library/LaunchAgents/$LABEL.plist"

    if [[ -f "$plist" ]]; then
        info "Stopping and removing launchd service..."
        launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
        rm -f "$plist"
        info "launchd service removed."
    else
        info "No launchd service found."
    fi
}

remove_systemd() {
    local unit="/etc/systemd/system/agentd.service"

    if [[ -f "$unit" ]]; then
        info "Stopping and removing systemd service..."
        sudo systemctl stop agentd 2>/dev/null || true
        sudo systemctl disable agentd 2>/dev/null || true
        sudo rm -f "$unit"
        sudo systemctl daemon-reload
        info "systemd service removed."
    else
        info "No systemd service found."
    fi
}

# --- Binary removal ---

remove_binary() {
    local binary="$INSTALL_DIR/$BINARY_NAME"
    if [[ -f "$binary" ]]; then
        info "Removing binary $binary..."
        sudo rm -f "$binary"
        info "Binary removed."
    else
        info "No binary found at $binary."
    fi
}

# --- Data removal ---

remove_data() {
    echo
    warn "The following directories may contain agentd data:"

    local dirs=()
    [[ -d "/var/lib/agentd" ]] && dirs+=("/var/lib/agentd")
    [[ -d "$HOME/.config/agentd" ]] && dirs+=("$HOME/.config/agentd")
    [[ -d "/etc/agentd" ]] && dirs+=("/etc/agentd")
    [[ -d "$HOME/Library/Logs/agentd" ]] && dirs+=("$HOME/Library/Logs/agentd")
    [[ -d "/var/log/agentd" ]] && dirs+=("/var/log/agentd")

    if [[ ${#dirs[@]} -eq 0 ]]; then
        info "No data directories found."
        return
    fi

    for dir in "${dirs[@]}"; do
        echo "  - $dir"
    done
    echo

    if confirm "Remove these directories?"; then
        for dir in "${dirs[@]}"; do
            sudo rm -rf "$dir"
            info "Removed $dir"
        done
    else
        info "Data directories preserved."
    fi
}

# --- Main ---

main() {
    info "agentd uninstaller"
    echo

    local os
    os="$(detect_os)"

    case "$os" in
        darwin) remove_launchd ;;
        linux)  remove_systemd ;;
    esac

    remove_binary
    remove_data

    echo
    info "Uninstall complete."
}

main "$@"
