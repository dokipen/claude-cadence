# Issue Microservice — Plan & Tickets

## Context

We need a ticket/issue tracking microservice that will serve as the backend for both a CLI and webapp. It lives in `services/issues/` within this repo, with a companion CLI at `services/issues-cli/`. The service uses GraphQL (federation-ready for future microservices), Prisma ORM with SQLite (swappable to PostgreSQL), and GitHub-based auth. GraphQL schema is the single source of truth for types.

The cadence plugin will support both this issues service and GitHub Issues as ticket backends, selectable per-project via CLAUDE.md configuration.

The work is structured so that Phase 1 steel-threads the entire system (service + CLI + E2E tests), and each subsequent phase adds features vertically with E2E tests at every step.

## Architecture Summary

### Tech Stack
- **Service**: TypeScript, Apollo Server, Prisma ORM, SQLite (swappable to PostgreSQL), JWT auth
- **CLI**: TypeScript, commander, graphql-request
- **Testing**: vitest, E2E tests exercise CLI against real server
- **Deployment**: Docker (multi-stage, node:20-alpine)

### Data Model (Prisma)
- **User** — githubId, login, displayName, avatarUrl
- **Ticket** — title, description, acceptanceCriteria, state (BACKLOG/REFINED/IN_PROGRESS/CLOSED), storyPoints, priority (HIGHEST→LOWEST), assignee
- **Label** — name, color (defaults: bug, enhancement, accessibility, security, ux, performance)
- **TicketLabel** — explicit join table
- **Comment** — body, author, ticket
- **BlockRelation** — directional (blocker, blocked)

### GraphQL API
- **Queries**: ticket, tickets (cursor-paginated, filtered by state/label/assignee/blocked/priority), labels, me
- **Mutations**: createTicket, updateTicket, transitionTicket, assignTicket, unassignTicket, createLabel, addLabel, removeLabel, addComment, updateComment, deleteComment, addBlockRelation, removeBlockRelation, authenticateWithGitHubCode, authenticateWithGitHubPAT
- No deleteTicket — tickets are closed, not deleted
- All endpoints require auth except authenticate mutations

### FSM
```
BACKLOG → [REFINED] | REFINED → [IN_PROGRESS, BACKLOG] | IN_PROGRESS → [CLOSED, REFINED] | CLOSED → [BACKLOG]
```
Guard: blocked tickets cannot transition to IN_PROGRESS

### Auth
Extensible provider interface. GitHub OAuth (web) + GitHub PAT (CLI). JWT sessions (7-day expiry).

### Directory Structure
```
services/issues/          # GraphQL microservice
services/issues-cli/      # CLI client (commander + graphql-request)
skills/ticket-provider/   # Abstraction layer (dispatches to github or issues-api)
skills/issues-api/        # Issues microservice backend skill (NEW)
skills/github-issues/     # GitHub Issues backend skill (EXISTING, kept)
```

### Ticket Provider Abstraction
Projects configure backend in CLAUDE.md (`provider: github` or `provider: issues-api`). Default: `github` for backward compatibility.

## Implementation Phases

### Phase 1: Steel thread — scaffold service + CLI with ticket CRUD and E2E tests (est: 8)
**Issue**: #5
**Blocked by**: none

Set up both `services/issues/` and `services/issues-cli/` with the full vertical slice working end-to-end. This includes the complete Prisma schema (all models — no schema changes needed in later phases), Apollo Server, CLI with graphql-request, and E2E test infrastructure.

**What gets built**:
- `services/issues/`: package.json, tsconfig, .env.example, Prisma schema (all 6 models, TicketState + Priority enums), seed file (6 default labels), Apollo Server with ticket CRUD resolvers (createTicket with labels/priority/storyPoints, ticket, tickets with cursor pagination + all filters, updateTicket — no delete)
- `services/issues-cli/`: package.json, tsconfig, GraphQL client setup, config management, ticket commands (create, view, list, update)
- E2E test infrastructure: helpers.ts (test server, CLI runner, test auth), ticket-management.e2e.ts, priority-estimation.e2e.ts
- User story docs in `docs/user-stories/` (all 8 files)

**Acceptance Criteria**:
- `npm run dev` starts Apollo Server on :4000
- `prisma migrate dev` + `prisma db seed` work
- CLI can create, view, list, and update tickets against the running server
- E2E tests pass: ticket CRUD and priority/estimation scenarios
- Full stack exercised: CLI → graphql-request → Apollo Server → Prisma → SQLite

### Phase 2: Labels and assignment resolvers + CLI + E2E (est: 3)
**Issue**: #6
**Blocked by**: Phase 1

Add label management (create, list, add to ticket, remove from ticket) and assignment (assign, unassign) as GraphQL resolvers, CLI commands, and E2E tests.

**Acceptance Criteria**:
- `createLabel`, `addLabel`, `removeLabel`, `labels` query all work via GraphQL
- `assignTicket`, `unassignTicket` mutations work
- CLI commands: `issues label create/list/add/remove`, `issues assign`, `issues unassign`
- E2E tests pass: labels.e2e.ts, assignment.e2e.ts

### Phase 3: FSM state transitions and blocking with guards + CLI + E2E (est: 5)
**Issue**: #7
**Blocked by**: Phase 2

Implement the ticket state machine (BACKLOG → REFINED → IN_PROGRESS → CLOSED with valid transitions and demotions). Add blocking relationship mutations. Guard: blocked tickets cannot transition to IN_PROGRESS.

**Acceptance Criteria**:
- `transitionTicket(id, to)` validates all transitions (6 valid, rejects invalid)
- `addBlockRelation`, `removeBlockRelation` mutations work
- `blocks` and `blockedBy` field resolvers on Ticket type
- Blocked tickets get error when transitioning to IN_PROGRESS
- CLI commands: `issues ticket transition`, `issues block add/remove`
- Unit tests: fsm.test.ts (all valid/invalid transitions, blocker guard)
- E2E tests pass: workflow-states.e2e.ts, blocking.e2e.ts

### Phase 4: Comment CRUD + CLI + E2E (est: 3)
**Issue**: #8
**Blocked by**: Phase 3

Implement comment CRUD (add, view on ticket, edit own, delete own) as GraphQL resolvers, CLI commands, and E2E tests.

**Acceptance Criteria**:
- `addComment`, `updateComment`, `deleteComment` mutations work
- Comments include author info in responses
- CLI commands: `issues comment add/edit/delete`
- E2E tests pass: comments.e2e.ts

### Phase 5: Auth — GitHub OAuth/PAT with JWT sessions + CLI + E2E (est: 5)
**Issue**: #9
**Blocked by**: Phase 4

Implement extensible auth provider interface with GitHub OAuth (web) and GitHub PAT (CLI) providers. JWT session tokens (7-day expiry). All endpoints require auth except authenticate mutations. Retrofit auth guards onto all existing resolvers.

**Acceptance Criteria**:
- `AuthProvider` interface with `authenticate()` method
- `authenticateWithGitHubCode(code)` and `authenticateWithGitHubPAT(token)` mutations
- `me` query returns authenticated user
- ALL queries and mutations return 401 without valid JWT (except auth mutations)
- CLI commands: `issues auth login/logout/whoami`
- Unit tests: auth.test.ts
- E2E tests pass: auth.e2e.ts (including unauthenticated access rejection)

### Phase 6: Docker, documentation, and CI (est: 5)
**Issue**: #10
**Blocked by**: Phase 5

Containerize the service, write documentation, and set up GitHub Actions CI to block PRs until tests pass.

**Acceptance Criteria**:
- Multi-stage Dockerfile (node:20-alpine), docker-compose.yml with SQLite volume
- `docker compose up --build` starts service with seeded labels, data persists
- `docs/INDEX.md`, `docs/INSTALL.md` (local dev, Docker, env vars, auto-deploy, cadence config), `docs/PLAN.md`
- Root `README.md` links to docs index
- `.github/workflows/issues-service-ci.yml`: runs unit tests, e2e tests, typecheck, build, Docker build
- CI triggers on `services/issues/**` and `services/issues-cli/**` changes
- All npm scripts work: dev, build, start, test, typecheck, db:migrate, db:seed

### Phase 7: Integrate with cadence plugin via ticket provider abstraction (est: 8)
**Issue**: #11
**Blocked by**: Phase 6

Add ticket provider abstraction so cadence supports both GitHub Issues and the issues microservice. Projects configure backend in CLAUDE.md. Keep existing github-issues skill, add new ticket-provider and issues-api skills. Update lead, refine commands and ticket-refiner agent to use the provider abstraction.

**Acceptance Criteria**:
- `skills/ticket-provider/SKILL.md` reads CLAUDE.md `Ticket Provider` section, dispatches to correct backend
- `skills/issues-api/SKILL.md` documents CLI commands for agents
- `skills/github-issues/SKILL.md` unchanged
- `commands/lead/SKILL.md` uses ticket-provider instead of direct `gh issue` calls
- `commands/refine/SKILL.md` uses ticket-provider
- `commands/lead/scripts/update-blocked-labels.sh` uses provider dispatch
- `agents/ticket-refiner.md` uses ticket-provider, checks state/storyPoints/priority
- Default provider is `github` when no CLAUDE.md config (backward compatible)
- PR operations stay on `gh` CLI
- Plugin version bumped (minor) in `.claude-plugin/plugin.json`

## Total Effort

37 story points across 7 phases.
