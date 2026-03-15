# Self-Hosted GitHub Actions Runners

Scripts to provision and manage self-hosted GitHub Actions runners as systemd services (Linux) or launchd agents (macOS).

## Prerequisites

- **Linux**: systemd, `gh` CLI, `curl`, `tar`
- **macOS**: launchd (built-in), `gh` CLI, `curl`, `tar`
- `gh` must be authenticated with repo admin access

## Usage

### Provision runners

```bash
./setup-runners.sh --repo dokipen/claude-cadence --count 3
```

> **Note:** Do not run with `sudo`. The script elevates internally via `sudo` only for privileged operations (user creation, systemd, directory ownership). The `gh` API calls run as your user, which must have `gh` authenticated.

Options:
- `--repo OWNER/REPO` — GitHub repo (required)
- `--count N` — Number of instances (default: 3)
- `--user USER` — System user (default: `github-runner`, ignored on macOS)
- `--base-dir DIR` — Install directory (default: `/home/<user>` on Linux, `~/actions-runner` on macOS)
- `--labels LABELS` — Runner labels (default: `Linux,X64` or `macOS,ARM64` based on platform)
- `--runner-version VER` — Pin a specific version (default: latest)
- `--dry-run` — Print commands without executing

### List runners

```bash
./list-runners.sh
```

### Remove runners

```bash
./teardown-runners.sh --repo dokipen/claude-cadence
```

## Directory Layout

```
# Linux
/home/github-runner/
  actions-runner-claude-cadence-1/
  actions-runner-claude-cadence-2/
  actions-runner-mixty-1/
  ...

# macOS
~/actions-runner/
  actions-runner-claude-cadence-1/
  actions-runner-claude-cadence-2/
  ...
```

Each runner directory is namespaced by repo name, allowing multiple repos on one host.

## Platform Behavior

| Feature | Linux | macOS |
|---------|-------|-------|
| Service manager | systemd | launchd |
| Runner user | Dedicated system user (`github-runner`) | Current user |
| Requires sudo | Internally (for systemd/user ops) | No |
| Default labels | `Linux,X64` | `macOS,ARM64` or `macOS,X64` |
| Default base dir | `/home/github-runner` | `~/actions-runner` |

The scripts auto-detect the platform and architecture. The runner's bundled `svc.sh` handles service installation for both systemd and launchd.

## Security: Fork Pull Requests

This repository is public. Self-hosted runners execute code from the PR branch, so fork PRs from outside contributors could run untrusted code on runner infrastructure.

**Mitigation:** The CI workflow (`ci.yml`) uses a conditional `runs-on` expression that routes fork PRs to GitHub-hosted `ubuntu-latest` runners automatically. Only same-repo pushes and PRs run on self-hosted runners.

```yaml
runs-on: ${{ (github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork) && 'ubuntu-latest' || fromJSON('["self-hosted","Linux","X64"]') }}
```

As additional defense-in-depth, enable **Require approval for all outside collaborators** in repo Settings > Actions > General > Fork pull request workflows.

## Idempotency

Re-running `setup-runners.sh` skips runners that are already configured and have a running service. To reconfigure, tear down first then set up again.
