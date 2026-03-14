# US-05: System Service Installation

## Summary

An interactive install script configures the agent service as a system daemon using launchd (macOS) or systemd (Linux), with options for user, directories, and network binding.

## Stories

### Installation
- As a user, I can run `install.sh` to set up the service
- As a user, the installer detects whether I'm on macOS or Linux
- As a user, I'm prompted to choose a user to run the service as (default: current user)
- As a user, I'm offered the option to create a new system user for the service
- As a user, I'm prompted for the root directory (default: `/var/lib/agentd`)
- As a user, I'm prompted for the host binding (default: `127.0.0.1`)
- As a user, I'm prompted for the port (default: `4141`)
- As a user, the installer verifies prerequisites (git, tmux) and warns about optional dependencies (vault, ttyd)

### macOS (launchd)
- As a user, the installer generates a launchd plist from a template
- As a user, the plist is installed to `~/Library/LaunchAgents/com.cadence.agentd.plist`
- As a user, the service is loaded and starts automatically
- As a user, the service auto-restarts on failure (KeepAlive)
- As a user, stdout/stderr are logged to configurable paths

### Linux (systemd)
- As a user, the installer generates a systemd unit file from a template
- As a user, the unit is installed to `/etc/systemd/system/agentd.service`
- As a user, the service is enabled and started
- As a user, the service auto-restarts on failure (Restart=on-failure)

### Uninstallation
- As a user, I can run `uninstall.sh` to cleanly remove the service
- As a user, the uninstaller stops the service, removes the service definition, and optionally removes data

### Verification
- As a user, the installer verifies the service started by health-checking the gRPC endpoint

## E2E Test Cases

| Test | Description |
|------|-------------|
| `TestInstall_PlistGeneration` | Verify launchd plist template renders correctly |
| `TestInstall_SystemdGeneration` | Verify systemd unit template renders correctly |
| `TestInstall_PrerequisiteCheck` | Verify prerequisite detection works |
| `TestInstall_ConfigGeneration` | Verify config.yaml is generated from prompts |

## Implementation Phase

**Phase 5** (Install Script + Service Management) -- 5 story points

Blocked by: Phase 1
