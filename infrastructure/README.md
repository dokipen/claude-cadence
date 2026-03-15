# Infrastructure — Caddy Reverse Proxy

Caddy provides a single entry point for the Claude Cadence backend services with TLS via Caddy's internal CA.

## Prerequisites

- Install Caddy: https://caddyserver.com/docs/install
- Trust Caddy's root CA on LAN clients (see [Caddy docs](https://caddyserver.com/docs/running#local-https))

## Routes

| Path | Upstream | Protocol |
|------|----------|----------|
| `/graphql` | `localhost:4000` | HTTP — Issues service (GraphQL) |
| `/agents.v1.*` | `localhost:4141` | gRPC (h2c) — Agent service |

## Usage

`CADENCE_DOMAIN` is required. Start both backend services first, then run Caddy:

```bash
CADENCE_DOMAIN=cadence.bootsy.internal caddy run --config infrastructure/Caddyfile
```

Caddy serves HTTPS on port 443 using its built-in CA and redirects HTTP (port 80) to HTTPS. Services are available at:

- `https://cadence.bootsy.internal/graphql` — Issues GraphQL API
- `https://cadence.bootsy.internal/agents.v1.AgentService/<Method>` — Agents gRPC endpoint (Caddy routes `/agents.v1.*`)

**DNS:** Ensure `CADENCE_DOMAIN` resolves to the host running Caddy on your LAN.

**gRPC clients:** Caddy terminates TLS at the edge and forwards to the agents service over plaintext h2c internally. gRPC clients must connect using TLS (e.g., `grpcurl cadence.bootsy.internal:443 ...` instead of `-plaintext`).

### Security notes

**Firewall:** Caddy binds on all interfaces (0.0.0.0). On multi-homed hosts, ensure firewall rules restrict ports 80/443 to your LAN.

### Enable agentd token auth

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
