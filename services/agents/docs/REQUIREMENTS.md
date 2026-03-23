# Agent Service Requirements

## Overview

The Agent Service (`agentd`) manages AI agent sessions. It provides a control plane for launching, monitoring, and destroying agent processes running in PTY-based sessions, each operating within an isolated git worktree. Session management is dispatched through the agent-hub WebSocket reverse connection.

The service is agent-agnostic -- profiles can launch any CLI agent (Claude Code, Gemini, custom tools) with arbitrary arguments. Each profile pairs a command template with a GitHub repository, enabling reproducible, isolated agent sessions against specific codebases.

## System Requirements

- **OS**: macOS or Linux
- **Runtime**: Single Go binary, no container runtime required
- **Dependencies**: git (required); vault CLI (optional, for secrets)
- **Network**: binds to loopback only; no inbound port exposed externally

## Core Concepts

### Agent Profile

A named configuration that defines:
- **Command template**: The CLI invocation to launch the agent (e.g., `claude --model sonnet --cwd {{.WorktreePath}}`)
- **Repository**: The GitHub repository the agent works against
- **Description**: Human-readable explanation
- **Vault secret** (optional): Path to credentials for private repo access

Profiles are defined in the service's YAML configuration file. The command template supports Go template variables for dynamic values like the worktree path.

### Session

A running instance of an agent profile. Each session has:
- A unique UUID identifier
- A human-readable name
- An isolated git worktree (created from the latest default branch)
- A PTY process running the agent command
- Optional WebSocket relay for web terminal access
- Lifecycle state tracking (CREATING, RUNNING, STOPPED, ERROR, DESTROYING)

### Root Directory

A configurable directory where the service stores all git clones and worktrees:
```
{root_dir}/
├── repos/          # Full git clones, updated via pull only
└── worktrees/      # Per-session isolated worktrees
```

## User Stories

### US-01: Session Lifecycle

As a user, I can manage agent sessions through the hub API.

- I can create a session by specifying a profile name and optional session name
- I can list all active sessions with their current status
- I can get details about a specific session by ID
- I can destroy a session, which terminates the PTY process and cleans up resources
- Duplicate session names are rejected with an appropriate error
- If I don't provide a session name, one is auto-generated
- Session names are validated (`[a-zA-Z0-9_-]`)
- Extra args are validated (no null bytes, max 64 args, max 4096 bytes each) and individually shell-escaped before template rendering

**E2E test file**: `test/e2e/session_lifecycle_test.go`

### US-02: Git Repository & Worktree Management

As a user, the service manages git repositories and creates isolated environments.

- The service clones configured repositories to the root directory on first use
- Subsequent sessions reuse existing clones (no redundant cloning)
- The default branch is pulled before creating each new worktree
- Each session gets its own isolated git worktree
- Changes made in a worktree do not affect the main clone or other sessions
- Worktrees are cleaned up when sessions are destroyed
- The main clone is never modified except to update the default branch

**E2E test file**: `test/e2e/git_worktree_test.go`

### US-03: Vault Secrets

As a user, the service can use HashiCorp Vault for credentials.

- The service fetches GitHub credentials from Vault for private repo cloning
- Vault secrets can be injected as environment variables into PTY sessions
- Both token and AppRole authentication methods are supported
- Profiles without `vault_secret` work without Vault (public repos)

**E2E test file**: `test/e2e/vault_test.go`

### US-04: Web Terminal Access

As a user, I can observe agent sessions through a web browser.

- Each session has a WebSocket relay for terminal access
- The session's websocket URL is included in the Session response
- Each session gets a unique port (incremented from a configurable base port)
- The WebSocket relay is automatically stopped when sessions are destroyed

**E2E test file**: `test/e2e/websocket_test.go`

### US-05: System Service Installation

As a user, I can install the service as a system daemon.

- An interactive installer detects macOS vs Linux
- The installer prompts for: user to run as, root directory, host, port
- On macOS: generates a launchd plist and loads it
- On Linux: generates a systemd unit file, enables and starts the service
- The service auto-restarts on failure
- An uninstaller cleanly removes the service

**E2E test file**: `test/e2e/install_test.go`

## API Summary

Session management is dispatched via JSON-RPC over the agent-hub WebSocket connection.

| Method | Description |
|--------|-------------|
| `createSession` | Launch an agent in a new PTY-based session |
| `getSession` | Get current state of a session (reconciled with live PTY processes) |
| `listSessions` | List all sessions with optional profile/state filters |
| `destroySession` | Terminate PTY process, clean up worktree, remove state |
| `getTerminalEndpoint` | Get terminal relay or URL for a session |

See `docs/PLAN.md` and `internal/hub/dispatch.go` for the full API surface.

## Configuration

Service configuration is stored in YAML format at `~/.config/agentd/config.yaml` (overridable via `--config` flag or `AGENTD_CONFIG` env var).

Key configuration sections:
- **Network**: host (loopback binding)
- **Root directory**: where repos and worktrees are stored
- **Vault**: address, auth method, secret prefix
- **Logging**: level, format
- **Cleanup**: stale session TTL, check interval
- **Profiles**: named agent configurations

See `docs/PLAN.md` for full configuration schema.

## Implementation Phases

| Phase | Est | Description |
|-------|-----|-------------|
| 0 | 1 | Project setup: docs, plan, issue scaffolding |
| 1 | 5 | Steel thread: config + PTY session CRUD |
| 2 | 5 | Git repository management + worktrees |
| 3 | 3 | Vault integration |
| 4 | 3 | Web terminal access (PTY relay) |
| 5 | 5 | Install script (launchd + systemd) |
| 6 | 3 | Stale cleanup + service recovery |
| 7 | 5 | Cadence skill + docs + CI |

Total: 30 story points. See `docs/PLAN.md` for detailed acceptance criteria per phase.
