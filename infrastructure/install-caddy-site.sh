#!/usr/bin/env bash
set -euo pipefail

CONF_DIR="/etc/caddy/conf.d"
SITE_FILE="cadence.caddy"

log() { printf '%s\n' "$@"; }
warn() { printf 'Warning: %s\n' "$@" >&2; }
err() { printf 'Error: %s\n' "$@" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [--force] <hostname>

Generate and install a Caddy site block for Claude Cadence services.

Options:
  --force    Bypass the agentd auth configuration check
  -h, --help Show this help message

Example:
  $(basename "$0") cadence.bootsy.internal

The site block is installed to ${CONF_DIR}/${SITE_FILE} and Caddy is
reloaded. Requires sudo for writing to ${CONF_DIR}.
EOF
}

# --- Prerequisites ---

command -v caddy >/dev/null 2>&1 || err "caddy is not installed"
command -v systemctl >/dev/null 2>&1 || err "systemctl not found — this script requires systemd"

# --- Arguments ---

force=false
vhost=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=true ;;
    -h|--help) usage; exit 0 ;;
    -*) err "Unknown option: $1" ;;
    *)
      [ -n "$vhost" ] && err "Unexpected argument: $1"
      vhost="$1"
      ;;
  esac
  shift
done

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

# Verify agentd token auth is configured — Caddy forwards external traffic to
# loopback, bypassing agentd's own bind-address guard.
AGENTD_CONFIG="${HOME}/.config/agentd/config.yaml"
if [ ! -f "$AGENTD_CONFIG" ] || ! grep -v '^\s*#' "$AGENTD_CONFIG" 2>/dev/null | grep -q 'mode:.*token'; then
  warn "agentd token authentication is not configured."
  printf '\n' >&2
  warn "  This Caddy site block forwards external traffic to agentd on localhost,"
  warn "  bypassing agentd's bind-address guard. Without token auth, the gRPC API"
  warn "  will be accessible to anyone on the network without authentication."
  printf '\n' >&2
  warn "  To fix, set auth.mode to \"token\" in:"
  warn "    ${AGENTD_CONFIG}"
  printf '\n' >&2
  warn "  Example:"
  warn "    auth:"
  warn "      mode: \"token\""
  warn "      token_env_var: \"AGENTD_TOKEN\""
  printf '\n' >&2
  if [ "$force" = true ]; then
    warn "Continuing anyway (--force)."
  else
    err "Aborting. Use --force to override this check."
  fi
fi

config="$(cat <<EOF
${vhost} {
	tls internal

	# Strip server identity headers
	header {
		-Server
	}

	# Rate limiting — per client IP, 300 requests per minute on API routes only.
	# Static assets, WebSocket connections, and SPA files are exempt.
	# Requires the caddy-ratelimit module (github.com/mholt/caddy-ratelimit).
	@api path_regexp ^/(graphql|api/v1/|agents\.v1\.)
	rate_limit @api {
		zone api_zone {
			key    {http.request.remote.host}
			events 300
			window 1m
		}
	}

	# Rate limiting — per client IP on WebSocket connection establishment.
	@ws path_regexp ^/ws/
	rate_limit @ws {
		zone ws_zone {
			key    {http.request.remote.host}
			events ${WS_RATE_LIMIT_EVENTS:-30}
			window ${WS_RATE_LIMIT_WINDOW:-1m}
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
	# Inject the API token server-side so the browser never handles it.
	handle /api/v1/* {
		reverse_proxy localhost:4200 {
			header_up Authorization "Bearer {env.HUB_API_TOKEN}"
		}
	}

	# Agent Hub — agent WebSocket registration
	handle /ws/agent {
		reverse_proxy localhost:4200
	}

	# Agent Hub — terminal WebSocket proxy
	# Inject the API token server-side so the browser never handles it.
	handle /ws/terminal/* {
		reverse_proxy localhost:4200 {
			header_up Authorization "Bearer {env.HUB_API_TOKEN}"
		}
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
