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

	# Strip server identity headers
	header {
		-Server
	}

	# Rate limiting — per client IP, 60 requests per minute.
	# Allows short bursts while preventing sustained abuse.
	# Requires the caddy-ratelimit module (github.com/mholt/caddy-ratelimit).
	rate_limit {
		zone api_zone {
			key    {http.request.remote.host}
			events 60
			window 1m
		}
	}

	# Issues service — GraphQL API
	handle /graphql {
		reverse_proxy localhost:4000
	}

	# Agents service — gRPC
	@grpc path_regexp ^/agents\.v1\.
	handle @grpc {
		reverse_proxy localhost:4141 {
			transport http {
				versions h2c
			}
		}
	}

	# Agent Hub — REST API
	handle /api/v1/* {
		reverse_proxy localhost:4200
	}

	# Agent Hub — agent WebSocket registration
	handle /ws/agent {
		reverse_proxy localhost:4200
	}

	# Agent Hub — terminal WebSocket proxy
	handle /ws/terminal/* {
		reverse_proxy localhost:4200
	}

	# Issues UI — static SPA with client-side routing
	handle {
		root * /srv/issues-ui/current
		try_files {path} /index.html
		file_server
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
log "  https://${vhost}/          — Issues UI"
log "  https://${vhost}/graphql   — Issues GraphQL API"
log "  https://${vhost}/agents.v1.AgentService/<Method>  — Agents gRPC endpoint"
log "  https://${vhost}/api/v1/   — Agent Hub REST API"
