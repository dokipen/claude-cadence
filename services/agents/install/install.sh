#!/usr/bin/env bash
set -euo pipefail

# agentd interactive installer
# Installs the agent service as a system daemon using launchd (macOS) or systemd (Linux).

LABEL="com.cadence.agentd"
BINARY_NAME="agentd"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="4141"
DEFAULT_ROOT_DIR="/var/lib/agentd"
DEFAULT_CONFIG_DIR=""
DEFAULT_LOG_DIR=""
INSTALL_DIR="/usr/local/bin"

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

prompt() {
    local var_name="$1" prompt_text="$2" default="$3"
    local value
    printf "%s [%s]: " "$prompt_text" "$default"
    read -r value
    printf -v "$var_name" '%s' "${value:-$default}"
}

validate_username() {
    local name="$1"
    if [[ ! "$name" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
        error "Invalid username '$name'. Must match [a-z_][a-z0-9_-]{0,31}."
    fi
}

validate_port() {
    local port="$1"
    if [[ ! "$port" =~ ^[0-9]+$ ]] || [[ "$port" -lt 1 ]] || [[ "$port" -gt 65535 ]]; then
        error "Invalid port '$port'. Must be 1-65535."
    fi
}

confirm() {
    local response
    printf "%s [y/N]: " "$1"
    read -r response
    [[ "$response" =~ ^[Yy]$ ]]
}

# --- Platform detection ---

detect_os() {
    case "$(uname -s)" in
        Darwin) echo "darwin" ;;
        Linux)  echo "linux" ;;
        *)      error "Unsupported operating system: $(uname -s)" ;;
    esac
}

# --- Prerequisite checks ---

check_prerequisites() {
    info "Checking prerequisites..."
    local missing=()

    command -v git >/dev/null 2>&1 || missing+=("git")
    command -v tmux >/dev/null 2>&1 || missing+=("tmux")
    command -v ttyd >/dev/null 2>&1 || missing+=("ttyd")

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Required tools not found: ${missing[*]}. Please install them and re-run."
    fi

    command -v vault >/dev/null 2>&1 || warn "vault CLI not found (optional, needed for private repos)"

    info "Prerequisites satisfied."
}

# --- User management ---

setup_user() {
    local os="$1"
    prompt AGENTD_USER "User to run the service as" "$(whoami)"
    validate_username "$AGENTD_USER"

    if ! id "$AGENTD_USER" >/dev/null 2>&1; then
        info "User '$AGENTD_USER' does not exist."
        if confirm "Create system user '$AGENTD_USER'?"; then
            if [[ "$os" == "darwin" ]]; then
                # Find next available UID above 500 (system range).
                local next_uid
                next_uid=$(dscl . -list /Users UniqueID | awk '{if ($2 >= 500) max=$2} END {print max+1}')
                sudo dscl . -create "/Users/$AGENTD_USER"
                sudo dscl . -create "/Users/$AGENTD_USER" UniqueID "$next_uid"
                sudo dscl . -create "/Users/$AGENTD_USER" PrimaryGroupID 20
                sudo dscl . -create "/Users/$AGENTD_USER" UserShell /usr/bin/false
                sudo dscl . -create "/Users/$AGENTD_USER" NFSHomeDirectory "/var/empty"
                sudo dscl . -create "/Users/$AGENTD_USER" RealName "agentd service"
                info "Created user '$AGENTD_USER' (UID=$next_uid) on macOS."
            else
                sudo useradd --system --shell /usr/bin/false --create-home "$AGENTD_USER"
                info "Created system user '$AGENTD_USER'."
            fi
        else
            error "User '$AGENTD_USER' does not exist. Aborting."
        fi
    fi

    AGENTD_GROUP="$(id -gn "$AGENTD_USER")"
}

# --- Directory setup ---

setup_directories() {
    local os="$1"

    if [[ "$os" == "darwin" ]]; then
        DEFAULT_CONFIG_DIR="$HOME/.config/agentd"
        DEFAULT_LOG_DIR="$HOME/Library/Logs/agentd"
    else
        DEFAULT_CONFIG_DIR="/etc/agentd"
        DEFAULT_LOG_DIR="/var/log/agentd"
    fi

    prompt AGENTD_ROOT_DIR "Root directory for repos and worktrees" "$DEFAULT_ROOT_DIR"
    prompt AGENTD_CONFIG_DIR "Config directory" "$DEFAULT_CONFIG_DIR"
    prompt AGENTD_LOG_DIR "Log directory" "$DEFAULT_LOG_DIR"

    info "Creating directories..."
    sudo mkdir -p "$AGENTD_ROOT_DIR/repos" "$AGENTD_ROOT_DIR/worktrees"
    sudo chown -R "$AGENTD_USER:$AGENTD_GROUP" "$AGENTD_ROOT_DIR"

    sudo mkdir -p "$AGENTD_CONFIG_DIR"
    sudo mkdir -p "$AGENTD_LOG_DIR"
    sudo chown "$AGENTD_USER:$AGENTD_GROUP" "$AGENTD_CONFIG_DIR" "$AGENTD_LOG_DIR"
}

# --- Hub configuration ---

validate_yaml_string() {
    local value="$1" field="$2"
    if [[ "$value" == *'"'* || "$value" == *$'\n'* ]]; then
        error "$field must not contain double-quotes or newlines"
    fi
}

setup_hub() {
    echo
    info "Hub configuration (optional — connects this agent to an agent-hub)"
    if confirm "Connect this agent to an agent-hub?"; then
        prompt HUB_URL "Hub WebSocket URL" "wss://cadence.bootsy.internal/ws/agent"
        validate_yaml_string "$HUB_URL" "hub.url"
        prompt HUB_NAME "Agent name (identifier for this machine)" "$(hostname -s)"
        validate_yaml_string "$HUB_NAME" "hub.name"
        printf "Hub agent token (input hidden): "
        read -rs HUB_AGENT_TOKEN
        echo
        # Strip any accidentally-captured newlines (e.g. from terminal paste).
        HUB_AGENT_TOKEN="${HUB_AGENT_TOKEN//$'\n'/}"
        HUB_AGENT_TOKEN="${HUB_AGENT_TOKEN//$'\r'/}"
        if [[ -z "$HUB_AGENT_TOKEN" ]]; then
            warn "No hub token provided. The plist EnvironmentVariables will have an empty token; update it before starting the service."
        fi
    else
        HUB_URL=""
        HUB_NAME=""
        HUB_AGENT_TOKEN=""
    fi
}

# --- Config generation ---

generate_config() {
    local config_path="$AGENTD_CONFIG_DIR/config.yaml"

    if [[ -f "$config_path" ]]; then
        warn "Config already exists at $config_path"
        if ! confirm "Overwrite?"; then
            info "Keeping existing config."
            return
        fi
    fi

    info "Generating config at $config_path..."
    cat > "$config_path" <<EOF
# agentd configuration — generated by install.sh

host: "$AGENTD_HOST"
port: $AGENTD_PORT

root_dir: "$AGENTD_ROOT_DIR"

tmux:
  socket_name: "agentd"

ttyd:
  enabled: true
  base_port: 7681

log:
  level: "info"
  format: "json"

# Add agent profiles below:
profiles: {}
EOF

    if [[ -n "$HUB_URL" ]]; then
        cat >> "$config_path" <<EOF

# agent-hub connection
hub:
  url: "$HUB_URL"
  name: "$HUB_NAME"
  token_env_var: "HUB_AGENT_TOKEN"
  reconnect_interval: "5s"
EOF
        info "Hub config written (url=$HUB_URL, name=$HUB_NAME)"
    fi

    info "Config written to $config_path"
}

# --- Binary installation ---

install_binary() {
    local script_dir
    script_dir="$(cd "$(dirname "$0")" && pwd)"
    local service_dir
    service_dir="$(cd "$script_dir/.." && pwd)"

    if [[ -f "$service_dir/agentd" ]]; then
        info "Installing pre-built binary to $INSTALL_DIR/$BINARY_NAME..."
        sudo cp "$service_dir/agentd" "$INSTALL_DIR/$BINARY_NAME"
    elif command -v go >/dev/null 2>&1 && [[ -f "$service_dir/go.mod" ]]; then
        info "Building agentd from source..."
        (cd "$service_dir" && go build -o agentd ./cmd/agentd)
        sudo cp "$service_dir/agentd" "$INSTALL_DIR/$BINARY_NAME"
    else
        error "No agentd binary found and Go is not installed. Build first with 'make build'."
    fi

    sudo chmod 755 "$INSTALL_DIR/$BINARY_NAME"
    info "Binary installed to $INSTALL_DIR/$BINARY_NAME"
}

# --- Template rendering ---

sed_escape() {
    # Escape characters special to sed replacement strings.
    printf '%s' "$1" | sed 's/[&/|\\]/\\&/g'
}

render_template() {
    local template="$1" output="$2"
    sed \
        -e "s|__BINARY_PATH__|$(sed_escape "$INSTALL_DIR/$BINARY_NAME")|g" \
        -e "s|__CONFIG_PATH__|$(sed_escape "$AGENTD_CONFIG_DIR/config.yaml")|g" \
        -e "s|__USER__|$(sed_escape "$AGENTD_USER")|g" \
        -e "s|__GROUP__|$(sed_escape "$AGENTD_GROUP")|g" \
        -e "s|__ROOT_DIR__|$(sed_escape "$AGENTD_ROOT_DIR")|g" \
        -e "s|__LOG_DIR__|$(sed_escape "$AGENTD_LOG_DIR")|g" \
        -e "s|__HUB_AGENT_TOKEN__|$(sed_escape "${HUB_AGENT_TOKEN:-}")|g" \
        "$template" > "$output"
}

# --- Service installation ---

install_launchd() {
    local script_dir
    script_dir="$(cd "$(dirname "$0")" && pwd)"
    local plist_tmpl="$script_dir/agentd.plist.tmpl"
    local plist_dest="$HOME/Library/LaunchAgents/$LABEL.plist"

    if [[ ! -f "$plist_tmpl" ]]; then
        error "launchd template not found: $plist_tmpl"
    fi

    info "Installing launchd service..."
    mkdir -p "$HOME/Library/LaunchAgents"
    render_template "$plist_tmpl" "$plist_dest"
    chmod 600 "$plist_dest"

    # Unload if already loaded, ignore errors.
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

    launchctl bootstrap "gui/$(id -u)" "$plist_dest"
    info "launchd service installed and started."
}

install_systemd() {
    local script_dir
    script_dir="$(cd "$(dirname "$0")" && pwd)"
    local unit_tmpl="$script_dir/agentd.service.tmpl"
    local unit_dest="/etc/systemd/system/agentd.service"

    if [[ ! -f "$unit_tmpl" ]]; then
        error "systemd template not found: $unit_tmpl"
    fi

    info "Installing systemd service..."
    local rendered
    rendered="$(mktemp)"
    render_template "$unit_tmpl" "$rendered"
    sudo cp "$rendered" "$unit_dest"
    rm -f "$rendered"

    sudo systemctl daemon-reload
    sudo systemctl enable agentd
    sudo systemctl start agentd
    info "systemd service installed, enabled, and started."
}

# --- Health check ---

health_check() {
    info "Waiting for service to start..."
    local retries=10
    while [[ $retries -gt 0 ]]; do
        if command -v grpcurl >/dev/null 2>&1; then
            if grpcurl -plaintext "$AGENTD_HOST:$AGENTD_PORT" list >/dev/null 2>&1; then
                info "Service is healthy!"
                return 0
            fi
        else
            # Fall back to checking if the port is open.
            if (echo >/dev/tcp/"$AGENTD_HOST"/"$AGENTD_PORT") 2>/dev/null; then
                info "Service is listening on $AGENTD_HOST:$AGENTD_PORT"
                return 0
            fi
        fi
        retries=$((retries - 1))
        sleep 1
    done

    warn "Could not verify service health. Check logs at $AGENTD_LOG_DIR/"
    return 1
}

# --- Main ---

main() {
    info "agentd installer"
    echo

    local os
    os="$(detect_os)"
    info "Detected platform: $os"

    check_prerequisites
    setup_user "$os"

    prompt AGENTD_HOST "Host to bind to" "$DEFAULT_HOST"
    prompt AGENTD_PORT "Port to listen on" "$DEFAULT_PORT"
    validate_port "$AGENTD_PORT"

    setup_directories "$os"
    setup_hub
    install_binary
    generate_config

    case "$os" in
        darwin) install_launchd ;;
        linux)  install_systemd ;;
    esac

    health_check || true

    echo
    info "Installation complete!"
    info "Config: $AGENTD_CONFIG_DIR/config.yaml"
    info "Binary: $INSTALL_DIR/$BINARY_NAME"
    info "Root:   $AGENTD_ROOT_DIR"
    echo
    info "Next steps:"
    info "  1. Edit $AGENTD_CONFIG_DIR/config.yaml to add agent profiles"
    local next_step=2
    if [[ -n "$HUB_URL" ]]; then
        if [[ "$os" == "darwin" ]]; then
            info "  $next_step. To rotate the hub token, edit ~/Library/LaunchAgents/$LABEL.plist and reload the service."
        else
            info "  $next_step. To rotate the hub token, edit /etc/agentd/env and restart the service."
        fi
        next_step=$((next_step + 1))
    fi
    info "  $next_step. Restart the service after config changes:"
    if [[ "$os" == "darwin" ]]; then
        info "     launchctl kickstart -k gui/$(id -u)/$LABEL"
    else
        info "     sudo systemctl restart agentd"
    fi
}

main "$@"
