# Self-Hosted Runner Security

This document covers security considerations for the self-hosted GitHub Actions runner used by this repository.

## Runner Environment

- **Host:** Bootsy (dedicated server)
- **OS:** Linux (X64)
- **Runner user:** `github-runner`
- **Runner labels:** `self-hosted`, `Linux`, `X64`

### Pre-installed Software

- Docker (runner user is in the `docker` group)
- Node.js 20 (via `actions/setup-node`)
- Go (via `actions/setup-go`, version from `go.mod`)
- Standard Linux build tools (see Required System Packages below for Arch-specific packages)

### Required System Packages (Arch Linux)

The self-hosted runner is Arch-based. The following packages must be pre-installed since workflows cannot use `sudo` or `apt`:

**Playwright Chromium dependencies:**
```
alsa-lib at-spi2-core atk cairo libcups dbus libdrm mesa glib2 nspr nss pango wayland libx11 libxcb libxcomposite libxdamage libxext libxfixes libxkbcommon libxrandr
```

**Other CI dependencies:**
```
lsof
```

Install all required packages:
```bash
sudo pacman -S --needed alsa-lib at-spi2-core atk cairo libcups dbus libdrm mesa glib2 nspr nss pango wayland libx11 libxcb libxcomposite libxdamage libxext libxfixes libxkbcommon libxrandr lsof
```

## Fork PR Protection

Fork PRs are routed to GitHub-hosted runners (`ubuntu-latest`) via a conditional `runs-on` expression in every CI job:

```yaml
runs-on: ${{ (github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork) && 'ubuntu-latest' || fromJSON('["self-hosted","Linux","X64"]') }}
```

This prevents fork PRs from executing arbitrary code on the self-hosted runner.

### Required Repo Setting

**Settings > Actions > Fork pull request workflows** must have "Require approval for all outside collaborators" enabled. This adds a manual approval gate before any fork PR workflow runs, even on GitHub-hosted runners. Verify by submitting a fork PR and confirming the workflow requires approval.

> **Note:** The `on: pull_request` trigger is intentionally used instead of `pull_request_target`. See the warning comment in `ci.yml` for details.

## Runner Group and Label Scoping

Jobs that must run on the self-hosted runner use the label set `[self-hosted, Linux, X64]`. The deploy workflow (`deploy-issues.yml`) is restricted to the `push` event on `main` and `workflow_dispatch`, so it never runs on fork PRs.

CI jobs use the fork-detection expression above to ensure only trusted code (from the base repo) runs on self-hosted infrastructure. Fork PRs are routed to ephemeral GitHub-hosted runners where persistent state is not a concern.

## Workspace Cleanup

All jobs that run on the self-hosted runner include:

1. **`actions/checkout` with `clean: true`** — ensures a clean checkout at the start of each job
2. **Post-job cleanup step** (`rm -rf "$GITHUB_WORKSPACE"/*`) — removes repository contents after job completion, even on failure

This prevents repository content from persisting between runs on the self-hosted runner.

## Docker Socket Exposure

The self-hosted runner has direct access to the host Docker daemon. This is an accepted risk with the following justification:

- **CI docker jobs** (`issues-service-docker`) only run `docker build` to verify the image builds. No containers are started and no volumes are mounted. The built image is explicitly removed via `--iidfile` + `docker rmi` after each run.
- **Deploy jobs** (`deploy-issues.yml`) use `docker compose` to build and deploy the issues service. This job only runs on pushes to `main` — never on PRs — so only trusted, reviewed code reaches it.
- **Fork PRs never reach the self-hosted runner**, eliminating the primary attack vector (arbitrary Docker commands from untrusted code).

### Alternatives Considered

- **Docker-in-Docker (DinD):** Adds complexity and performance overhead. Since fork PRs are already excluded from self-hosted runners, the primary risk is mitigated without DinD.
- **Rootless Docker:** Would reduce the blast radius but requires additional runner setup and may not be compatible with all `docker compose` features used in deploys.

### Residual Risk

A compromised dependency in a trusted PR could still execute arbitrary Docker commands on the host. This is mitigated by code review requirements and the limited scope of Docker operations in CI (build-only, no `--privileged`, no host mounts).

## Security Assumptions

1. All PRs to `main` are reviewed before merge
2. The `github-runner` user has no elevated privileges beyond Docker group membership
3. Repository secrets (e.g., `ISSUES_JWT_SECRET`) are only exposed to jobs that need them, scoped via `env` at the job level
4. The runner host is not shared with other tenants or repositories
5. The "Require approval for all outside collaborators" setting is enabled in repo settings
