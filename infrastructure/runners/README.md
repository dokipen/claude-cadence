# Self-Hosted GitHub Actions Runners

Scripts to provision and manage self-hosted GitHub Actions runners as systemd services (Linux) or launchd agents (macOS).

## Prerequisites

- **Linux**: systemd, `gh` CLI, `curl`, `tar`
- **macOS**: launchd (built-in), `gh` CLI, `curl`, `tar`
- `gh` must be authenticated with repo admin access

## Usage

### Provision runners

```bash
# Linux (requires sudo for systemd and user creation)
sudo ./setup-runners.sh --repo dokipen/claude-cadence --count 3

# macOS (no sudo needed — runs as current user)
./setup-runners.sh --repo dokipen/claude-cadence --count 3
```

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
# Linux
sudo ./teardown-runners.sh --repo dokipen/claude-cadence

# macOS
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
| Requires sudo | Yes | No |
| Default labels | `Linux,X64` | `macOS,ARM64` or `macOS,X64` |
| Default base dir | `/home/github-runner` | `~/actions-runner` |

The scripts auto-detect the platform and architecture. The runner's bundled `svc.sh` handles service installation for both systemd and launchd.

## Idempotency

Re-running `setup-runners.sh` skips runners that are already configured and have a running service. To reconfigure, tear down first then set up again.
