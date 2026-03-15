# US-06: Deployment & CI

**Phase:** 5 (Caddy + CI + Deploy + Polish) — 5 story points

## Summary

The app is automatically tested, built, and deployed when changes are pushed to main.

## Stories

- As a developer, changes to `services/issues-ui/**` trigger the CI pipeline
- As a developer, CI runs typecheck, Playwright e2e tests, and production build
- As a developer, Playwright test report is uploaded as an artifact on failure
- As a developer, pushing to main automatically deploys the built app to the Caddy-served directory
- As a developer, deployment is atomic — users never see a half-deployed state
- As a user, SPA routing works (direct navigation to `/ticket/:id` serves the app)
- As a user, the board auto-refreshes data every 60 seconds
- As a user, network errors show a friendly error message instead of a blank screen

## Infrastructure Changes

### Caddyfile

Replace fallback `handle` block:
```caddy
handle {
    root * /var/lib/cadence/issues-ui
    try_files {path} /index.html
    file_server
}
```

### CI Pipeline

Path filter addition:
```yaml
issues-ui:
  - 'services/issues-ui/**'
```

New jobs:
1. `issues-ui-ci` — typecheck, Playwright e2e, build (PRs + pushes)
2. `issues-ui-deploy` — build + deploy (push to main only, self-hosted runner)

### Deploy Script

Atomic deploy via `mv` swap in `scripts/deploy.sh`:
```bash
sudo cp -r "$DIST_DIR" "${DEPLOY_DIR}.staging"
sudo mv "$DEPLOY_DIR" "${DEPLOY_DIR}.old"
sudo mv "${DEPLOY_DIR}.staging" "$DEPLOY_DIR"
sudo rm -rf "${DEPLOY_DIR}.old"
```

## Technical Notes

- `VITE_GITHUB_CLIENT_ID` passed as build-time env from GitHub Actions secret
- Playwright report uploaded as artifact only on test failure
- Auto-refresh uses 60-second `setInterval` in board hooks
- Error boundary wraps the entire App component
- Responsive target: 375px–1920px
