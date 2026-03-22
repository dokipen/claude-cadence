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

# 2. Start the core stack (issues API + issues UI + Caddy)
docker compose -f docker-compose.dev.yml up --build
```

The stack is ready when you see Caddy and the issues-ui start logging.
Open **http://localhost** in your browser.

## Dev Data Seeding

The dev environment automatically seeds a `claude-cadence` project on startup via `prisma/seed.ts`.
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

## Full Stack (Agent Services)

The `--profile agents` flag adds `agentd` and `agent-hub` to the compose output, but these
services have hard host dependencies (tmux, the `claude` CLI, macOS/Linux service
integration) that make them impractical to containerize.

**For PRs that touch agent-related code**, run the services on the host:

```bash
# Build and install agentd
cd services/agents && make build
./install/install.sh

# Build and run agent-hub
cd services/agent-hub && make build
./agent-hub --config <your-config.yaml>

# Then start the compose stack (agent placeholders connect over host networking)
docker compose -f docker-compose.dev.yml --profile agents up --build
```

See [services/agents/docs/INSTALL.md](../services/agents/docs/INSTALL.md) and
[infrastructure/README.md](../infrastructure/README.md) for detailed service configuration.

### Quick Start: Agent Sessions

Minimal steps to get a visible agent session in the UI:

1. Start the base stack first:
   ```bash
   docker compose -f docker-compose.dev.yml up
   ```

2. Copy `.env.dev.example` to `.env.dev` if you haven't already, and fill in
   `HUB_API_TOKEN`, `HUB_AGENT_TOKEN`, and `AGENTD_TOKEN`.

3. Build and install agentd on the host:
   ```bash
   cd services/agents && make build && ./install/install.sh
   ```

4. Configure agentd with hub URL `http://localhost/api/v1` and the `HUB_AGENT_TOKEN`
   value from `.env.dev` as the bearer token.

5. Build and run agent-hub:
   ```bash
   cd services/agent-hub && make build
   ./agent-hub --config <config.yaml>
   ```

6. Restart compose with the agents profile:
   ```bash
   docker compose -f docker-compose.dev.yml --profile agents up --build
   ```

7. Start a Claude Code session — it will register with agentd and appear in the UI.

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
| `HUB_API_TOKEN` | agent-hub | Bearer token for REST API clients (`--profile agents`) |
| `HUB_AGENT_TOKEN` | agent-hub | Bearer token for agentd registration (`--profile agents`) |
| `AGENTD_TOKEN` | agentd | gRPC API bearer token (`--profile agents`) |
