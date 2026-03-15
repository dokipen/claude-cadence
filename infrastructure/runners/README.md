# Self-Hosted GitHub Actions Runners

Scripts to provision and manage self-hosted GitHub Actions runners as systemd services on a Linux host.

## Prerequisites

- Linux with systemd (tested on Arch Linux)
- `gh` CLI authenticated with repo admin access
- `curl`, `tar`

## Usage

### Provision runners

```bash
sudo ./setup-runners.sh --repo dokipen/claude-cadence --count 3
```

Options:
- `--repo OWNER/REPO` — GitHub repo (required)
- `--count N` — Number of instances (default: 3)
- `--user USER` — System user (default: `github-runner`)
- `--base-dir DIR` — Install directory (default: `/home/<user>`)
- `--labels LABELS` — Runner labels (default: `Linux,X64`)
- `--runner-version VER` — Pin a specific version (default: latest)
- `--dry-run` — Print commands without executing

### List runners

```bash
./list-runners.sh
```

### Remove runners

```bash
sudo ./teardown-runners.sh --repo dokipen/claude-cadence
```

## Directory Layout

```
/home/github-runner/
  actions-runner-claude-cadence-1/
  actions-runner-claude-cadence-2/
  actions-runner-claude-cadence-3/
  actions-runner-mixty-1/
  actions-runner-mixty-2/
  ...
```

Each runner directory is namespaced by repo name, allowing multiple repos on one host.

## Idempotency

Re-running `setup-runners.sh` skips runners that are already configured (detected by the `.runner` file in each directory). To reconfigure, tear down first then set up again.
