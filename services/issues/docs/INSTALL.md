# Issue Microservice — Installation and Deployment

## Prerequisites

- Node.js 20+
- npm
- Docker (optional, for containerized deployment)

## Local Development Setup

```bash
cd services/issues
npm install
```

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

Create the database and run migrations:

```bash
npx prisma migrate dev
```

Seed the database with default labels:

```bash
npx prisma db seed
```

Start the Apollo Server on port 4000:

```bash
npm run dev
```

The GraphQL playground is available at `http://localhost:4000`.

## CLI Installation

```bash
cd services/issues-cli
npm install
```

Run commands directly:

```bash
npx tsx src/index.ts
```

Or link globally for a shorter `issues` command:

```bash
npm link
issues --help
```

## Docker Deployment

Build and start the service:

```bash
docker compose up --build
```

This starts the issues service with migrations applied and default labels seeded. Data persists across restarts via a Docker volume (`issues-data`).

Set `JWT_SECRET` for production:

```bash
JWT_SECRET=your-secret-here docker compose up --build
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Prisma database connection string | `file:./dev.db` |
| `JWT_SECRET` | Secret for signing JWTs (required for production) | `change-me-in-production` |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | _(empty)_ |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | _(empty)_ |
| `PORT` | Server listen port | `4000` |

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx watch src/index.ts` | Start dev server with file watching |
| `build` | `tsc` | Compile TypeScript |
| `start` | `node dist/index.js` | Run compiled server |
| `test` | `vitest run` | Run unit tests |
| `typecheck` | `tsc --noEmit` | Type-check without emitting |
| `db:migrate` | `prisma migrate dev` | Create and apply migrations |
| `db:seed` | `prisma db seed` | Seed default labels |

## Configuring Cadence

To use the issues service as your ticket provider, add the following to your project's `CLAUDE.md`:

```markdown
## Ticket Provider

provider: issues-api
url: http://localhost:4000
```

## Auto-Deploy Strategy

The CI workflow validates Docker builds on every PR and push to `main`, but does not deploy automatically. To set up auto-deploy, add a separate workflow that pushes to a container registry and triggers deployment to your target environment on merge to `main`.
