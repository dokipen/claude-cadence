# Agent Service Plan

## Context

The cadence project needs a gRPC service that manages AI agent sessions. The service handles the full agent lifecycle: loading configured agent profiles, managing git repository clones, creating isolated worktree environments, and launching agent processes in tmux sessions with optional web-based terminal access via ttyd.

This enables running multiple concurrent agent sessions, each in their own isolated git worktree, observable via browser, and manageable through a gRPC API. The service runs as a system daemon (launchd on macOS, systemd on Linux) on bare metal -- not containerized, since it manages tmux sessions directly.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Go | First-class gRPC, single static binary, excellent process management, fast startup for system daemon |
| API | gRPC (proto3) | User requirement. Clean typed API with codegen |
| Config | YAML | Standard for Go services, supports comments, human-readable |
| Session management | tmux | User requirement. Dedicated socket (`agentd`) isolates from user tmux |
| Web terminal | ttyd | Exposes tmux sessions as websocket-backed terminals in browser |
| Secrets | HashiCorp Vault | User requirement. Token + AppRole auth |
| Service mgmt | launchd (macOS) / systemd (Linux) | User requirement. Install script handles both |
| Repo storage | Full clones under root_dir | Required for `git worktree add`. Never modified except default branch pull |

## Directory Structure

```
services/agents/
├── proto/
│   └── agents/v1/
│       └── agents.proto              # gRPC service definition
├── gen/
│   └── agents/v1/                        # Generated proto Go code (protoc output)
├── cmd/
│   └── agentd/
│       └── main.go                   # Entry point, config load, graceful shutdown
├── internal/
│   ├── config/
│   │   └── config.go                 # YAML config loading + validation
│   ├── server/
│   │   └── server.go                 # gRPC server setup, interceptors
│   ├── service/
│   │   └── agent_service.go          # RPC implementations
│   ├── tmux/
│   │   └── tmux.go                   # Session create/destroy/list/has-session
│   ├── git/
│   │   └── git.go                    # Clone, pull, worktree add/remove/prune
│   ├── vault/
│   │   └── vault.go                  # Vault client, secret fetching
│   ├── ttyd/
│   │   └── ttyd.go                   # ttyd process management, port allocation
│   └── session/
│       ├── manager.go                # Session lifecycle orchestration
│       └── store.go                  # In-memory session state (map + mutex)
├── install/
│   ├── install.sh                    # Interactive installer
│   ├── uninstall.sh                  # Uninstaller
│   ├── agentd.plist.tmpl             # launchd template
│   └── agentd.service.tmpl           # systemd template
├── test/
│   └── e2e/
│       ├── helpers_test.go           # TestMain, test client factory, tmux helpers
│       ├── session_lifecycle_test.go  # CRUD e2e tests
│       ├── git_worktree_test.go      # Git + worktree e2e tests
│       └── testdata/
│           └── config.yaml           # Test config with simple profiles
├── docs/
│   ├── REQUIREMENTS.md               # Full requirements document
│   ├── PLAN.md                       # This plan
│   ├── INSTALL.md                    # Setup & deployment guide
│   └── user-stories/
│       ├── 01-session-lifecycle.md
│       ├── 02-git-worktree.md
│       ├── 03-vault-secrets.md
│       ├── 04-web-terminal.md
│       └── 05-system-service.md
├── config.example.yaml
├── go.mod
├── go.sum
├── Makefile
└── README.md
```

## gRPC API

```protobuf
syntax = "proto3";

package agents.v1;

option go_package = "services/agents/gen/agents/v1;agentsv1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/empty.proto";

service AgentService {
  // CreateSession launches an agent in a new tmux session.
  // In later phases: clones repo, creates worktree, starts ttyd.
  rpc CreateSession(CreateSessionRequest) returns (CreateSessionResponse);

  // GetSession returns the current state of a session.
  // Reconciles in-memory state with tmux reality.
  rpc GetSession(GetSessionRequest) returns (GetSessionResponse);

  // ListSessions returns all tracked sessions, optionally filtered.
  rpc ListSessions(ListSessionsRequest) returns (ListSessionsResponse);

  // DestroySession kills the tmux session, cleans up worktree,
  // stops ttyd, and removes session state.
  rpc DestroySession(DestroySessionRequest) returns (google.protobuf.Empty);
}

message CreateSessionRequest {
  // Agent profile name from config (e.g. "claude-reviewer", "gemini-agent").
  // Each profile defines a command template + repo pairing.
  string agent_profile = 1;

  // Human-readable session name. Becomes the tmux session name.
  // Must be unique among active sessions. Validated for tmux-safe chars.
  // If empty, auto-generated: {profile}-{unix_timestamp}.
  string session_name = 2;

  // Optional git ref to base the worktree on. Defaults to default branch.
  string base_ref = 3;

  // Optional env vars injected into the tmux session.
  map<string, string> env = 4;

  // Optional args appended to the command template.
  // Each arg is individually shell-escaped (single-quoted) before joining.
  // Validated: no null bytes, max 64 args, max 4096 bytes each.
  repeated string extra_args = 5;
}

message CreateSessionResponse {
  Session session = 1;
}

message GetSessionRequest {
  string session_id = 1;
}

message GetSessionResponse {
  Session session = 1;
}

message ListSessionsRequest {
  // Filter by profile name. Empty returns all.
  string agent_profile = 1;
  // Filter by state. UNSPECIFIED returns all.
  SessionState state = 2;
}

message ListSessionsResponse {
  repeated Session sessions = 1;
}

message DestroySessionRequest {
  string session_id = 1;
  // If true, forcibly kill even if process is running.
  // If false and process is running, returns FAILED_PRECONDITION.
  bool force = 2;
}

message Session {
  string id = 1;                            // UUID v4
  string name = 2;                          // Human-readable, tmux session name
  string agent_profile = 3;
  SessionState state = 4;
  string worktree_path = 5;                 // Absolute path (empty until git phase)
  string repo_url = 6;                      // From profile config
  string base_ref = 7;                      // Git ref worktree was based on
  string tmux_session = 8;                  // tmux session identifier
  google.protobuf.Timestamp created_at = 9;
  string error_message = 10;               // Set when state=ERROR
  int32 agent_pid = 11;                    // PID inside tmux (0 if not running)
  string websocket_url = 12;               // ttyd URL (empty until websocket phase)
}

enum SessionState {
  SESSION_STATE_UNSPECIFIED = 0;
  SESSION_STATE_CREATING = 1;
  SESSION_STATE_RUNNING = 2;
  SESSION_STATE_STOPPED = 3;    // Agent process exited
  SESSION_STATE_ERROR = 4;
  SESSION_STATE_DESTROYING = 5;
}
```

## Configuration Schema

```yaml
# ~/.config/agentd/config.yaml

# Network binding
host: "127.0.0.1"
port: 4141

# Root directory for git clones and worktrees
root_dir: "/var/lib/agentd"

# Vault configuration (optional, needed for private repos)
vault:
  address: "http://127.0.0.1:8200"
  auth_method: "token"          # "token" or "approle"
  secret_prefix: "secret/data/agentd"

# tmux configuration
tmux:
  socket_name: "agentd"         # Dedicated tmux socket

# ttyd websocket configuration
ttyd:
  enabled: false
  base_port: 7681               # Incremented per session

# Logging
log:
  level: "info"                 # debug, info, warn, error
  format: "json"                # json, text

# Stale session cleanup
cleanup:
  stale_session_ttl: "24h"      # Auto-destroy stopped sessions after this
  check_interval: "5m"

# Agent profiles — each profile defines what agent to launch and against which repo.
# The "command" is a generic CLI invocation — could be claude, gemini, or any agent CLI.
# Users specify whatever arguments they want (model, permission mode, flags, etc.).
profiles:
  claude-reviewer:
    repo: "https://github.com/org/project.git"
    command: "claude --model sonnet --permission-mode accept --cwd {{.WorktreePath}} {{.ExtraArgs}}"
    description: "Claude Code reviewer against org/project"

  claude-opus:
    repo: "https://github.com/org/project.git"
    command: "claude --model opus --permission-mode accept --cwd {{.WorktreePath}} {{.ExtraArgs}}"
    description: "Claude Opus agent against org/project"

  gemini-agent:
    repo: "https://github.com/org/other-project.git"
    command: "gemini-cli run --project {{.WorktreePath}} {{.ExtraArgs}}"
    description: "Gemini agent against org/other-project"

  private-auditor:
    repo: "git@github.com:org/private-project.git"
    command: "claude --model sonnet --cwd {{.WorktreePath}}"
    description: "Security auditor for private repo"
    vault_secret: "secret/data/agentd/github/private-project"
```

**Profile fields:**
- `repo` -- the GitHub repository this profile works on (HTTPS or SSH URL)
- `command` -- generic CLI invocation with Go template variables (see below)
- `description` -- human-readable description
- `vault_secret` -- (optional) Vault path for credentials needed to clone/access the repo

**Template variables** available in `command`:
- `{{.WorktreePath}}` -- absolute path to the session's worktree
- `{{.ExtraArgs}}` -- extra_args from CreateSessionRequest, each individually shell-escaped with single quotes then joined with spaces
- `{{.SessionName}}` -- the session name
- `{{.SessionID}}` -- the session UUID

## Session Lifecycle

### CreateSession Flow

1. **Validate** -- profile exists, session_name unique (check in-memory store AND `tmux has-session`), name is tmux-safe (`[a-zA-Z0-9_-]`, max 200 chars), extra_args validated (no null bytes, max 64 args, max 4096 bytes each). Auto-generate name if empty.
2. **Create record** -- UUID v4, state=CREATING, store in memory.
3. **[Phase 2+] Ensure repo clone** -- clone to `{root_dir}/repos/{owner}/{repo}` if not exists. Fetch + pull default branch.
4. **[Phase 2+] Create worktree** -- `git worktree add {root_dir}/worktrees/{session-id} {base_ref}`
5. **[Phase 3+] Resolve vault secrets** -- fetch credentials, prepare env vars.
6. **Create tmux session** -- `tmux -L agentd new-session -d -s {name} -c {workdir}`. Inject env vars via `tmux set-environment`. Send command via `tmux send-keys`.
7. **[Phase 4+] Start ttyd** -- `ttyd -p {port} -W tmux -L agentd attach-session -t {name}`
8. **Record PID** -- `tmux list-panes -t {name} -F '#{pane_pid}'`. State=RUNNING.
9. **Return session** -- or state=ERROR with message if any step fails.

### GetSession Flow

Look up by ID. Reconcile with tmux:
- tmux session exists + PID alive -> RUNNING
- tmux session exists + PID exited -> STOPPED
- tmux session gone -> STOPPED or ERROR

### DestroySession Flow

1. Look up session. NOT_FOUND if missing.
2. If process running and `force=false` -> FAILED_PRECONDITION.
3. State=DESTROYING.
4. Kill tmux: `tmux -L agentd kill-session -t {name}`
5. [Phase 4+] Kill ttyd process.
6. [Phase 2+] Remove worktree: `git worktree remove {path} --force` + `git worktree prune`
7. Remove from store.

## Root Directory Layout

```
{root_dir}/
├── repos/                          # Git clones (never modified except pull)
│   └── {owner}/
│       └── {repo}/                 # Full clone
└── worktrees/                      # Session worktrees (keyed by UUID)
    └── {session-uuid}/             # Isolated worktree
```

## E2E Testing Strategy

Tests use Go's built-in `testing` package. The gRPC server runs **in-process** (not as a subprocess) for coverage and simplicity.

### Test infrastructure (`helpers_test.go`)
- `TestMain`: starts gRPC server on random port, creates test config, tears down after all tests
- `newTestClient(t)`: creates a gRPC client connection with `t.Cleanup`
- `uniqueSessionName(t)`: generates `e2e-{TestName}-{nanos}` to prevent collisions
- `tmuxSessionExists(name)`: independent tmux verification via `tmux has-session`
- `cleanupAllTestSessions()`: safety net that kills all `e2e-` prefixed tmux sessions

### Test profiles (simple processes, not real agents)
```yaml
profiles:
  sleeper:
    command: "sleep 3600"
  fast-exit:
    command: "exit"
  echo-and-exit:
    command: "bash -c 'echo hello && sleep 1'"
  echo-args:
    command: "echo {{.ExtraArgs}}"
```

### Test cleanup (3 layers)
1. Per-test: `t.Cleanup` calls DestroySession
2. TestMain: `cleanupAllTestSessions()` kills all `e2e-*` tmux sessions
3. Makefile: `make test-cleanup` for manual recovery

### CI
- GitHub Actions: `apt-get install -y tmux` on ubuntu-latest
- `go test -v -count=1 -timeout 120s ./test/e2e/`

## Install Script Design

`install/install.sh` is an interactive bash script:

1. **Detect OS**: `uname -s` -> Darwin or Linux
2. **Prompt for**:
   - User to run as (default: current user, option to create new)
   - Root directory (default: `/var/lib/agentd`)
   - Host (default: `127.0.0.1`)
   - Port (default: `4141`)
3. **Verify prerequisites**: git, tmux installed. Warn if vault CLI missing.
4. **Build/copy binary** to `/usr/local/bin/agentd`
5. **Create directories**: root_dir/repos, root_dir/worktrees, config dir
6. **Generate config**: render config.yaml from prompts
7. **Install service**:
   - macOS: render `agentd.plist.tmpl` -> `~/Library/LaunchAgents/com.cadence.agentd.plist`, `launchctl load`
   - Linux: render `agentd.service.tmpl` -> `/etc/systemd/system/agentd.service`, `systemctl enable && start`
8. **Verify**: health check the gRPC endpoint

## Implementation Phases (GitHub Issues)

### Phase 0: Project Setup -- Docs, Plan, and Issue Scaffolding (est: 1)
**Blocked by:** none

Create the `services/agents/docs/` directory, drop the plan into it, create the GitHub milestone and all phase issues. This issue is the foundation that all other issues reference for context.

### Phase 1: Steel Thread -- gRPC + Config + Tmux Session CRUD (est: 5)
**Blocked by:** Phase 0

Proves the core control plane: gRPC server starts, CreateSession starts a process in tmux, Get/List/Destroy work, e2e tests pass. No git, no vault, no ttyd, no install script.

### Phase 2: Git Repository Management + Worktrees (est: 5)
**Blocked by:** Phase 1

Clone repos, pull default branch, create worktrees per session, cleanup on destroy.

### Phase 3: Vault Integration (est: 3)
**Blocked by:** Phase 2

HashiCorp Vault client for private repo credentials and env var injection.

### Phase 4: ttyd Web Terminal Access (est: 3)
**Blocked by:** Phase 1

Websocket-backed web terminal access to tmux sessions via ttyd.

### Phase 5: Install Script + Service Management (est: 5)
**Blocked by:** Phase 1

Interactive installer for launchd (macOS) and systemd (Linux).

### Phase 6: Stale Session Cleanup + Service Recovery (est: 3)
**Blocked by:** Phase 1

Background cleanup of stale sessions and state reconciliation on restart.

### Phase 7: Cadence Skill + Documentation + CI (est: 5)
**Blocked by:** Phase 6

Plugin skill integration, full documentation, and GitHub Actions CI.

## Milestone Summary

**Milestone: Agent Service**

| Phase | Est | Description | Depends on |
|-------|-----|-------------|------------|
| 0 | 1 | Project setup: docs, plan, issue scaffolding | -- |
| 1 | 5 | Steel thread: gRPC + config + tmux CRUD | Phase 0 |
| 2 | 5 | Git repository management + worktrees | Phase 1 |
| 3 | 3 | Vault integration | Phase 2 |
| 4 | 3 | ttyd web terminal access | Phase 1 |
| 5 | 5 | Install script (launchd + systemd) | Phase 1 |
| 6 | 3 | Stale cleanup + service recovery | Phase 1 |
| 7 | 5 | Cadence skill + docs + CI | Phase 6 |

**Total: 30 story points across 8 issues**

Phases 4, 5, 6 are independent of each other (all only depend on Phase 1), so they can be parallelized.

## Key Dependencies (Go modules)

- `google.golang.org/grpc` -- gRPC server
- `google.golang.org/protobuf` -- proto runtime
- `gopkg.in/yaml.v3` -- config loading
- `github.com/google/uuid` -- session IDs
- `github.com/hashicorp/vault/api` -- Vault client (Phase 3)
- `github.com/stretchr/testify` -- test assertions (optional)
