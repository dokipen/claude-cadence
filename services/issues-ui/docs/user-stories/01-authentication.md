# US-01: Authentication

**Phase:** 1 (Auth + API Client) — 3 story points

## Summary

Users can authenticate with the web UI to access ticket data.

## Stories

- As a user, I see a branded login page when visiting the app without a valid session
- As a user, I can enter a GitHub Personal Access Token to authenticate
- As a user, after successful authentication I am redirected to the kanban board
- As a user, my session persists across page refreshes (token stored in localStorage)
- As a user, if my access token expires the app automatically refreshes it using my refresh token
- As a user, if my refresh token is invalid I am redirected to the login page
- As a user, I can log out, which clears my session and returns me to the login page
- As a user, I see an error message if I submit an invalid PAT

## E2E Tests

| Test | Description |
|------|-------------|
| `unauthenticated_shows_login` | Visiting `/` without a token renders the login page |
| `authenticated_shows_board` | With a valid JWT in localStorage, `/` renders the app shell |
| `logout_clears_session` | Clicking logout clears tokens and shows login page |

## Technical Notes

- Auth flow uses `authenticateWithGitHubPAT` GraphQL mutation
- Token refresh uses `refreshToken` mutation, matching the pattern in `services/issues-cli/src/client.ts`
- JWT payload: `{ userId, jti }` signed with `JWT_SECRET` (see `services/issues/src/auth/jwt.ts`)
- Access tokens expire in 15 minutes; refresh tokens last 30 days
- Tokens stored in localStorage: `cadence_token`, `cadence_refresh_token`
