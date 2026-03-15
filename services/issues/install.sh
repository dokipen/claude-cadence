#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="com.claude-cadence.issues"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
DOCKER_BIN="$(command -v docker 2>/dev/null || echo "/usr/bin/docker")"

# --- Helpers ---

log() { printf '%s\n' "$@"; }
err() { printf 'Error: %s\n' "$@" >&2; exit 1; }

ensure_docker() {
  command -v docker >/dev/null 2>&1 || err "docker is not installed"
  docker compose version >/dev/null 2>&1 || err "docker compose plugin is not installed"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    log "Generating .env with random JWT_SECRET..."
    local secret
    secret=$(openssl rand -base64 32)
    (umask 077 && cat > "$ENV_FILE" <<EOF
JWT_SECRET="$secret"
EOF
    )
  fi
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      err "Unsupported OS: $(uname -s)" ;;
  esac
}

build_image() {
  log "Building Docker image (bypassing cache)..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --no-cache
}

# --- launchd (macOS) ---

launchd_plist_path() {
  echo "$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
}

launchd_install() {
  local plist
  plist=$(launchd_plist_path)
  mkdir -p "$(dirname "$plist")"

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${DOCKER_BIN}</string>
    <string>compose</string>
    <string>--env-file</string>
    <string>${ENV_FILE}</string>
    <string>-f</string>
    <string>${COMPOSE_FILE}</string>
    <string>up</string>
    <string>--wait</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>StandardOutPath</key>
  <string>${SCRIPT_DIR}/issues-service.log</string>
  <key>StandardErrorPath</key>
  <string>${SCRIPT_DIR}/issues-service.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
EOF

  # Unload first for idempotent re-installs
  launchctl bootout "gui/$(id -u)/$SERVICE_NAME" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  log "launchd service installed and started"
}

launchd_uninstall() {
  local plist
  plist=$(launchd_plist_path)
  if [ -f "$plist" ]; then
    launchctl bootout "gui/$(id -u)/$SERVICE_NAME" 2>/dev/null || true
    rm -f "$plist"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down 2>/dev/null || true
    log "launchd service uninstalled"
  else
    log "Service not installed"
  fi
}

launchd_status() {
  local plist
  plist=$(launchd_plist_path)
  if [ ! -f "$plist" ]; then
    log "Service not installed"
    return 1
  fi
  if launchctl list "$SERVICE_NAME" >/dev/null 2>&1; then
    log "Service: installed and loaded"
    launchctl list "$SERVICE_NAME" 2>/dev/null || true
  else
    log "Service: installed but not loaded"
  fi
  log ""
  log "Container status:"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps 2>/dev/null || log "  (not running)"
}

# --- systemd (Linux) ---

systemd_unit_path() {
  echo "$HOME/.config/systemd/user/${SERVICE_NAME}.service"
}

systemd_install() {
  local unit
  unit=$(systemd_unit_path)
  mkdir -p "$(dirname "$unit")"

  cat > "$unit" <<EOF
[Unit]
Description=Claude Cadence Issues Service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${DOCKER_BIN} compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d
ExecStop=${DOCKER_BIN} compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" down

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME"
  log "systemd user service installed and started"
}

systemd_uninstall() {
  local unit
  unit=$(systemd_unit_path)
  if [ -f "$unit" ]; then
    systemctl --user disable --now "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$unit"
    systemctl --user daemon-reload
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down 2>/dev/null || true
    log "systemd service uninstalled"
  else
    log "Service not installed"
  fi
}

systemd_status() {
  local unit
  unit=$(systemd_unit_path)
  if [ ! -f "$unit" ]; then
    log "Service not installed"
    return 1
  fi
  systemctl --user status "$SERVICE_NAME" --no-pager 2>/dev/null || true
  log ""
  log "Container status:"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps 2>/dev/null || log "  (not running)"
}

# --- CLI installation ---

install_cli() {
  local cli_dir="$SCRIPT_DIR/../issues-cli"
  if [ -d "$cli_dir" ]; then
    log "Installing issues CLI..."
    (cd "$cli_dir" && npm install && npm run build)
    # npm link writes to the global node_modules which may require elevated
    # privileges on Linux. Try without sudo first, fall back to sudo.
    local link_err
    link_err=$(mktemp)
    if (cd "$cli_dir" && npm link 2>"$link_err"); then
      rm -f "$link_err"
    elif command -v sudo >/dev/null 2>&1; then
      log "npm link failed ($(cat "$link_err")), retrying with sudo..."
      rm -f "$link_err"
      (cd "$cli_dir" && sudo npm link) || err "sudo npm link failed in $cli_dir"
    else
      local reason
      reason=$(cat "$link_err")
      rm -f "$link_err"
      err "npm link failed ($reason) and sudo is not available. Run 'sudo npm link' manually in $cli_dir"
    fi
    log "CLI installed. Run 'issues --help' to verify."
  else
    log "Warning: issues-cli directory not found at $cli_dir, skipping CLI install"
  fi
}

uninstall_cli() {
  local cli_dir="$SCRIPT_DIR/../issues-cli"
  if [ -d "$cli_dir" ]; then
    log "Unlinking issues CLI..."
    (cd "$cli_dir" && npm unlink -g @claude-cadence/issues-cli 2>/dev/null || true)
    log "CLI unlinked"
  fi
}

# --- Main ---

usage() {
  cat <<EOF
Usage: $(basename "$0") [install|uninstall|status]

Manage the Claude Cadence issues microservice.

Commands:
  install     Install and start the service (default)
  uninstall   Stop and remove the service
  status      Show service status

The install command:
  - Ensures a .env file with JWT_SECRET exists
  - Builds and starts the Docker Compose stack
  - Registers a launchd (macOS) or systemd (Linux) service for auto-start
  - Installs the issues CLI globally
EOF
}

cmd="${1:-install}"

case "$cmd" in
  install)
    ensure_docker
    ensure_env
    build_image
    install_cli
    os=$(detect_os)
    case "$os" in
      macos) launchd_install ;;
      linux) systemd_install ;;
    esac
    log ""
    log "Issues service is running at http://localhost:4000"
    log "Authenticate the CLI: issues auth login --pat <github-pat>"
    ;;
  uninstall)
    os=$(detect_os)
    case "$os" in
      macos) launchd_uninstall ;;
      linux) systemd_uninstall ;;
    esac
    uninstall_cli
    ;;
  status)
    os=$(detect_os)
    case "$os" in
      macos) launchd_status ;;
      linux) systemd_status ;;
    esac
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
