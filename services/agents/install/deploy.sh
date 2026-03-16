#!/usr/bin/env bash
set -euo pipefail

# Deploy agentd to a named host.
# Handles both local (macOS/launchd) and remote (Linux/systemd via SSH) targets.
#
# Usage: bash install/deploy.sh --name <agent-name> [--host <ssh-host>] [--hub-url <ws-url>]
#   --name       Agent name for hub registration (e.g., bootsy, mac)
#   --host       SSH hostname for remote deploy. Omit for local macOS install.
#   --hub-url    Hub WebSocket URL (default: ws://127.0.0.1:4200/ws/agent for local,
#                wss://cadence.bootsy.internal/ws/agent for remote)
#   --hub-env    Path to agent-hub env file to read HUB_AGENT_TOKEN from.
#                For remote: reads from --hub-host:/etc/agent-hub/env
#   --hub-host   SSH host where agent-hub runs, for reading tokens (default: bootsy)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NAME=""
HOST=""
HUB_URL=""
HUB_HOST="bootsy"
LABEL="com.cadence.agentd"

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

sed_escape() {
    printf '%s' "$1" | sed 's/[&/|\\]/\\&/g'
}

# --- Argument parsing ---

while [[ $# -gt 0 ]]; do
    case "$1" in
        --name) NAME="$2"; shift 2 ;;
        --host) HOST="$2"; shift 2 ;;
        --hub-url) HUB_URL="$2"; shift 2 ;;
        --hub-host) HUB_HOST="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $(basename "$0") --name <agent-name> [--host <ssh-host>] [--hub-url <ws-url>] [--hub-host <ssh-host>]"
            exit 0
            ;;
        *) error "Unknown argument: $1" ;;
    esac
done

[[ -z "$NAME" ]] && error "--name is required"

# --- Detect deploy mode ---

if [[ -n "$HOST" ]]; then
    MODE="remote"
    [[ -z "$HUB_URL" ]] && HUB_URL="ws://127.0.0.1:4200/ws/agent"
else
    MODE="local"
    [[ -z "$HUB_URL" ]] && HUB_URL="wss://cadence.bootsy.internal/ws/agent"
fi

info "Deploying agentd '$NAME' ($MODE)..."

# --- Read HUB_AGENT_TOKEN from hub's env file ---

info "Reading HUB_AGENT_TOKEN from $HUB_HOST..."
HUB_AGENT_TOKEN="$(ssh "$HUB_HOST" "grep '^HUB_AGENT_TOKEN=' /etc/agent-hub/env | cut -d= -f2")"
if [[ -z "$HUB_AGENT_TOKEN" ]]; then
    error "Could not read HUB_AGENT_TOKEN from $HUB_HOST:/etc/agent-hub/env. Deploy agent-hub first."
fi

# ===========================================================================
# Remote deploy (Linux/systemd via SSH)
# ===========================================================================

deploy_remote() {
    local binary="$SERVICE_DIR/agentd-linux"
    if [[ ! -f "$binary" ]]; then
        error "Linux binary not found at $binary. Run 'GOOS=linux GOARCH=amd64 go build -o agentd-linux ./cmd/agentd' first."
    fi

    local remote_binary="/usr/local/bin/agentd"
    local remote_config_dir="/etc/agentd"
    local remote_config="$remote_config_dir/config.yaml"
    local remote_env="$remote_config_dir/env"

    # Stop service
    info "Stopping agentd on $HOST..."
    ssh "$HOST" "sudo systemctl stop agentd 2>/dev/null || true"

    # Copy binary
    info "Copying binary to $HOST:$remote_binary..."
    scp "$binary" "$HOST:/tmp/agentd"
    ssh "$HOST" "sudo mv /tmp/agentd $remote_binary && sudo chmod 755 $remote_binary"

    # Ensure config dir
    ssh "$HOST" "sudo mkdir -p $remote_config_dir"

    # Write env file with hub token
    info "Writing env file..."
    ssh "$HOST" "printf 'HUB_AGENT_TOKEN=%s\n' '$HUB_AGENT_TOKEN' | sudo tee $remote_env > /dev/null && sudo chmod 600 $remote_env"

    # Add hub section to config if missing
    if ssh "$HOST" "grep -q '^hub:' $remote_config 2>/dev/null"; then
        info "Hub config already present in $HOST:$remote_config"
    else
        info "Adding hub section to $HOST:$remote_config..."
        ssh "$HOST" "sudo tee -a $remote_config > /dev/null" <<EOF

hub:
  url: "$HUB_URL"
  name: "$NAME"
  token_env_var: "HUB_AGENT_TOKEN"
  reconnect_interval: "5s"
EOF
    fi

    # Ensure EnvironmentFile in systemd unit
    if ssh "$HOST" "grep -q 'EnvironmentFile' /etc/systemd/system/agentd.service 2>/dev/null"; then
        info "EnvironmentFile already present in systemd unit."
    else
        info "Adding EnvironmentFile to agentd systemd unit..."
        ssh "$HOST" "sudo sed -i '/^\[Service\]/a EnvironmentFile=$remote_env' /etc/systemd/system/agentd.service"
    fi

    # Restart
    info "Restarting agentd on $HOST..."
    ssh "$HOST" "sudo systemctl daemon-reload && sudo systemctl enable agentd && sudo systemctl restart agentd"

    sleep 2
    if ssh "$HOST" "systemctl is-active agentd >/dev/null 2>&1"; then
        info "agentd is running on $HOST."
    else
        warn "agentd may not have started. Check: ssh $HOST journalctl -u agentd -n 20"
    fi
}

# ===========================================================================
# Local deploy (macOS/launchd)
# ===========================================================================

deploy_local() {
    local binary="$SERVICE_DIR/agentd"
    if [[ ! -f "$binary" ]]; then
        # Try building
        if command -v go >/dev/null 2>&1 && [[ -f "$SERVICE_DIR/go.mod" ]]; then
            info "Building agentd from source..."
            (cd "$SERVICE_DIR" && go build -o agentd ./cmd/agentd)
        else
            error "No agentd binary found. Run 'make build' first."
        fi
    fi

    local bin_dir="$HOME/bin"
    local config_dir="$HOME/.config/agentd"
    local config_file="$config_dir/config.yaml"
    local env_file="$config_dir/env"
    local start_script="$config_dir/start.sh"
    local root_dir="$HOME/lib/agentd"
    local plist_dir="$HOME/Library/LaunchAgents"
    local plist_file="$plist_dir/$LABEL.plist"

    # Create directories
    mkdir -p "$bin_dir" "$config_dir" "$root_dir" "$plist_dir"

    # Kill stale agentd processes (port conflict prevention)
    info "Checking for stale agentd processes..."
    if pgrep -f "agentd" >/dev/null 2>&1; then
        info "Stopping existing agentd processes..."
        launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
        sleep 1
        # Kill any remaining agentd processes
        pkill -f "agentd --config" 2>/dev/null || true
        sleep 1
    fi

    # Install binary
    info "Installing binary to $bin_dir/agentd..."
    cp "$binary" "$bin_dir/agentd"
    chmod 755 "$bin_dir/agentd"

    # Write env file
    info "Writing env file..."
    printf 'HUB_AGENT_TOKEN=%s\n' "$HUB_AGENT_TOKEN" > "$env_file"
    chmod 600 "$env_file"

    # Write config if missing
    if [[ -f "$config_file" ]]; then
        # Add hub section if missing
        if grep -q '^hub:' "$config_file" 2>/dev/null; then
            info "Hub config already present in $config_file"
        else
            info "Adding hub section to $config_file..."
            cat >> "$config_file" <<EOF

hub:
  url: "$HUB_URL"
  name: "$NAME"
  token_env_var: "HUB_AGENT_TOKEN"
  reconnect_interval: "5s"
EOF
        fi
    else
        info "Installing default config to $config_file..."
        cp "$SERVICE_DIR/config.example.yaml" "$config_file"
        # Override defaults for macOS
        cat >> "$config_file" <<EOF

# Hub registration
hub:
  url: "$HUB_URL"
  name: "$NAME"
  token_env_var: "HUB_AGENT_TOKEN"
  reconnect_interval: "5s"
EOF
        # Update root_dir to macOS path
        sed -i '' "s|root_dir: \"/var/lib/agentd\"|root_dir: \"$root_dir\"|" "$config_file"
    fi

    # Write start script (launchd doesn't support EnvironmentFile)
    info "Writing start script..."
    cat > "$start_script" <<SCRIPT
#!/bin/bash
set -a
source "\$HOME/.config/agentd/env"
set +a
exec "\$HOME/bin/agentd" --config "\$HOME/.config/agentd/config.yaml"
SCRIPT
    chmod 755 "$start_script"

    # Write launchd plist
    info "Installing launchd plist..."
    cat > "$plist_file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$start_script</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$root_dir</string>
  <key>StandardOutPath</key>
  <string>$root_dir/agentd.log</string>
  <key>StandardErrorPath</key>
  <string>$root_dir/agentd.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$HOME/bin</string>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
</dict>
</plist>
PLIST

    # Load plist
    info "Loading launchd service..."
    launchctl bootstrap "gui/$(id -u)" "$plist_file"

    sleep 2
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
        info "agentd is running locally."
    else
        warn "agentd may not have started. Check: cat $root_dir/agentd.log"
    fi
}

# --- Dispatch ---

case "$MODE" in
    remote) deploy_remote ;;
    local)  deploy_local ;;
esac

info "Deploy complete!"
