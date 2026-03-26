# Dev Environment

A single-command local stack for manual PR QA.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with the Compose plugin (`docker compose`)
- A [GitHub OAuth app](https://github.com/settings/developers) configured for local use

## Quick Start

```bash
# 1. Copy the example env file and fill in your secrets
cp .env.dev.example .env.dev
$EDITOR .env.dev

# 2. Start the full stack (issues API + issues UI + Caddy + agent-hub + agentd)
docker compose -f docker-compose.dev.yml up --build
```

The stack is ready when you see Caddy and the issues-ui start logging.
Open **http://localhost** in your browser.

## Dev Data Seeding

The dev environment automatically seeds a `claude-cadence` project on startup via `prisma/seed.ts`
(enabled by `DEV_SEED=1` set in `docker-compose.dev.yml`).
After `docker compose -f docker-compose.dev.yml up`, the `claude-cadence` project is immediately
available in the UI — no manual database surgery needed for basic usage.

## GitHub OAuth App Setup

Create a GitHub OAuth app at https://github.com/settings/developers:

| Field | Value |
|-------|-------|
| Homepage URL | `http://localhost` |
| Authorization callback URL | `http://localhost/auth/github/callback` |

Copy the **Client ID** and **Client Secret** into `.env.dev`.

## Testing a PR Branch

```bash
# Fetch the PR branch
git fetch origin pull/<PR-NUMBER>/head:<BRANCH-NAME>

# In your worktree or checkout, rebuild the affected service(s)
docker compose -f docker-compose.dev.yml up --build issues
# or rebuild issues-ui
docker compose -f docker-compose.dev.yml up --build issues-ui
```

Source changes to `services/issues-ui/` are reflected immediately via Vite's hot module
replacement — no rebuild needed for frontend edits.

Changes to `services/issues/` (backend) require a rebuild of the `issues` container.

## Service Routes

All traffic goes through Caddy at `http://localhost`:

| Path | Service |
|------|---------|
| `/graphql` | issues API (port 4000) |
| `/api/v1/*` | agent-hub (port 4200) |
| `/ws/terminal/*` | agent-hub WebSocket |
| everything else | issues-ui Vite dev server (port 5173) |

## Agent Services

`agentd` and `agent-hub` are included in the default stack as fully containerized services.
Both are built from source automatically — no manual installation required.

**Prerequisites:**
- Fill in `HUB_API_TOKEN`, `HUB_AGENT_TOKEN`, and `AGENTD_TOKEN` in `.env.dev`
- Ensure `~/.claude` exists with valid `claude` CLI credentials (agentd mounts this from the host)

agentd mounts `~/.claude` from your host so the `claude` CLI inside the container authenticates
with your existing credentials — no separate secret management needed.

### Quick Start: Agent Sessions

1. Fill in the agent token variables in `.env.dev`:
   ```
   HUB_API_TOKEN=change-me
   HUB_AGENT_TOKEN=change-me
   AGENTD_TOKEN=change-me
   ```

2. Start the full stack:
   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

3. Start a Claude Code session — it will register with agentd and appear in the UI.

## Teardown

```bash
# Stop all containers
docker compose -f docker-compose.dev.yml down

# Stop and remove the SQLite database volume (full reset)
docker compose -f docker-compose.dev.yml down -v
```

## Environment Variables

See `.env.dev.example` for the full list of variables with descriptions. Required variables:

| Variable | Service | Description |
|----------|---------|-------------|
| `JWT_SECRET` | issues | Signs JWTs — generate with `openssl rand -hex 32` |
| `GITHUB_CLIENT_ID` | issues | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | issues | GitHub OAuth app client secret |
| `HUB_API_TOKEN` | agent-hub | Bearer token for REST API clients |
| `HUB_AGENT_TOKEN` | agent-hub | Bearer token for agentd registration |
| `AGENTD_TOKEN` | agentd | gRPC API bearer token |
