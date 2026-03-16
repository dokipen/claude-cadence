# Issue Microservice Plan

## Context

We need a ticket/issue tracking microservice that will serve as the backend for both a CLI and webapp. It lives in `services/issues/` within this repo, with a companion CLI at `services/issues-cli/`. The service uses GraphQL (federation-ready for future microservices), Prisma ORM with SQLite (swappable to PostgreSQL), and GitHub-based auth. GraphQL schema is the single source of truth for types — no protobuf.

The cadence plugin will support both this issues service and GitHub Issues as ticket backends, selectable per-project via CLAUDE.md configuration.

## Directory Structure

### Issues Service (`services/issues/`)

```
services/issues/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
├── docs/
│   ├── INDEX.md                    # Docs index (linked from root README)
│   ├── INSTALL.md                  # Setup & deployment guide
│   ├── PLAN.md                     # This plan (copied on approval)
│   └── user-stories/
│       ├── 01-ticket-management.md
│       ├── 02-labels.md
│       ├── 03-workflow-states.md
│       ├── 04-comments.md
│       ├── 05-blocking.md
│       ├── 06-assignment.md
│       ├── 07-auth.md
│       └── 08-priority-and-estimation.md
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                     # Seeds default labels
├── src/
│   ├── index.ts                    # Apollo Server entry point
│   ├── schema/
│   │   ├── index.ts                # Merges typeDefs + resolvers
│   │   ├── typeDefs/
│   │   │   ├── ticket.ts
│   │   │   ├── comment.ts
│   │   │   ├── label.ts
│   │   │   ├── user.ts
│   │   │   └── auth.ts
│   │   └── resolvers/
│   │       ├── ticket.ts
│   │       ├── comment.ts
│   │       ├── label.ts
│   │       ├── user.ts
│   │       └── auth.ts
│   ├── auth/
│   │   ├── provider.ts             # AuthProvider interface + registry
│   │   ├── github-oauth.ts         # Web: OAuth code → access token → profile
│   │   ├── github-pat.ts           # CLI: PAT → profile
│   │   ├── jwt.ts                  # Issue/verify session JWTs
│   │   └── context.ts              # Apollo context builder
│   ├── fsm/
│   │   ├── transitions.ts          # Allowed transitions map
│   │   └── ticket-machine.ts       # Validation + guard functions
│   └── services/
│       ├── ticket.service.ts       # Business logic
│       └── user.service.ts         # User upsert/lookup
└── test/
    └── unit/
        ├── fsm.test.ts
        └── auth.test.ts
```

### Issues CLI (`services/issues-cli/`)

```
services/issues-cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # CLI entry point (commander)
│   ├── client.ts                   # GraphQL client setup (graphql-request)
│   ├── config.ts                   # Config: API URL, auth token storage
│   └── commands/
│       ├── auth.ts                 # login (PAT or OAuth), logout, whoami
│       ├── ticket.ts               # create, view, list, update, transition
│       ├── label.ts                # create, list, add, remove
│       ├── comment.ts              # add, edit, delete
│       ├── block.ts                # add, remove
│       └── assign.ts               # assign, unassign
└── test/
    └── e2e/                        # E2E tests using the CLI
        ├── helpers.ts              # Test server setup, CLI runner
        ├── ticket-management.e2e.ts
        ├── labels.e2e.ts
        ├── workflow-states.e2e.ts
        ├── comments.e2e.ts
        ├── blocking.e2e.ts
        ├── assignment.e2e.ts
        ├── auth.e2e.ts
        └── priority-estimation.e2e.ts
```

### Ticket Provider Abstraction (plugin level)

```
skills/
  ticket-provider/                  # NEW: abstraction layer
    SKILL.md                        # Describes provider interface + dispatching
  github-issues/                    # EXISTING: kept as-is (gh CLI backend)
    SKILL.md
  issues-api/                       # NEW: issues microservice backend
    SKILL.md
```

## User Stories

Each story maps to a docs file and an e2e test file.

### 01 — Ticket Management
- As a user, I can create a ticket with a title, description, acceptance criteria, and optional labels
- As a user, I can view a single ticket with all its details
- As a user, I can list tickets with cursor pagination
- As a user, I can filter tickets by state, label, assignee, blocked status, or priority
- As a user, I can update a ticket's title, description, or acceptance criteria
- Tickets cannot be deleted — they can only be closed via state transition

### 02 — Labels
- As a user, I can create a label with a name and color
- As a user, I can add a label to a ticket
- As a user, I can remove a label from a ticket
- As a user, I can list all labels
- As a user, I can view all tickets with a given label
- Default labels are seeded on first run: bug, enhancement, accessibility, security, ux, performance

### 03 — Workflow States (FSM)
- As a user, I can transition a ticket from Backlog → Refined
- As a user, I can transition a ticket from Refined → In-Progress (unless blocked)
- As a user, I can transition a ticket from In-Progress → Closed
- As a user, I can demote a ticket from Refined → Backlog
- As a user, I can return a ticket from In-Progress → Refined
- As a user, I can reopen a ticket from Closed → Backlog
- As a user, I get an error when attempting an invalid transition (e.g., Backlog → Closed)
- As a user, I get an error when moving a blocked ticket to In-Progress

### 04 — Comments
- As a user, I can add a comment to a ticket
- As a user, I can view all comments on a ticket (with author info)
- As a user, I can edit my own comment
- As a user, I can delete my own comment

### 05 — Blocking
- As a user, I can mark ticket A as blocking ticket B
- As a user, I can remove a blocking relationship
- As a user, I can view which tickets a ticket blocks
- As a user, I can view which tickets block a ticket
- As a user, I cannot move a blocked ticket to In-Progress until all blockers are Closed

### 06 — Assignment
- As a user, I can assign a ticket to a user
- As a user, I can unassign a ticket
- As a user, I can filter tickets by assignee

### 07 — Auth
- As a web user, I can authenticate via GitHub OAuth code and receive a JWT
- As a CLI user, I can authenticate via GitHub PAT and receive a JWT
- As an authenticated user, I can view my profile via the `me` query
- Unauthenticated users have zero access — all queries and mutations require authentication (except auth mutations)

### 08 — Priority & Estimation
- As a user, I can set story points on a ticket (arbitrary positive integer)
- As a user, I can set a priority on a ticket (HIGHEST, HIGH, MEDIUM, LOW, LOWEST)
- As a user, I can filter tickets by priority
- As a user, I can update story points and priority after creation
- Story points and priority can be set during ticket creation

## Prisma Schema

SQLite initially, swap to PostgreSQL by changing one line (`provider`). Key models:

- **User** — `id`, `githubId` (unique), `login` (unique), `displayName`, `avatarUrl`
- **Ticket** — `id`, `title`, `description`, `acceptanceCriteria`, `state` (enum: BACKLOG/REFINED/IN_PROGRESS/CLOSED), `storyPoints` (Int, optional), `priority` (enum: HIGHEST/HIGH/MEDIUM/LOW/LOWEST, default MEDIUM), `assigneeId` → User
- **Label** — `id`, `name` (unique), `color`
- **TicketLabel** — explicit join table (`ticketId`, `labelId`) for future metadata
- **Comment** — `id`, `body`, `ticketId` → Ticket, `authorId` → User
- **BlockRelation** — directional join table (`blockerId`, `blockedId`) for "ticket A blocks ticket B"

### Database Migrations & Seed

Prisma migrations live in `prisma/migrations/` (auto-generated by `prisma migrate dev`).

**Seed file** (`prisma/seed.ts`): runs on `prisma db seed` and on first `prisma migrate deploy`. Creates default labels:

| Label | Color |
|-------|-------|
| bug | #d73a4a |
| enhancement | #a2eeef |
| accessibility | #0075ca |
| security | #e4e669 |
| ux | #d876e3 |
| performance | #f9d0c4 |

Uses `upsert` so it's idempotent. `package.json` includes `"prisma": { "seed": "tsx prisma/seed.ts" }`.

## GraphQL API

### Queries
- `ticket(id)` — single ticket with all relations
- `tickets(state, labelName, assigneeLogin, isBlocked, priority, first, after)` — cursor-paginated list
- `labels` — all labels
- `me` — current authenticated user

All queries require authentication.

### Mutations
- **Tickets**: `createTicket` (with optional labelIds, storyPoints, priority), `updateTicket` (including storyPoints, priority), `transitionTicket(id, to)` — no delete
- **Assignment**: `assignTicket`, `unassignTicket`
- **Labels**: `createLabel`, `addLabel(ticketId, labelId)`, `removeLabel`
- **Comments**: `addComment`, `updateComment`, `deleteComment`
- **Blocking**: `addBlockRelation(blockerId, blockedId)`, `removeBlockRelation`
- **Auth**: `authenticateWithGitHubCode(code)`, `authenticateWithGitHubPAT(token)` — only unauthenticated mutations

### Input Types

```graphql
input CreateTicketInput {
  title: String!
  description: String
  acceptanceCriteria: String
  labelIds: [ID!]
  assigneeId: ID
  storyPoints: Int
  priority: Priority
}

input UpdateTicketInput {
  title: String
  description: String
  acceptanceCriteria: String
  storyPoints: Int
  priority: Priority
}

enum Priority {
  HIGHEST
  HIGH
  MEDIUM
  LOW
  LOWEST
}
```

### Subscriptions (stub for later)
- `ticketUpdated`, `commentAdded`

### Federation readiness
Start standalone. To federate later: add `@apollo/subgraph`, use `buildSubgraphSchema`, add `@key(fields: "id")` directives. No resolver/service code changes needed.

## FSM — Ticket State Machine

Data-driven, no external library (4 states doesn't warrant xstate):

```
BACKLOG     → [REFINED]
REFINED     → [IN_PROGRESS, BACKLOG]
IN_PROGRESS → [CLOSED, REFINED]
CLOSED      → [BACKLOG]
```

Guards:
- Tickets with open blockers cannot transition to IN_PROGRESS
- Refined → In-Progress is blocked if any blocker ticket is not CLOSED

## Auth Architecture

**Provider interface** — extensible for future providers:
```typescript
interface AuthProvider {
  name: string;
  authenticate(credentials: Record<string, string>): Promise<GitHubUserProfile>;
}
```

**Two providers**:
1. **GitHub OAuth** (web): client sends OAuth `code` → server exchanges for access token → fetches profile
2. **GitHub PAT** (CLI): client sends PAT → server fetches profile with it

**Flow**: Either provider → verified GitHub profile → upsert User in DB → issue JWT (7-day expiry) → client uses JWT for subsequent requests via `Authorization: Bearer` header.

**Access control**: All endpoints require authentication except the two `authenticate*` mutations. Unauthenticated requests get a `401 UNAUTHENTICATED` error on both queries and mutations.

## Docker

Multi-stage Dockerfile (builder + runtime on `node:20-alpine`). `docker-compose.yml` with a volume for SQLite persistence. CMD runs `prisma migrate deploy && prisma db seed && node dist/index.js`.

## Issues CLI

A standalone TypeScript CLI at `services/issues-cli/` using `commander` + `graphql-request`.

### CLI Commands

```
issues auth login              # Authenticate (PAT or OAuth flow)
issues auth logout             # Clear stored token
issues auth whoami             # Show current user

issues ticket create           # Interactive or --title/--desc/--labels/--priority/--points
issues ticket view <id>        # Show ticket details
issues ticket list             # List with --state/--label/--assignee/--blocked/--priority
issues ticket update <id>      # Update fields
issues ticket transition <id>  # Transition state --to <STATE>

issues label create            # --name/--color
issues label list              # List all labels
issues label add <ticket-id>   # --label <id>
issues label remove <ticket-id># --label <id>

issues comment add <ticket-id> # --body
issues comment edit <id>       # --body
issues comment delete <id>

issues block add               # --blocker <id> --blocked <id>
issues block remove            # --blocker <id> --blocked <id>

issues assign <ticket-id>      # --user <id>
issues unassign <ticket-id>
```

### CLI Config
- API URL stored in `~/.issues-cli/config.json` (default `http://localhost:4000`)
- Auth token stored in `~/.issues-cli/auth.json`
- Overridable via `ISSUES_API_URL` and `ISSUES_AUTH_TOKEN` env vars

### CLI Dependencies
- `commander` — CLI framework
- `graphql-request` + `graphql` — native GraphQL client
- `chalk` — colored output
- `ora` — spinners for async operations

## E2E Test Strategy

E2E tests live in `services/issues-cli/test/e2e/` and exercise the **CLI** against a real server. Each e2e file maps 1:1 to a user story document.

**`test/e2e/helpers.ts`** provides:
- `createTestServer()` — starts Apollo Server with a fresh SQLite DB (temp file)
- `runCli(...args)` — executes the CLI binary as a child process and captures stdout/stderr/exit code
- `authenticateTestUser()` — authenticates a test user and configures the CLI to use the token
- `cleanup()` — tears down server and DB

Tests exercise the full stack: CLI → GraphQL client → Apollo Server → Prisma → SQLite. No mocking. Tests verify both success paths and error cases (invalid transitions, auth failures, blocked transitions, unauthenticated access, etc.).

## GitHub Actions CI

File: `.github/workflows/issues-service-ci.yml` (at repo root)

```yaml
name: Issues Service CI
on:
  pull_request:
    paths: ['services/issues/**', 'services/issues-cli/**']
  push:
    branches: [main]
    paths: ['services/issues/**', 'services/issues-cli/**']

jobs:
  test-service:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/issues
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  test-cli:
    runs-on: ubuntu-latest
    needs: test-service
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd services/issues && npm ci && npx prisma generate && npm run build
      - run: cd services/issues-cli && npm ci && npm run typecheck && npm test

  docker:
    runs-on: ubuntu-latest
    needs: [test-service, test-cli]
    steps:
      - uses: actions/checkout@v4
      - run: docker build services/issues/
```

PRs are blocked until all jobs pass.

## Ticket Provider Abstraction

### How it works

Consuming projects configure their ticket backend in their `CLAUDE.md`:

```markdown
## Ticket Provider
provider: issues-api
api_url: http://localhost:4000
```

Or for GitHub Issues (existing behavior):

```markdown
## Ticket Provider
provider: github
```

If no provider is specified, default to `github` for backward compatibility.

### Skill: `skills/ticket-provider/SKILL.md`

Defines the abstract ticket operations that agents use:
- List tickets (with filters)
- View ticket
- Create ticket
- Update ticket
- Transition ticket state
- Add/remove labels
- Add/remove comments
- Add/remove block relationships
- Assign/unassign

The skill reads the project's `CLAUDE.md` to determine which backend to use, then delegates to either `github-issues` or `issues-api` skill.

### Skill: `skills/issues-api/SKILL.md`

New skill providing the issues microservice backend. Documents the CLI commands that agents should use (e.g., `issues ticket list --state BACKLOG` instead of `gh issue list --state open`).

### Existing: `skills/github-issues/SKILL.md`

Kept as-is. Continues to work for projects using GitHub Issues.

## Dependencies

### Service
- `@apollo/server`, `graphql`, `graphql-tag`, `graphql-scalars` (DateTime scalar)
- `@prisma/client` + `prisma` (dev)
- `jsonwebtoken`
- `typescript`, `tsx` (dev runner), `vitest` (testing)

### CLI
- `commander`, `graphql-request`, `graphql`, `chalk`, `ora`
- `typescript`, `tsx` (dev runner), `vitest` (testing)

## Documentation

### `services/issues/docs/INDEX.md`
Central docs index, linked from the root `README.md`. Links to:
- INSTALL.md — setup, env vars, Docker deployment, auto-deploy
- PLAN.md — this plan document
- User stories (all 8 files)
- CLI usage reference

### `services/issues/docs/INSTALL.md`
Covers:
- Prerequisites (Node 20+, Docker)
- Local development setup (`npm install`, env vars, `prisma migrate dev`, `prisma db seed`, `npm run dev`)
- CLI installation (`cd services/issues-cli && npm install && npm link --prefix "$HOME/.local"`)
- Docker deployment (`docker compose up --build`)
- Environment variables reference (DATABASE_URL, JWT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET)
- Configuring cadence to use the issues service (CLAUDE.md `Ticket Provider` section)
- Auto-deploy on plugin update

### Root `README.md`
Add a section pointing to `services/issues/docs/INDEX.md` for the issue microservice documentation.

### Auto-deploy Strategy
Document in INSTALL.md: add a GitHub Actions workflow that rebuilds and redeploys the Docker container when changes merge to `main` in `services/issues/`. The workflow does `docker compose build && docker compose up -d`. For production, this would push to a container registry and trigger deployment to the target environment.

## Implementation Phases

### Phase 1: Steel Thread (est: 8, issue #5)
1. Scaffold `services/issues/` — `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`
2. Write Prisma schema (all 6 models, with `storyPoints`, `priority` fields), run `prisma migrate dev`
3. Write `prisma/seed.ts` with default labels, configure in `package.json`
4. Minimal Apollo Server in `src/index.ts` with ticket CRUD resolvers
5. Scaffold `services/issues-cli/` — `package.json`, `tsconfig.json`
6. Implement GraphQL client setup (`client.ts`, `config.ts`)
7. Implement ticket CLI commands (create, view, list, update)
8. E2E test infrastructure (helpers.ts) + ticket-management.e2e.ts + priority-estimation.e2e.ts
9. Write user story docs in `docs/user-stories/` (all 8 files)

### Phase 2: Labels + Assignment (est: 3, issue #6)
1. Label typeDefs and resolvers (create, list, add to ticket, remove)
2. Assignment mutations (assignTicket, unassignTicket)
3. CLI commands for labels and assignment
4. E2E tests: labels.e2e.ts, assignment.e2e.ts

### Phase 3: FSM + Blocking (est: 5, issue #7)
1. `transitions.ts` — allowed transitions map
2. `ticket-machine.ts` — validation + blocker guard
3. `transitionTicket` mutation
4. Block relation mutations + `blocks`/`blockedBy` field resolvers
5. CLI commands for transition and blocking
6. Unit tests: `fsm.test.ts`
7. E2E tests: workflow-states.e2e.ts, blocking.e2e.ts

### Phase 4: Comments (est: 3, issue #8)
1. Comment CRUD resolvers
2. CLI commands for comments
3. E2E tests: comments.e2e.ts

### Phase 5: Auth (est: 5, issue #9)
1. Provider interface + GitHub OAuth/PAT implementations
2. JWT issuance/verification
3. Apollo context builder, auth guard on ALL endpoints (queries + mutations, except auth mutations)
4. Auth mutations + `me` query
5. CLI auth commands (login, logout, whoami)
6. Unit tests: `auth.test.ts`
7. E2E tests: auth.e2e.ts

### Phase 6: Docker + Docs + CI (est: 5, issue #10)
1. Dockerfile + docker-compose.yml
2. npm scripts: `dev`, `build`, `start`, `test`, `typecheck`, `db:migrate`, `db:seed`
3. Write `docs/INDEX.md`, `docs/INSTALL.md`, copy plan to `docs/PLAN.md`
4. Update root `README.md` to link to docs index
5. GitHub Actions CI workflow (`.github/workflows/issues-service-ci.yml`)

### Phase 7: Integrate with Cadence Plugin (est: 8, issue #11)
1. Add `skills/ticket-provider/SKILL.md` — abstraction layer
2. Add `skills/issues-api/SKILL.md` — issues microservice backend
3. Update `commands/lead/SKILL.md` to use ticket-provider
4. Update `commands/refine/SKILL.md` to use ticket-provider
5. Update `commands/lead/scripts/update-blocked-labels.sh` to use provider dispatch
6. Update `agents/ticket-refiner.md` to use ticket-provider
7. Bump plugin version (minor) in `.claude-plugin/plugin.json`

**Note:** PR-related operations (`gh pr create`, `gh pr review`, `gh pr merge`) stay on `gh` CLI — only issue/ticket operations go through the provider abstraction.

## Verification

1. `cd services/issues && npm install && npx prisma migrate dev && npx prisma db seed`
2. `npm run dev` — Apollo Server starts on :4000
3. Open Apollo Sandbox at `http://localhost:4000` — verify schema includes storyPoints, priority, all types
4. `npm test` — all unit tests pass
5. `cd ../issues-cli && npm install && npm test` — all E2E tests pass (CLI against real server)
6. `docker compose up --build` — verify containerized startup with seeded labels
7. Test CLI manually: `issues auth login`, `issues ticket create`, `issues ticket list`, `issues ticket transition`
8. After Phase 7: configure `provider: issues-api` in a test project's CLAUDE.md, run `/lead` and `/refine` and verify they use the CLI instead of `gh`
9. After Phase 7: remove the provider config, verify `/lead` and `/refine` fall back to `gh` (backward compat)
