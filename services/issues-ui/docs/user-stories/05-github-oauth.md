# US-05: GitHub OAuth Login

**Phase:** 4 (GitHub OAuth) — 3 story points

## Summary

Users can sign in with their GitHub account via OAuth for a streamlined login experience.

## Stories

- As a user, I see a "Sign in with GitHub" button on the login page
- As a user, clicking the button redirects me to GitHub's authorization page
- As a user, after approving on GitHub I am redirected back to the app with an auth code
- As a user, the app exchanges the code for a session token and redirects me to the board
- As a user, if the OAuth flow fails I see an error message on the login page
- As a user, I can still use PAT login as an alternative

## E2E Tests

| Test | Description |
|------|-------------|
| `oauth_button_visible` | "Sign in with GitHub" button renders on login page |
| `oauth_callback_handles_code` | `/auth/callback` with code+state exchanges for token |
| `oauth_callback_redirects_to_board` | Successful auth redirects to the board |

## Technical Notes

- OAuth flow: `generateOAuthState` → redirect to GitHub → callback at `/auth/callback` → `authenticateWithGitHubCode(code, state)`
- `VITE_GITHUB_CLIENT_ID` env var needed at build time
- Server needs `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` configured
- OAuth callback component at `auth/AuthCallback.tsx` reads `code` and `state` from URL params
- PAT login remains as fallback for environments without OAuth configured
