# Filesystem Sandboxing for agentd Agent Processes

## Threat Model

agentd spawns agent processes (e.g., the `claude` CLI) inside a PTY via `exec.Command`. These child processes:

- Run as the `agentd` user
- Inherit the daemon's full environment and filesystem access
- Are **not** restricted by the systemd service unit's `ProtectHome=true` directive, which applies only to the daemon cgroup, not PTY children

This means an agent process can traverse any path the `agentd` user can read. On a dedicated install with a minimal `agentd` home directory, this risk is bounded. On macOS dev installs where the agent runs as the developer's own user account, the risk is higher.

The primary deployment (Docker) already provides strong isolation via container namespaces — the agent is confined to the container filesystem, with `~/.claude` as a deliberate bind-mount exception.

## Existing Controls

| Control | Scope | Type |
|---|---|---|
| Docker container namespace | Container deployment | Hard (kernel-enforced) |
| `ProtectHome=true` in systemd unit | Linux daemon process only | Hard (namespace, does not cover PTY children) |
| Prompt-level scope guard (#530) | All deployments | Soft (instructional) |

## Sandboxing Options Evaluated

### Linux: bubblewrap (recommended for bare-metal)

[bubblewrap](https://github.com/containers/bubblewrap) creates unprivileged user/mount namespaces, providing a minimal and controllable filesystem view to child processes. It is available on most Linux distributions and does not require root or setuid.

**Integration:** Add a `bwrap` wrapper to the profile `command` in `config.yaml`:

```yaml
profiles:
  your-profile:
    command: >
      bwrap
        --bind {{.WorktreePath}} {{.WorktreePath}}
        --ro-bind /usr /usr
        --ro-bind /etc /etc
        --ro-bind /home/agentd/.claude /home/agentd/.claude
        --ro-bind /nix /nix
        --proc /proc
        --dev /dev
        --tmpfs /tmp
        --die-with-parent
        -- claude --dangerously-skip-permissions
          --model claude-sonnet-4-6
          --add-dir {{.WorktreePath}}
```

This wrapper:
- Binds the worktree at its real path (read-write)
- Makes system paths (`/usr`, `/etc`) available read-only
- Binds `~/.claude` so the CLI can authenticate
- Blocks access to all other paths not explicitly listed
- Fails with `ENOENT` or `EACCES` on access outside the allowed set

**Requirements:** `bwrap` must be installed. On Debian/Ubuntu: `apt install bubblewrap`. On Arch: `pacman -S bubblewrap`. Not applicable inside Alpine-based containers (use the container's own isolation).

### Linux: Landlock LSM

Linux Landlock (kernel 5.13+) provides in-process filesystem access control via syscall. It can be applied inside agentd's Go code before `exec`, and restrictions are inherited by child processes.

The `github.com/landlock-lsm/go-landlock` library wraps the interface with graceful degradation on older kernels.

**Status:** Not implemented. This would be the most robust Linux path (no external binary, kernel-enforced, inherited across exec chains), but the effort is disproportionate given Docker's existing isolation. File a new ticket if bare-metal Linux security becomes a higher priority.

### macOS: No practical path

- `sandbox-exec` / Seatbelt: Officially deprecated since macOS 10.x; profile syntax is undocumented and changes without notice. Not suitable as a long-term dependency.
- App Sandbox / Hardened Runtime: Requires code signing. Not applicable to a user-installed binary.
- TCC: Controls privacy-category paths (Desktop, Documents, etc.), not a programmatic allowlist.

**Status:** Accept prompt-only control for macOS dev installs. Use a dedicated low-privilege user account for the `agentd` daemon.

## Recommendation

**Current recommendation: defer OS-level enforcement; rely on Docker isolation and the prompt-level guard.**

Rationale:
1. The Docker deployment — the primary production path — already provides hard namespace isolation.
2. The systemd unit already applies `ProtectHome=true`, `NoNewPrivileges=true`, and `ProtectSystem=strict` to the daemon process.
3. bubblewrap is available as an opt-in profile command wrapper for Linux bare-metal installs that need stronger enforcement.
4. macOS has no stable, unprivileged sandboxing mechanism for arbitrary subprocesses.
5. Landlock integration in Go would be the most complete solution but requires ongoing maintenance as allowed paths evolve with new tools and workflows.

## Future Work

- **Landlock integration** (`github.com/landlock-lsm/go-landlock`): Add a `sandbox.allowed_paths` field to the `Profile` config struct, enforced via Landlock on Linux before PTY spawn. Graceful degradation on older kernels and macOS. See [issue #407](https://github.com/dokipen/claude-cadence/issues/407) for background.
- **macOS re-evaluation**: If a supported, unprivileged sandbox API becomes available on macOS, revisit.
