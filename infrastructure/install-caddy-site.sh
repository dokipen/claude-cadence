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

vhost="${1:-}"
if [ -z "$vhost" ]; then
  usage
  exit 1
fi

# Validate hostname — RFC 1123 labels separated by dots
if ! printf '%s' "$vhost" | grep -qE '^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  err "Invalid hostname: $vhost"
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
${vhost} {
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

http://${vhost} {
	redir https://{host}{uri} permanent
}
EOF
)"

target="${CONF_DIR}/${SITE_FILE}"

log "Installing Caddy site block for ${vhost}..."
sudo mkdir -p "$CONF_DIR"
printf '%s\n' "$config" | sudo tee "$target" > /dev/null
sudo chmod 644 "$target"

log "Validating Caddy config..."
if ! sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  err "Caddy config validation failed — run 'caddy validate --config /etc/caddy/Caddyfile' for details"
fi

log "Reloading Caddy..."
sudo systemctl reload caddy

log "Done! Services available at:"
log "  https://${vhost}/graphql  — Issues GraphQL API"
log "  https://${vhost}/agents/  — Agents gRPC endpoint"
