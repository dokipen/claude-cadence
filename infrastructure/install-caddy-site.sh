#!/usr/bin/env bash
set -euo pipefail

CONF_DIR="/etc/caddy/conf.d"
SITE_FILE="cadence.caddy"

log() { printf '%s\n' "$@"; }
err() { printf 'Error: %s\n' "$@" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") <hostname>

Generate and install a Caddy site block for Claude Cadence services.

Example:
  $(basename "$0") cadence.bootsy.internal

The site block is installed to ${CONF_DIR}/${SITE_FILE} and Caddy is
reloaded. Requires sudo for writing to ${CONF_DIR}.
EOF
}

# --- Prerequisites ---

command -v caddy >/dev/null 2>&1 || err "caddy is not installed"
command -v systemctl >/dev/null 2>&1 || err "systemctl not found — this script requires systemd"

hostname="${1:-}"
if [ -z "$hostname" ]; then
  usage
  exit 1
fi

# Validate hostname (basic check — letters, digits, hyphens, dots)
if ! printf '%s' "$hostname" | grep -qE '^[a-zA-Z0-9.-]+$'; then
  err "Invalid hostname: $hostname"
fi

# Verify conf.d is imported by the main Caddyfile
if [ -f /etc/caddy/Caddyfile ]; then
  if ! grep -q "import.*/etc/caddy/conf\.d/" /etc/caddy/Caddyfile 2>/dev/null && \
     ! grep -q "import.*conf\.d/" /etc/caddy/Caddyfile 2>/dev/null; then
    err "/etc/caddy/Caddyfile does not import from ${CONF_DIR} — add 'import ${CONF_DIR}/*' first"
  fi
else
  err "/etc/caddy/Caddyfile not found"
fi

config="$(cat <<EOF
${hostname} {
	tls internal

	# Issues service — GraphQL API
	handle /graphql {
		reverse_proxy localhost:4000
	}

	# Agents service — gRPC
	handle /agents/* {
		uri strip_prefix /agents
		reverse_proxy localhost:4141 {
			transport http {
				versions h2c
			}
		}
	}

	handle {
		respond "Claude Cadence API Gateway" 200
	}
}

http://${hostname} {
	redir https://{host}{uri} permanent
}
EOF
)"

target="${CONF_DIR}/${SITE_FILE}"

log "Installing Caddy site block for ${hostname}..."
sudo mkdir -p "$CONF_DIR"
printf '%s\n' "$config" | sudo tee "$target" > /dev/null
sudo chmod 644 "$target"

log "Validating Caddy config..."
if ! sudo caddy validate --config /etc/caddy/Caddyfile 2>&1 | grep -q "Valid configuration"; then
  err "Caddy config validation failed — check ${target}"
fi

log "Reloading Caddy..."
sudo systemctl reload caddy

log "Done! Services available at:"
log "  https://${hostname}/graphql  — Issues GraphQL API"
log "  https://${hostname}/agents/  — Agents gRPC endpoint"
