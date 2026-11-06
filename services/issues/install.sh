#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="com.claude-cadence.issues"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
# Resolved from the invoking user's PATH and baked into the unit (which runs as
# that same user), so it carries no more privilege than the user already has.
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
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --no-cache \
    || err "Docker image build failed. Check network connectivity and Dockerfile syntax."
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
    <string>--force-recreate</string>
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
# System-level unit: starts at boot and does not depend on any login session.

systemd_unit_path() {
  echo "/etc/systemd/system/${SERVICE_NAME}.service"
}

systemd_legacy_unit_path() {
  echo "$HOME/.config/systemd/user/${SERVICE_NAME}.service"
}

# Run a command as root, using sudo only when not already root.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || err "sudo is required to manage the system-level systemd unit (run as root or install sudo)"
    sudo "$@"
  fi
}

# Refuse to run as root: the unit must run as the invoking non-root user, and
# the script elevates itself (via sudo) only for the steps that need it.
ensure_not_root() {
  if [ "$(id -u)" -eq 0 ]; then
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
      err "do not run 'sudo ./install.sh'. Run it as your normal user ($SUDO_USER); the script uses sudo only where needed."
    fi
    err "do not run this script as root. Run it as your normal user; the script uses sudo only where needed."
  fi
}

# Reject values that would break (or inject into) the generated unit file.
# Characters rejected: double quote, newline, %, $, backslash.
reject_unsafe_unit_value() {
  local name="$1" value="$2"
  case "$value" in
    *\"*|*$'\n'*|*%*|*\$*|*\\*)
      err "$name contains an unsupported character (one of: double quote, newline, %, \$, backslash): $value" ;;
  esac
}

# Remove the legacy `systemd --user` unit (if any). Does NOT stop containers:
# the old unit's ExecStop is `compose stop`, so `disable --now` would stop them.
# The new unit's `up -d --force-recreate` recreates the container (brief restart).
systemd_migrate_legacy() {
  local legacy
  legacy=$(systemd_legacy_unit_path)
  if [ -f "$legacy" ]; then
    log "Migrating legacy systemd user unit to a system unit..."
    # No --now: disabling only removes the enablement symlinks and does not
    # run the old unit's ExecStop (`compose stop`).
    systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$legacy"
    systemctl --user daemon-reload 2>/dev/null || true
    log "Legacy user unit removed. 'loginctl enable-linger' is no longer needed."
  fi
}

systemd_install() {
  local unit run_user run_group run_home
  unit=$(systemd_unit_path)
  ensure_not_root
  run_user=$(id -un)
  [[ "$run_user" =~ ^[a-z_][a-z0-9_-]*\$ ]] || err "unsupported user name: $run_user"
  id -u "$run_user" >/dev/null 2>&1 || err "cannot resolve user: $run_user"
  run_group=$(id -gn "$run_user")
  run_home="$HOME"

  reject_unsafe_unit_value SCRIPT_DIR "$SCRIPT_DIR"
  reject_unsafe_unit_value DOCKER_BIN "$DOCKER_BIN"
  reject_unsafe_unit_value ENV_FILE "$ENV_FILE"
  reject_unsafe_unit_value COMPOSE_FILE "$COMPOSE_FILE"
  reject_unsafe_unit_value run_home "$run_home"

  systemd_migrate_legacy

  as_root tee "$unit" >/dev/null <<UNIT
[Unit]
Description=Claude Cadence Issues Service
After=network-online.target docker.service
Wants=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=${run_user}
Group=${run_group}
Environment="HOME=${run_home}"
WorkingDirectory="${SCRIPT_DIR}"
ExecStart="${DOCKER_BIN}" compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --force-recreate --wait
# Stopping the unit must NOT tear down the stack. The container uses
# restart: unless-stopped; explicit teardown is only done by './install.sh uninstall'.
ExecStop=/bin/true
# Zero-downtime redeploy: sudo systemctl reload $SERVICE_NAME
# Builds the new image, then --force-recreate --wait starts the new container
# and waits for it to pass the health check before returning.
ExecReload="${DOCKER_BIN}" compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --force-recreate --wait

[Install]
WantedBy=multi-user.target
UNIT

  as_root systemctl daemon-reload
  as_root systemctl enable --now "$SERVICE_NAME"
  log "systemd system service installed and started"
}

systemd_uninstall() {
  local unit
  unit=$(systemd_unit_path)
  ensure_not_root
  systemd_migrate_legacy
  if [ -f "$unit" ]; then
    as_root systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
    as_root rm -f "$unit"
    as_root systemctl daemon-reload
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down \
      || log "Warning: 'docker compose down' failed; containers may still be running"
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
  systemctl status "$SERVICE_NAME" --no-pager 2>/dev/null || true
  log ""
  log "Container status:"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps 2>/dev/null || log "  (not running)"
}

# --- CLI installation ---

install_cli() {
  local cli_dir="$SCRIPT_DIR/../issues-cli"
  if [ ! -d "$cli_dir" ]; then
    log "Warning: issues-cli directory not found at $cli_dir, skipping CLI install"
    return 0
  fi
  log "Installing issues CLI..."
  # Install to a user-local prefix to avoid privilege escalation.
  local prefix="$HOME/.local"
  # 'npm link --prefix' breaks on npm 11.x (treats --prefix as the project dir),
  # so install the built package globally from its directory instead.
  if ! (
    set -e
    mkdir -p "$prefix/lib" "$prefix/bin"
    cd "$cli_dir"
    npm install
    npm run build
    npm install -g . --prefix "$prefix"
  ); then
    log "Warning: CLI install failed; the service install will continue."
    log "Install it later with: (cd \"$cli_dir\" && npm install && npm run build && npm install -g . --prefix \"$prefix\")"
    return 0
  fi
  if [[ ":$PATH:" != *":$prefix/bin:"* ]]; then
    log ""
    log "Add $prefix/bin to your PATH so the 'issues' command is available:"
    case "$(basename "$SHELL")" in
      bash) log "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc" ;;
      zsh)  log "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc" ;;
      *)    log "  Add \$HOME/.local/bin to your shell's PATH configuration" ;;
    esac
    log ""
  fi
  log "CLI installed. Run 'issues --help' to verify."
}

uninstall_cli() {
  local cli_dir="$SCRIPT_DIR/../issues-cli"
  if [ -d "$cli_dir" ]; then
    log "Unlinking issues CLI..."
    local prefix="$HOME/.local"
    rm -f "$prefix/bin/issues"
    log "CLI unlinked"
  fi
}

# --- Main ---

usage() {
  cat <<EOF
Usage: $(basename "$0") [install|uninstall|status]

Manage the Claude Cadence issues microservice.

Run as your normal user, NOT as root and NOT via 'sudo ./install.sh'. On Linux
the script invokes sudo itself only for the steps that need it, and the
service runs as the invoking user (who must be in the docker group).

Commands:
  install     Install and start the service (default)
  uninstall   Stop and remove the service and tear down the stack
  status      Show service status

The install command:
  - Ensures a .env file with JWT_SECRET exists
  - Builds and starts the Docker Compose stack
  - Registers a launchd user agent (macOS, starts on login) or a system-level
    systemd unit (Linux, starts at boot; requires sudo)
  - Migrates any legacy 'systemd --user' unit to the system unit (the
    container is recreated, so expect a brief restart)
  - Installs the issues CLI to ~/.local
EOF
}

cmd="${1:-install}"

case "$cmd" in
  install)
    ensure_docker
    ensure_env
    install_cli
    build_image
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
