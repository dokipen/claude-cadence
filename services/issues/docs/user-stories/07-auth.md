# Auth

## User Stories

- As a web user, I can authenticate via GitHub OAuth code and receive a JWT so that I can use the service from browser-based clients
- As a CLI user, I can authenticate via GitHub PAT and receive a JWT so that I can use the service from the command line
- As an authenticated user, I can view my profile via the `me` query so that I can verify my identity and session
- As an unauthenticated user, I am denied access to all queries and mutations (except auth mutations) so that the system is secure by default

## Details

### Auth Architecture

**Provider interface** — extensible for future auth providers:
```typescript
interface AuthProvider {
  name: string;
  authenticate(credentials: Record<string, string>): Promise<GitHubUserProfile>;
}
```

**Two providers:**
1. **GitHub OAuth** (web): client sends OAuth authorization `code` -> server exchanges it for an access token using GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET -> fetches GitHub profile -> upserts User -> issues JWT
2. **GitHub PAT** (CLI): client sends a Personal Access Token -> server uses it to fetch the GitHub profile -> upserts User -> issues JWT

**Flow**: Either provider -> verified GitHub profile -> upsert User in DB -> issue JWT (7-day expiry) -> client uses JWT for subsequent requests via `Authorization: Bearer <token>` header.

### GraphQL Operations

**Mutations (unauthenticated):**
- `authenticateWithGitHubCode(code: String!): AuthPayload` — OAuth flow for web clients
- `authenticateWithGitHubPAT(token: String!): AuthPayload` — PAT flow for CLI clients

**Queries (authenticated):**
- `me: User` — returns the current authenticated user's profile

**AuthPayload** includes the JWT token and the User object.

### CLI Commands

```
issues auth login              # Authenticate (PAT or OAuth flow)
issues auth logout             # Clear stored token
issues auth whoami             # Show current user (calls `me` query)
```

### CLI Config

- Auth token stored in `~/.issues-cli/auth.json`
- Overridable via `ISSUES_AUTH_TOKEN` env var

### Access Control

- All queries and mutations require a valid JWT in the `Authorization: Bearer` header
- The only exceptions are `authenticateWithGitHubCode` and `authenticateWithGitHubPAT`
- Unauthenticated requests receive a `401 UNAUTHENTICATED` GraphQL error
- The Apollo context builder (`src/auth/context.ts`) extracts and verifies the JWT on every request

### Edge Cases

- Expired JWTs return an UNAUTHENTICATED error (tokens expire after 7 days)
- Invalid or malformed JWTs return an UNAUTHENTICATED error
- An invalid GitHub OAuth code returns an authentication error
- An invalid or revoked GitHub PAT returns an authentication error
- The `me` query with an expired or missing token returns UNAUTHENTICATED
- User profile is upserted on each login (displayName, avatarUrl may change)

## Acceptance Criteria

- [ ] `authenticateWithGitHubCode` mutation exchanges an OAuth code for a JWT
- [ ] `authenticateWithGitHubPAT` mutation validates a PAT and returns a JWT
- [ ] Both auth mutations upsert the User record (create if new, update if existing)
- [ ] JWTs expire after 7 days
- [ ] `me` query returns the authenticated user's profile (id, login, displayName, avatarUrl)
- [ ] All non-auth queries return UNAUTHENTICATED when no token is provided
- [ ] All non-auth mutations return UNAUTHENTICATED when no token is provided
- [ ] Invalid/expired JWTs return UNAUTHENTICATED
- [ ] Invalid OAuth codes and PATs return descriptive authentication errors
- [ ] CLI `auth login` stores the JWT token locally
- [ ] CLI `auth logout` clears the stored token
- [ ] CLI `auth whoami` displays the current user's profile
- [ ] Unit tests in `auth.test.ts` cover JWT issuance, verification, expiry, and provider logic

## Related

- **E2E test**: `services/issues-cli/test/e2e/auth.e2e.ts`
- **Phase**: Phase 5 — Auth
