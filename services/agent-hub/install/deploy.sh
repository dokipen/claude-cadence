#!/usr/bin/env bash
set -euo pipefail

# Deploy agent-hub to bootsy (Linux/systemd).
# Builds the linux binary, copies it to bootsy, installs config + systemd unit,
# generates auth tokens if needed, and starts/restarts the service.
#
# Usage: bash install/deploy.sh [--host <hostname>]
#   --host   SSH hostname (default: bootsy)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

HOST="bootsy"
REMOTE_BINARY="/usr/local/bin/agent-hub"
REMOTE_CONFIG_DIR="/etc/agent-hub"
REMOTE_CONFIG="$REMOTE_CONFIG_DIR/config.yaml"
REMOTE_ENV="$REMOTE_CONFIG_DIR/env"
UNIT_NAME="agent-hub"
SERVICE_USER="doki_pen"

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

sed_escape() {
    printf '%s' "$1" | sed 's/[&/|\\]/\\&/g'
}

render_template() {
    local template="$1" output="$2"
    local group
    group="$(ssh "$HOST" "id -gn $SERVICE_USER")"
    sed \
        -e "s|__BINARY_PATH__|$(sed_escape "$REMOTE_BINARY")|g" \
        -e "s|__CONFIG_PATH__|$(sed_escape "$REMOTE_CONFIG")|g" \
        -e "s|__ENV_PATH__|$(sed_escape "$REMOTE_ENV")|g" \
        -e "s|__USER__|$(sed_escape "$SERVICE_USER")|g" \
        -e "s|__GROUP__|$(sed_escape "$group")|g" \
        "$template" > "$output"
}

# --- Argument parsing ---

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host) HOST="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $(basename "$0") [--host <hostname>]"
            echo "  --host   SSH hostname (default: bootsy)"
            exit 0
            ;;
        *) error "Unknown argument: $1" ;;
    esac
done

# --- Verify binary exists ---

BINARY="$SERVICE_DIR/agent-hub-linux"
if [[ ! -f "$BINARY" ]]; then
    error "Linux binary not found at $BINARY. Run 'make build-linux' first."
fi

info "Deploying agent-hub to $HOST..."

# --- Stop existing service (ignore if not running) ---

info "Stopping agent-hub service (if running)..."
ssh "$HOST" "sudo systemctl stop $UNIT_NAME 2>/dev/null || true"

# --- Copy binary ---

info "Copying binary to $HOST:$REMOTE_BINARY..."
scp "$BINARY" "$HOST:/tmp/agent-hub"
ssh "$HOST" "sudo mv /tmp/agent-hub $REMOTE_BINARY && sudo chmod 755 $REMOTE_BINARY"

# --- Ensure config directory ---

ssh "$HOST" "sudo mkdir -p $REMOTE_CONFIG_DIR && sudo chown $SERVICE_USER: $REMOTE_CONFIG_DIR && sudo chmod 750 $REMOTE_CONFIG_DIR"

# --- Install config (only if missing) ---

if ssh "$HOST" "test -f $REMOTE_CONFIG"; then
    info "Config already exists at $HOST:$REMOTE_CONFIG — keeping existing."
else
    info "Installing default config at $HOST:$REMOTE_CONFIG..."
    scp "$SERVICE_DIR/config.example.yaml" "$HOST:/tmp/agent-hub-config.yaml"
    ssh "$HOST" "sudo mv /tmp/agent-hub-config.yaml $REMOTE_CONFIG && sudo chown $SERVICE_USER: $REMOTE_CONFIG"
fi

# --- Token generation (idempotent) ---

info "Ensuring auth tokens exist..."
ssh "$HOST" bash <<'REMOTE_SCRIPT'
set -euo pipefail
ENV_FILE="/etc/agent-hub/env"

if [[ -f "$ENV_FILE" ]]; then
    echo "Existing env file found — reusing tokens."
else
    echo "Generating new auth tokens..."
    HUB_API_TOKEN="$(openssl rand -hex 32)"
    HUB_AGENT_TOKEN="$(openssl rand -hex 32)"
    sudo tee "$ENV_FILE" > /dev/null <<EOF
HUB_API_TOKEN=$HUB_API_TOKEN
HUB_AGENT_TOKEN=$HUB_AGENT_TOKEN
EOF
    sudo chmod 600 "$ENV_FILE"
    sudo chown doki_pen: "$ENV_FILE"
    echo "Tokens generated and written to $ENV_FILE"
fi
REMOTE_SCRIPT

# --- Install systemd unit ---

info "Installing systemd unit..."
local_unit="$(mktemp)"
render_template "$SCRIPT_DIR/agent-hub.service.tmpl" "$local_unit"
scp "$local_unit" "$HOST:/tmp/agent-hub.service"
rm -f "$local_unit"
ssh "$HOST" "sudo mv /tmp/agent-hub.service /etc/systemd/system/$UNIT_NAME.service"

# --- Start service ---

info "Starting agent-hub service..."
ssh "$HOST" "sudo systemctl daemon-reload && sudo systemctl enable $UNIT_NAME && sudo systemctl start $UNIT_NAME"

# --- Health check ---

info "Checking service status..."
sleep 2
if ssh "$HOST" "systemctl is-active $UNIT_NAME >/dev/null 2>&1"; then
    info "agent-hub is running on $HOST."
else
    warn "agent-hub may not have started. Check: ssh $HOST journalctl -u $UNIT_NAME -n 20"
fi

info "Deploy complete!"
