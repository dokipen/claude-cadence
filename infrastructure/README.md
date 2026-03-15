# Infrastructure — Caddy Reverse Proxy

Caddy provides a single entry point for the Claude Cadence backend services with automatic HTTPS for production deployments.

## Prerequisites

Install Caddy: https://caddyserver.com/docs/install

## Routes

| Path | Upstream | Protocol |
|------|----------|----------|
| `/graphql` | `localhost:4000` | HTTP — Issues service (GraphQL) |
| `/agents/*` | `localhost:4141` | gRPC (h2c) — Agent service |

## Development (localhost)

Start both backend services first, then run Caddy:

```bash
caddy run --config infrastructure/Caddyfile
```

This binds to `http://localhost` with no TLS. The services are available at:

- `http://localhost/graphql` — Issues GraphQL API
- `http://localhost/agents/` — Agents gRPC endpoint

## Production

Set the `CADENCE_DOMAIN` environment variable to enable automatic HTTPS:

```bash
CADENCE_DOMAIN=cadence.example.com caddy run --config infrastructure/Caddyfile
```

Caddy will automatically obtain and renew TLS certificates via Let's Encrypt for the configured domain.

**gRPC clients:** In production mode, Caddy terminates TLS at the edge and forwards to the agents service over plaintext h2c internally. gRPC clients must connect to Caddy using TLS (e.g., `grpcurl cadence.example.com:443 ...` instead of `-plaintext`).
