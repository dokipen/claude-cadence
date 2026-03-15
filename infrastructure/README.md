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

### Security: enable agentd token auth

> **Important:** When exposing Caddy to a network (any non-localhost deployment), you **must** enable token authentication on `agentd`. By default, `agentd` skips auth when bound to loopback (`127.0.0.1`), but Caddy forwards external traffic to that loopback port — bypassing the bind-address guard.
>
> In your `agentd` config (`~/.config/agentd/config.yaml`):
>
> ```yaml
> auth:
>   mode: "token"
>   token_env_var: "AGENTD_TOKEN"
> ```
>
> Without this, anyone who can reach Caddy has unauthenticated access to the gRPC API.
