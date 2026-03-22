# agentd Installation and Operations Guide

`agentd` is a service for managing AI agent sessions in tmux. This guide covers
installation, configuration, and day-to-day operation.

---

## 1. System Requirements

**Supported operating systems:** macOS, Linux

| Dependency | Required | Notes |
|---|---|---|
| Go 1.21+ | Build only | Not needed if using a pre-built binary |
| git | Yes | Worktree and repo management |
| vault CLI | No | Secret injection for private repos |

---

## 2. Building

```bash
cd services/agents
make build
# Produces: ./agentd
```

If Go is unavailable, the `install/install.sh` script can drive the build automatically when run from the source tree.

---

## 3. Installation

### Interactive installer (recommended)

The installer handles binary placement, user creation, directory setup, config
generation, and service registration in one step.

```bash
cd services/agents
./install/install.sh
```

The script detects the platform (macOS or Linux), checks prerequisites, prompts for
configuration values, and registers `agentd` as a launchd agent (macOS) or systemd
service (Linux).

### Manual installation

1. Build the binary: `make build`
2. Copy to a directory on your `$PATH`: `sudo cp agentd /usr/local/bin/agentd`
3. Create a config file (see Section 4)
4. Run directly or register as a service (see Section 9)

---

## 4. Configuration

### Config file location

agentd looks for its configuration in the following order:

1. Path given by `--config <path>` flag
2. Path in the `AGENTD_CONFIG` environment variable
3. `~/.config/agentd/config.yaml` (default)

Copy the example config as a starting point:

```bash
cp services/agents/config.example.yaml ~/.config/agentd/config.yaml
```

### Full configuration reference

```yaml
# Network binding
host: "127.0.0.1"   # default: 127.0.0.1

# Root directory for git clones and worktrees (required for git/worktree features)
root_dir: "/var/lib/agentd"

# Logging
log:
  level: "info"    # default: "info"  — debug, info, warn, error
  format: "json"   # default: "json"  — json, text

# Stale session cleanup
cleanup:
  stale_session_ttl: "24h"   # default: "24h" — destroy stopped sessions after this duration
  check_interval: "5m"       # default: "5m"  — how often to scan for stale sessions

# Authentication
auth:
  mode: "none"           # default: "none" — "none" or "token"
  token: ""              # shared bearer token (token mode)
  token_env_var: ""      # env var to read the token from (takes priority over token)

# HashiCorp Vault integration (optional — omit entire block if unused)
vault:
  address: "https://vault.example.com"
  auth_method: "token"        # "token" or "approle"

  # Token auth
  token: ""               # inline token (not recommended for production)
  token_env_var: ""       # env var override; falls back to VAULT_TOKEN if empty

  # AppRole auth
  role_id: ""
  secret_id: ""
  secret_id_env_var: ""   # env var override for secret_id

# Agent profiles
profiles:
  my-agent:
    repo: "https://github.com/org/project.git"
    command: "claude --model sonnet --permission-mode accept --cwd {{.WorktreePath}} {{.ExtraArgs}}"
    description: "Claude Code agent"
    vault_secret: ""   # optional — Vault path for repo credentials

```

### Configuration constraints

- `root_dir` is required whenever profiles use worktrees or repo cloning.
- Binding to a non-loopback address (`host` other than `127.0.0.1`, `localhost`, or
  `::1`) requires `auth.mode` to be `"token"`. The service will refuse to start if
  this constraint is violated.
- At least one profile must be defined.
- Every profile must have a non-empty `command`.
- A profile with `vault_secret` set requires a `vault` block in the config.

---

## 5. Running

```bash
# Using --config flag
agentd --config ~/.config/agentd/config.yaml

# Using environment variable
AGENTD_CONFIG=~/.config/agentd/config.yaml agentd
```

agentd logs to stderr in JSON format by default. Use a process supervisor or service
manager to capture and rotate logs.

---

## 6. Profile Configuration

Profiles define which agent command to run and against which repository. Each profile
name becomes an identifier used in API calls.

### Command template variables

Profile `command` strings are Go templates evaluated at session start:

| Variable | Description |
|---|---|
| `{{.WorktreePath}}` | Absolute path of the checked-out worktree |
| `{{.PluginDir}}` | Plugin directory from profile config (empty if not set) |
| `{{.ExtraArgs}}` | Additional arguments passed by the caller at session creation |
| `{{.SessionName}}` | Human-readable tmux session name |
| `{{.SessionID}}` | Unique session UUID |

Use `{{if .PluginDir}}` conditionals to omit flags when the variable is unset.

### Examples

```yaml
profiles:
  # Claude Code reviewer with plugin support
  claude-reviewer:
    repo: "https://github.com/org/project.git"
    command: "claude --model sonnet --permission-mode accept{{if .PluginDir}} --plugin-dir {{.PluginDir}}{{end}} --cwd {{.WorktreePath}} {{.ExtraArgs}}"
    plugin_dir: "/opt/cadence/plugin"
    description: "Claude Code reviewer"

  # Claude Opus for complex tasks
  claude-opus:
    repo: "https://github.com/org/project.git"
    command: "claude --model opus --permission-mode accept{{if .PluginDir}} --plugin-dir {{.PluginDir}}{{end}} --cwd {{.WorktreePath}} {{.ExtraArgs}}"
    plugin_dir: "/opt/cadence/plugin"
    description: "Claude Opus agent"

  # Custom agent script (no plugin)
  my-agent:
    repo: "https://github.com/org/project.git"
    command: "/usr/local/bin/my-agent --session {{.SessionID}} --dir {{.WorktreePath}} {{.ExtraArgs}}"
    description: "Custom agent"
```

---

## 7. Authentication

By default (`auth.mode: "none"`) the service accepts all connections without
credentials. This is safe when `agentd` is bound to localhost and accessed only by
trusted local processes.

### Token authentication

Set `auth.mode` to `"token"` and supply a token:

```yaml
auth:
  mode: "token"
  token_env_var: "AGENTD_TOKEN"   # preferred — read token from environment
```

Or inline (not recommended for shared configs):

```yaml
auth:
  mode: "token"
  token: "my-secret-token"
```

Token authentication is required whenever `agentd` is bound to a non-loopback
interface.

---

## 8. Vault Integration

HashiCorp Vault is used to supply credentials for private repositories at session
start time. When a profile specifies `vault_secret`, agentd fetches the secret from
Vault before cloning the repo.

### When to use Vault

- Profiles that clone private repositories requiring authentication tokens
- Environments where credentials must not be stored in config files

### Token authentication

```yaml
vault:
  address: "https://vault.example.com"
  auth_method: "token"
  token_env_var: "VAULT_TOKEN"   # standard Vault env var; used by default
```

### AppRole authentication

AppRole is suitable for automated deployments where a human-interactive token is not
available:

```yaml
vault:
  address: "https://vault.example.com"
  auth_method: "approle"
  role_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  secret_id_env_var: "VAULT_SECRET_ID"   # inject secret_id at runtime
```

### Profile vault_secret field

```yaml
profiles:
  private-agent:
    repo: "https://github.com/org/private-repo.git"
    command: "claude --cwd {{.WorktreePath}} {{.ExtraArgs}}"
    vault_secret: "secret/data/agentd/github/private-repo"
```

The value is the Vault KV path from which agentd reads credentials before cloning.

---

## 9. Agent Hub Integration

agentd can optionally connect to a central agent-hub, making it visible and dispatchable from the issues UI. The hub block is optional — agentd runs standalone without it.

### Configuration

Add a `hub:` block to `config.yaml`:

```yaml
hub:
  url: "wss://cadence.bootsy.internal/ws/agent"
  name: "mbp-bob"              # unique identifier for this machine
  token_env_var: "HUB_AGENT_TOKEN"  # read token from environment (recommended)
  reconnect_interval: "5s"    # default: 5s
```

The `token_env_var` field names an environment variable that holds the hub authentication token. This avoids embedding secrets directly in the config file. You can also set `token` inline (not recommended for production).

### Installing with hub support

The interactive installer prompts for hub configuration:

```
==> Hub configuration (optional — connects this agent to an agent-hub)
Connect this agent to an agent-hub? [y/N]: y
Hub WebSocket URL [wss://cadence.bootsy.internal/ws/agent]:
Agent name (identifier for this machine) [mbp-bob]:
Hub agent token (input hidden):
```

When you answer `y`, the installer adds the `hub:` block to `config.yaml` and sets `HUB_AGENT_TOKEN` in the launchd plist (macOS) so the token is injected into the service environment automatically.

### Manual token injection (macOS)

If you install manually or need to rotate the token, edit the plist at `~/Library/LaunchAgents/com.cadence.agentd.plist` and update the `HUB_AGENT_TOKEN` value under `EnvironmentVariables`:

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>HUB_AGENT_TOKEN</key>
    <string>your-token-here</string>
</dict>
```

Reload the service after editing:

```bash
launchctl bootout "gui/$(id -u)/com.cadence.agentd"
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.cadence.agentd.plist
```

On Linux, write the token to the environment file (default `/etc/agentd/env`):

```bash
echo "HUB_AGENT_TOKEN=your-token-here" | sudo tee /etc/agentd/env
sudo chmod 600 /etc/agentd/env
sudo systemctl restart agentd
```

### Verifying hub registration

After the service starts, verify the agent appears in the hub:

```bash
curl -s -H "Authorization: Bearer $HUB_API_TOKEN" \
  https://cadence.bootsy.internal/api/v1/agents | jq '.[].name'
```

The agent's name (e.g. `"mbp-bob"`) should appear with `"status": "online"`. It will then be visible and dispatchable from the issues UI.

---

## 10. Stale Session Cleanup

agentd automatically tracks session state. When a tmux session stops (the agent
process exits), the session transitions to a stopped state. The cleanup subsystem
runs on a configurable interval and destroys stopped sessions that have been idle
longer than `stale_session_ttl`.

On restart, agentd reconciles its internal state with the live tmux sessions,
recovering any sessions that are still running.

```yaml
cleanup:
  stale_session_ttl: "24h"   # how long to keep stopped sessions before destroying them
  check_interval: "5m"       # how often to run the cleanup scan
```

---

## 11. Service Management

The interactive installer registers agentd as a system service automatically. For
manual setups, use the templates in `install/`.

### macOS — launchd

```bash
# Install (done by install.sh, shown for reference)
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.cadence.agentd.plist

# Start / stop
launchctl kickstart -k "gui/$(id -u)/com.cadence.agentd"
launchctl bootout "gui/$(id -u)/com.cadence.agentd"

# View logs (launchd redirects stdout/stderr to files configured in the plist)
tail -f ~/Library/Logs/agentd/agentd.stderr.log
```

The plist template (`install/agentd.plist.tmpl`) sets `KeepAlive` and `RunAtLoad`,
so agentd starts at login and restarts automatically on failure.

### Linux — systemd

```bash
# Enable and start (done by install.sh, shown for reference)
sudo systemctl enable agentd
sudo systemctl start agentd

# Control
sudo systemctl stop agentd
sudo systemctl restart agentd

# View logs
journalctl -u agentd -f
```

The systemd unit template (`install/agentd.service.tmpl`) sets `Restart=on-failure`
with a 5-second restart delay. Logs go to the journal (`SyslogIdentifier=agentd`).

### Uninstalling

```bash
./install/uninstall.sh
```

---

## 12. Reverse Proxy (Caddy)

A shared Caddyfile in `infrastructure/Caddyfile` provides a single entry point for both the issues and agents services. See the [Caddy setup section](../../../infrastructure/README.md) for full details.

When running behind Caddy, agent-hub traffic is proxied through the configured routes. See the [infrastructure README](../../../infrastructure/README.md) for details.

---

## 13. Troubleshooting

### Permission errors on root_dir

agentd needs read/write access to `root_dir` and its subdirectories. Check ownership:

```bash
ls -la /var/lib/agentd
sudo chown -R agentd:agentd /var/lib/agentd
```

### Authentication rejected

Verify the token matches what was configured and that the `Authorization` header
is formatted correctly: `Bearer <token>` (case-sensitive).

### Enabling debug logging

Set `log.level` to `"debug"` in the config and restart the service. This produces
verbose output for all tmux interactions and session state transitions.

```yaml
log:
  level: "debug"
  format: "text"   # "text" is easier to read in a terminal; use "json" for log aggregators
```

### Local Network permission blocked (macOS)

**Symptom:** The hub connection fails with:

```
dial tcp 192.168.x.x:443: connect: no route to host
```

even though the host is otherwise reachable on the LAN.

**Cause:** macOS requires explicit permission for processes to access local network hosts. Interactive terminal processes inherit the terminal's Local Network permission, but launchd agents must be independently approved. macOS may silently deny connections without prompting.

**Fix:** Open **System Settings > Privacy & Security > Local Network** and enable access for `agentd`. If it does not appear by name, look for `a.out` — the default identifier for Go binaries.

After granting permission, restart the service:

```bash
launchctl kickstart -k "gui/$(id -u)/com.cadence.agentd"
```
