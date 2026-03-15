# Issues UI — Read-Only Kanban Board

## Context

The Cadence issues system has a GraphQL API (`services/issues/`) and CLI (`services/issues-cli/`), but no web frontend. We need a static React SPA that shows tickets on a kanban board, with a detail view for individual tickets. The first milestone is read-only — all mutations stay in the CLI.

The app is served by the existing Caddy reverse proxy alongside the GraphQL API (`/graphql`) and agents gRPC service (`/agents/*`). Same-origin means no CORS concerns. Auth uses both PAT login (steel thread) and GitHub OAuth (polished flow), both already implemented in the API.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build tool | Vite | Fast dev server, optimized builds, TypeScript out of the box |
| Language | TypeScript | Matches `issues` and `issues-cli` services |
| Styling | CSS custom properties + CSS Modules | Brand variables from `mockup/branding.html` map directly. No extra deps |
| GraphQL client | graphql-request | Same client as `issues-cli/src/client.ts`. Lightweight for read-only views |
| Routing | React Router v7 | Two pages. Simple, established |
| Auth | PAT login (steel thread) + GitHub OAuth (Phase 4) | PAT gets data flowing fast. OAuth provides polished UX |
| E2E testing | Playwright (Chromium only) | Real browser tests against real API. One `npm run test:e2e` command |
| Unit testing | Vitest + React Testing Library | Matches `issues-cli` vitest pattern |
| Deployment | Atomic file swap via CI on push to main | Self-hosted runner deploys to Caddy-served directory |
| State management | React hooks | Read-only app, simple data flow. No Redux/Zustand |

## Directory Structure

```
services/issues-ui/
├── public/
│   ├── cadence-icon.svg
│   └── cadence-icon-light.svg
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/
│   │   ├── client.ts
│   │   └── queries.ts
│   ├── auth/
│   │   ├── AuthContext.tsx
│   │   ├── LoginPage.tsx
│   │   └── AuthCallback.tsx
│   ├── components/
│   │   ├── Layout.tsx
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   ├── TicketCard.tsx
│   │   ├── TicketDetail.tsx
│   │   ├── ProjectSelector.tsx
│   │   ├── PriorityBadge.tsx
│   │   ├── LabelBadge.tsx
│   │   ├── CommentList.tsx
│   │   └── BlockingList.tsx
│   ├── hooks/
│   │   ├── useTickets.ts
│   │   ├── useTicket.ts
│   │   └── useProjects.ts
│   ├── styles/
│   │   ├── variables.css
│   │   ├── reset.css
│   │   ├── layout.module.css
│   │   ├── board.module.css
│   │   ├── card.module.css
│   │   └── detail.module.css
│   └── types.ts
├── e2e/
│   ├── global-setup.ts
│   ├── fixtures/
│   │   └── auth.ts
│   ├── login.spec.ts
│   ├── board.spec.ts
│   ├── ticket-detail.spec.ts
│   └── oauth.spec.ts
├── scripts/
│   └── deploy.sh
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── playwright.config.ts
└── docs/
    ├── PLAN.md
    └── user-stories/
        ├── 01-authentication.md
        ├── 02-kanban-board.md
        ├── 03-project-selector.md
        ├── 04-ticket-detail.md
        ├── 05-github-oauth.md
        └── 06-deployment-ci.md
```

## Infrastructure Changes

### Caddyfile + install-caddy-site.sh

Replace the fallback `handle` block in both `infrastructure/Caddyfile` and `infrastructure/install-caddy-site.sh`:

```caddy
# Issues UI — static SPA (replaces plain-text fallback)
handle {
    root * /var/lib/cadence/issues-ui
    try_files {path} /index.html
    file_server
}
```

`try_files` enables SPA client-side routing — any path without a matching file serves `index.html`.

### CI Pipeline (`.github/workflows/ci.yml`)

Add to path filter:
```yaml
issues-ui:
  - 'services/issues-ui/**'
```

Two new jobs:
1. **`issues-ui-ci`** — typecheck, Playwright e2e tests, build (runs on all PRs + pushes)
2. **`issues-ui-deploy`** — builds and deploys to `/var/lib/cadence/issues-ui/` (runs only on push to main, self-hosted runner only)

### Deploy Script (`scripts/deploy.sh`)

Atomic deploy via `mv` swap:
```bash
# Build dist → staging dir → mv swap → cleanup
sudo cp -r "$DIST_DIR" "${DEPLOY_DIR}.staging"
sudo mv "$DEPLOY_DIR" "${DEPLOY_DIR}.old"  # atomic rename
sudo mv "${DEPLOY_DIR}.staging" "$DEPLOY_DIR"
sudo rm -rf "${DEPLOY_DIR}.old"
```

No partial-deploy window. `VITE_GITHUB_CLIENT_ID` passed as build-time env from GitHub Actions secret.

## E2E Testing Strategy

### Test Infrastructure

- **Playwright with `webServer`** starts both the issues API (test database) and Vite dev server automatically
- **Separate test DB**: `DATABASE_URL=file:./test.db` + `JWT_SECRET=e2e-test-secret`
- **Seed script** (`services/issues/prisma/seed-e2e.ts`): direct Prisma seeding creates test user, project, tickets in all 4 states, labels, comments, blocking relationships
- **Auth fixture**: signs a JWT with the known test secret, injects into `localStorage` before navigation — bypasses GitHub API entirely

### Playwright Config

```ts
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:5173" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    { command: "cd ../issues && DATABASE_URL=file:./test.db JWT_SECRET=e2e-test-secret npm start", port: 4000 },
    { command: "npm run dev", port: 5173 },
  ],
});
```

### Auth Fixture

JWT payload matches `services/issues/src/auth/jwt.ts` — `{ userId, jti }` signed with `JWT_SECRET`:

```ts
const token = jwt.sign({ userId: "e2e-test-user", jti: "e2e" }, "e2e-test-secret", { expiresIn: "1h" });
```

### Test Seed Data

`services/issues/prisma/seed-e2e.ts` creates:
- 1 user (`e2e-test-user` / `e2e-tester`)
- 1 project (`E2E Test Project`)
- 4+ tickets (one per state), with labels, assignee, story points
- Comments on tickets
- Blocking relationships between tickets

## GraphQL Queries

**Board tickets** (per column):
```graphql
query BoardTickets($state: TicketState!, $projectId: ID!, $first: Int) {
  tickets(state: $state, projectId: $projectId, first: $first) {
    edges {
      node {
        id, title, state, priority, storyPoints
        assignee { login, avatarUrl }
        labels { id, name, color }
        blockedBy { id }
      }
    }
    pageInfo { hasNextPage, endCursor }
  }
}
```

BACKLOG/REFINED/IN_PROGRESS: `first: 100`. CLOSED: `first: 20`.

**Ticket detail**:
```graphql
query TicketDetail($id: ID!) {
  ticket(id: $id) {
    id, title, description, acceptanceCriteria, state, storyPoints, priority
    assignee { id, login, displayName, avatarUrl }
    project { id, name }
    labels { id, name, color }
    comments { id, body, author { login, displayName, avatarUrl }, createdAt }
    blocks { id, title, state }
    blockedBy { id, title, state }
    createdAt, updatedAt
  }
}
```

**Projects**: `query { projects { id, name, repository } }`

**Auth (PAT)**: `authenticateWithGitHubPAT(token)` → `{ token, refreshToken, user { ... } }`

**Auth (OAuth)**: `generateOAuthState` → state string, then `authenticateWithGitHubCode(code, state)` → `{ token, refreshToken, user { ... } }`

## Implementation Phases

### Phase 0: Project scaffolding + Playwright setup (est: 2)
**Blocked by:** none

Set up Vite + React + TypeScript project with Playwright configured. Working dev server rendering a branded placeholder.

**Delivers:**
- `package.json` with react, react-dom, react-router, graphql-request, graphql, @playwright/test
- Vite config with `/graphql` proxy to `localhost:4000` for dev
- `playwright.config.ts` with `webServer` for API + Vite
- `variables.css` with all brand tokens from `mockup/branding.html`
- `reset.css`, `index.html` with Space Grotesk font link
- Placeholder `App.tsx` rendering "Cadence" with brand styling
- `e2e/global-setup.ts` and `services/issues/prisma/seed-e2e.ts` for test data
- `e2e/fixtures/auth.ts` shared auth fixture

**Verify:** `npm run dev` loads in browser with correct fonts/colors. `npm run build` produces `dist/`. `npm run typecheck` passes. `npm run test:e2e` starts both servers and runs (no tests yet, but infra works).

### Phase 1: Auth + API client (est: 3)
**Blocked by:** Phase 0

PAT-based login and authenticated GraphQL client. After this phase, the app can fetch data.

**Delivers:**
- `api/client.ts` — graphql-request client with `Authorization: Bearer` header, auto-refresh on UNAUTHENTICATED
- `auth/AuthContext.tsx` — React context: `{ user, token, isAuthenticated, login(pat), logout }`
- `auth/LoginPage.tsx` — Branded form: enter GitHub PAT, submit calls `authenticateWithGitHubPAT`
- Protected route wrapper redirecting to `/login` when unauthenticated
- Token + refreshToken in localStorage
- `types.ts` — User, AuthPayload interfaces

**Verify:** Enter valid PAT → see app shell with user info. Refresh → stays logged in. Logout → login page. `npm run test:e2e` passes.

### Phase 2: Kanban board with live data (est: 5)
**Blocked by:** Phase 1

Steel thread: four-column kanban board with real tickets for a selected project.

**Delivers:**
- `hooks/useTickets.ts` — Fetches tickets per state+project
- `hooks/useProjects.ts` — Fetches all projects
- `components/Layout.tsx` — Header with logo, ProjectSelector, user menu
- `components/KanbanBoard.tsx` — Four-column grid, parallel fetches
- `components/KanbanColumn.tsx` — State header with count, scrollable cards
- `components/TicketCard.tsx` — Title, PriorityBadge, LabelBadge, assignee avatar, points
- `components/ProjectSelector.tsx` — Dropdown, persists in localStorage
- `components/PriorityBadge.tsx`, `components/LabelBadge.tsx`
- Loading/empty states per column

**Verify:** Board shows real data. Project selector works. CLOSED limited to ~20. Responsive. `npm run test:e2e` passes.

### Phase 3: Ticket detail page (est: 3)
**Blocked by:** Phase 2

Expanded ticket view with all fields, comments, and blocking relationships.

**Delivers:**
- `hooks/useTicket.ts` — Fetch single ticket by ID
- `components/TicketDetail.tsx` — Back link, title, state/priority badges, metadata, description, acceptance criteria
- `components/CommentList.tsx` — Chronological thread with author + timestamp
- `components/BlockingList.tsx` — Blocks/blockedBy with links to other tickets
- Route `/ticket/:id` in App.tsx

**Verify:** Full detail view works. Comments, blocking links, back nav all functional. `npm run test:e2e` passes.

### Phase 4: GitHub OAuth flow (est: 3)
**Blocked by:** Phase 1

Full GitHub OAuth redirect login alongside PAT login.

**Delivers:**
- `auth/AuthCallback.tsx` — Route at `/auth/callback`
- Updated `auth/LoginPage.tsx` — "Sign in with GitHub" button
- `VITE_GITHUB_CLIENT_ID` env var for build-time OAuth client ID
- `.env.example` documenting the variable

**Verify:** Full OAuth redirect flow works end-to-end. PAT login still works as fallback.

### Phase 5: Caddy config + CI + deploy + polish (est: 5)
**Blocked by:** Phase 3, Phase 4

Production deployment, CI pipeline, automated deploy, and UX polish.

**Delivers:**
- Updated `infrastructure/Caddyfile` — `file_server` + `try_files` replacing plain-text fallback
- Updated `infrastructure/install-caddy-site.sh` — same SPA block
- `scripts/deploy.sh` — atomic deploy via `mv` swap
- CI jobs: `issues-ui-ci` and `issues-ui-deploy`
- Auto-refresh: board re-fetches on 60-second interval
- Keyboard: `Escape` on detail page goes back
- Error boundary at App level
- Responsive polish (375px–1920px)

**Verify:** Caddy serves built app, SPA routing works. CI passes. Push to main triggers deploy.

## Milestone Summary

| Phase | Est | Description | Depends on |
|-------|-----|-------------|------------|
| 0 | 2 | Project scaffolding: Vite + React + TS + Playwright | — |
| 1 | 3 | Auth: PAT login, token refresh, protected routes | Phase 0 |
| 2 | 5 | Steel thread: kanban board with live GraphQL data | Phase 1 |
| 3 | 3 | Ticket detail: comments, blocking relationships | Phase 2 |
| 4 | 3 | GitHub OAuth login flow | Phase 1 |
| 5 | 5 | Caddy config, CI, deploy pipeline, polish | Phase 3 + 4 |

**Total: 21 story points across 6 phases**

Phases 2–3 and Phase 4 can run in parallel (both only depend on Phase 1). Phase 5 waits for both branches to converge.

## npm Dependencies

**Runtime:** react, react-dom, react-router, graphql, graphql-request

**Dev:** typescript, vite, @vitejs/plugin-react, @playwright/test, jsonwebtoken (e2e fixture)
