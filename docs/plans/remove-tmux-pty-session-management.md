# Plan: Remove tmux from Web Terminal — App-Layer PTY Session Management

**Issue:** #276
**Status:** Phase 1 Complete
**Author:** Claude Cadence

---

## Goal

Remove tmux as the session manager for the issues-ui web terminal. Replace it with an app-layer PTY session manager that keeps the shell process alive server-side, buffers output for reconnect replay, and lets xterm.js handle all mouse events natively (scroll, text selection, copy/paste).

---

## Background

### The Problem

The web terminal currently runs `xterm.js` connected to a PTY via `ttyd`, with `tmux` wrapping the shell. Investigation into improving copy/paste UX revealed a fundamental conflict:

- tmux mouse mode (`set-option -g mouse on`) works via terminal escape sequences that put xterm.js into "mouse reporting mode"
- Once in mouse reporting mode, xterm.js surrenders all mouse handling to the application (tmux)
- This prevents native browser text selection and copy/paste
- No partial mode exists — it is all-or-nothing at the protocol level
- GNU Screen and Zellij have the same limitation
- Modern web terminal apps (AWS CloudShell, Cloudflare, etc.) manage PTY sessions directly without a multiplexer

### What tmux Currently Provides

From the codebase audit, tmux is used for four distinct purposes:

1. **Process launch and isolation** (`tmux.NewSession`): Starts the agent command inside a tmux session with a dedicated working directory.
2. **Mouse mode** (`set-option -g mouse on`): Enabled at session creation — the root of the UX conflict.
3. **PID discovery** (`tmux.GetPanePID`): Retrieves the PID of the running agent process for liveness tracking.
4. **Pane capture** (`tmux.CapturePane`): Used by `session.Monitor` every 5 seconds to detect idle input prompts (waiting-for-input detection).
5. **Session persistence across daemon restarts** (`Manager.RecoverSessions`): Lists existing tmux sessions to re-adopt sessions that survived a daemon restart.
6. **Environment variable propagation** (`tmux.SetEnv`): Mirrors vault secrets and request env vars into the tmux session environment for tooling visibility.
7. **ttyd attachment**: ttyd is launched with `tmux attach-session -t <name>` as its command — ttyd is fundamentally coupled to tmux today.

### Current Architecture

```
Browser (xterm.js)
    │  WebSocket  ws://.../ws/terminal/<agent>/<session>
    ▼
issues-ui (Vite dev proxy / Nginx)
    │  WebSocket proxy
    ▼
ttyd process (one per session, port range 7681+)
    │  ttyd protocol (binary frames, "tty" subprotocol)
    ▼
tmux session (named socket "agentd", per-session name)
    │  PTY
    ▼
shell / agent process
```

The `Session` struct carries a `TmuxSession` field (the tmux session name), and this is surfaced through the hub protocol, gRPC service, and frontend API client. The `Monitor` uses `CapturePane` on tmux to drive `WaitingForInput` state.

---

## Proposed Architecture

```
Browser (xterm.js)
    │  WebSocket  ws://.../ws/terminal/<agent>/<session>
    ▼
issues-ui (Vite dev proxy / Nginx)
    │  WebSocket proxy
    ▼
agentd PTY WebSocket handler (new — replaces ttyd per-session processes)
    │  read/write on os.File (PTY master)
    ▼
PTY session manager (new — keeps PTY alive, buffers output)
    │  PTY
    ▼
shell / agent process
```

Key changes:
- ttyd processes (one per session) are eliminated
- A PTY session manager within agentd holds the PTY master file descriptor and a ring buffer of recent output
- The WebSocket terminal endpoint moves into agentd itself (or a thin reverse-proxy layer in issues-ui remains, pointing at a single agentd WS endpoint rather than per-process ports)
- tmux package is removed entirely from the session lifecycle
- Mouse mode is never set; xterm.js handles all input natively

---

## Implementation Phases

### Phase 1: Audit and Document Current tmux Usage

**Goal:** Produce a complete inventory of every tmux API call and its replacement strategy before writing any new code.

**Work:**
- Document each call site in `internal/tmux/tmux.go`, `internal/session/manager.go`, `internal/session/monitor.go`, and `cmd/agentd/main.go`
- For each call, record: purpose, frequency, replacement approach
- Document what `TmuxSession` field in `Session` is used for in the hub protocol and frontend
- Identify any E2E tests that assert on tmux session names or tmux-specific behavior

**Deliverable:** Audit complete — see tables below.

**Dependencies:** None — can be done in parallel with Phase 2 design.

---

#### Audit Results (Issue #277)

**Audit date:** 2026-03-22

##### tmux Package API Surface (`internal/tmux/tmux.go`)

All public methods belong to `tmux.Client`, constructed with `tmux.NewClient(socketName string)`. Every method shells out to the `tmux` CLI with flags `-L <socketName> -f /dev/null`.

| Method | Signature | What it does |
|--------|-----------|--------------|
| `NewClient` | `NewClient(socketName string) *Client` | Constructor; stores socket name. |
| `SocketName` | `() string` | Returns the socket name. Called by `ttyd.Start` to pass `-L` flag. |
| `NewSession` | `(name, workdir, command string) error` | Runs `tmux new-session -d -s <name> -c <workdir> <command>; set-option -g mouse on`. Mouse mode chained into the same invocation. |
| `HasSession` | `(name string) bool` | Runs `tmux has-session -t <name>`. Used for liveness checks. |
| `KillSession` | `(name string) error` | Runs `tmux kill-session -t <name>`. |
| `SendKeys` | `(name, keys string) error` | Runs `tmux send-keys`. **Unused in production** — present but not called from non-test code. |
| `SetEnv` | `(name, key, value string) error` | Runs `tmux set-environment -t <name> <key> <value>`. Mirrors env vars into the session. |
| `GetPanePID` | `(name string) (int, error)` | Runs `tmux list-panes -F #{pane_pid}`. Returns the shell process PID. |
| `CapturePane` | `(name string) (string, error)` | Runs `tmux capture-pane -p`. Returns visible pane text as a string. |
| `CleanupStaleSocket` | `() error` | Resolves the socket path, probes with `tmux list-sessions`, removes the socket file if no server responds. |
| `ListSessions` | `() ([]string, error)` | Runs `tmux list-sessions -F #{session_name}`. Returns empty list if no server. |

---

##### Call Sites — `cmd/agentd/main.go`

| Line | Call | Purpose | Frequency | Replacement |
|------|------|---------|-----------|-------------|
| 64 | `tmux.NewClient(cfg.Tmux.SocketName)` | Constructs tmux client with socket name (default `"agentd"`). | Startup-once | Remove; construct `PTYManager` instead. |
| 65 | `ttyd.NewClient(...)` | Constructs ttyd client; references tmux socket name. | Startup-once | Remove; ttyd eliminated with tmux. |
| 66 | `ttydClient.CleanupOrphans(cfg.Tmux.SocketName)` | Kills orphaned ttyd processes from a previous agentd run. | Startup-once | Remove; PTY children receive SIGHUP when master fd closes. |
| 69 | `tmuxClient.CleanupStaleSocket()` | Removes stale tmux socket left by a crashed previous agentd. | Startup-once | Remove; PTY manager holds no socket files. |
| 86 | `session.NewManager(..., tmuxClient, ttydClient, ...)` | Wires tmux and ttyd clients into the session manager. | Startup-once | Pass `PTYManager` instead; remove tmux/ttyd parameters. |
| 89 | `manager.RecoverSessions()` | Calls `ListSessions` + `GetPanePID` to re-adopt orphaned sessions. | Startup-once | Remove (Option A: restarts terminate sessions). |
| 101 | `session.NewMonitor(manager, tmuxClient, 5*time.Second)` | Passes tmux client to monitor for `CapturePane`. | Startup-once wiring | Pass PTY ring buffer accessor instead. |
| 115 | `hub.NewDispatcher(manager, ttydClient, cfg.Ttyd.AdvertiseAddress)` | Wires ttyd port-lookup into hub dispatcher for `getTerminalEndpoint`. | Startup-once | Replace with PTY manager's WS endpoint resolver. |

---

##### Call Sites — `internal/session/manager.go`

| Line | Call | Purpose | Frequency | Replacement |
|------|------|---------|-----------|-------------|
| 51 | `m.tmux.HasSession(name)` (closure) | Registers a closure for checking tmux session existence. | Startup-once | Closure replaced with `m.pty.Has(id)`. |
| 104–115 | `tmuxNameRe` validation | Session names validated to `[a-zA-Z0-9_-]` for tmux compatibility. | Per-`Create` | Relax to safe-URL-path chars; remove tmux-specific constraint. |
| 114 | `m.tmux.HasSession(sessionName)` | Guards against duplicate tmux sessions before creation. | Per-`Create` | Remove; PTY manager's `Create` returns error on duplicate IDs. |
| 129 | `sess.TmuxSession = sessionName` | Populates `TmuxSession` on Session struct. | Per-`Create` | Remove population; keep field as `""` during transition. |
| 245 | `m.tmux.NewSession(sessionName, workdir, fullCommand)` | Creates tmux session, launches agent command as its initial process. | Per-`Create` | Replace with `m.pty.Create(id, workdir, cmd, env, cols, rows)`. |
| 257–268 | `m.tmux.SetEnv(...)` (vault secrets loop) | Mirrors vault secrets into tmux session environment. | Per-`Create`, per-secret | Remove; env vars already passed via `export` in the command string. |
| 270–272 | `m.tmux.SetEnv(...)` (request env loop) | Mirrors request env vars into tmux session environment. | Per-`Create`, per-env-var | Remove; same reason. |
| 279 | `m.tmux.GetPanePID(sessionName)` | Gets agent process PID after session creation. | Per-`Create` (once) | Remove; PID known from `cmd.Start()` via `pty.Session.PID`. |
| 282 | `m.tmuxHasSession(sessionName)` | Guards `KillSession` when `GetPanePID` fails (fast-exit detection). | Per-`Create`, error path | Remove; PTY manager tracks liveness directly. |
| 283 | `m.tmux.KillSession(sessionName)` | Cleans up fast-exiting tmux session. | Per-`Create`, error path | Remove; PTY child exits naturally; master fd closed by manager. |
| 295 | `m.ttyd.Start(sessionID, m.tmux.SocketName(), sessionName)` | Launches per-session ttyd process. | Per-`Create` | Remove entirely; agentd serves WS terminal endpoint directly. |
| 356 | `m.ttyd.Stop(id)` | Kills per-session ttyd process on destroy. | Per-`Destroy` | Remove. |
| 360–363 | `m.tmuxHasSession` + `m.tmux.KillSession` | Kills tmux session during `Destroy`. | Per-`Destroy` | Replace with `m.pty.Destroy(id)`. |
| 381 | `m.tmux.ListSessions()` | Lists all tmux sessions for recovery. | Startup-once (`RecoverSessions`) | Remove with `RecoverSessions`. |
| 389 | `tracked[sess.TmuxSession]` | Builds set of already-tracked tmux session names. | Startup-once (`RecoverSessions`) | Remove with `RecoverSessions`. |
| 408 | `m.tmux.GetPanePID(tmuxName)` | Gets PID of recovered session's process. | Startup-once, per-recovered-session | Remove with `RecoverSessions`. |
| 448 | `m.tmuxHasSession(sess.TmuxSession)` | Liveness check in `reconcile`. | On-demand, per-Get/List | Replace with `m.pty.Has(id)` or `syscall.Kill(pid, 0)`. |
| 471 | `m.tmux.HasSession(tmuxSession)` | Liveness guard in `cleanup` helper. | Error path during `Create` | Replace with PTY manager check. |
| 472 | `m.tmux.KillSession(tmuxSession)` | Kills tmux session in `cleanup` helper. | Error path during `Create` | Replace with `m.pty.Destroy(id)`. |

---

##### Call Sites — `internal/session/monitor.go`

| Line | Call | Purpose | Frequency | Replacement |
|------|------|---------|-----------|-------------|
| 41 | `NewMonitor(manager, tmuxClient, ...)` | Constructor accepts tmux client. | Startup-once | Change signature to accept ring buffer reader interface. |
| 97 | `m.tmux.CapturePane(sess.TmuxSession)` | Captures visible pane text to detect idle input prompts. | **Periodic — every 5 seconds per running session** | Replace with `m.pty.ReadBuffer(sess.ID)` returning ring buffer snapshot. `promptPatterns` regex unchanged. |

---

##### Call Sites — `internal/ttyd/ttyd.go`

ttyd is fundamentally coupled to tmux. `ttyd.Start` (line 82–88) launches: `ttyd ... tmux -L <socket> -f /dev/null attach-session -t <name>`. With tmux removed, ttyd has no role.

| Method | Frequency | Replacement |
|--------|-----------|-------------|
| `Start(sessionID, tmuxSocketName, tmuxSessionName)` | Per-`Create` | Eliminated; agentd WS endpoint serves the terminal. |
| `Stop(sessionID)` | Per-`Destroy` | Eliminated. |
| `CleanupOrphans(socketName)` | Startup-once | Eliminated. |
| `Port(sessionID)` | On-demand, per `GetTerminalEndpoint` | Replaced by PTY manager WS route lookup. |

---

##### `TmuxSession` Field Trace

**Session struct** (`internal/session/store.go` line 25):
- `TmuxSession string` — set equal to `sessionName` at creation (`manager.go` line 129). Used as the identifier for all tmux CLI calls and as the recovery key in `RecoverSessions`.

**Hub JSON protocol** (`internal/hub/dispatch.go` lines 197–223):
- Serialized as `tmux_session` (omitempty) in all session JSON responses (`CreateSession`, `GetSession`, `ListSessions`).

**gRPC proto** (`proto/agents/v1/agents.proto` field 8):
- `string tmux_session = 8;` — populated in `service/agent_service.go` line 91.

**Frontend TypeScript** (`services/issues-ui/src/`):
- `types.ts` line 99: `tmux_session: string` — required field in the `Session` interface.
- `agentHubClient.ts` lines 132–133: `validateSessionResponse` throws `HubError(502)` if `data.tmux_session` is not a string. **An empty string `""` passes `isString("")`** — keeping the field as `""` during transition requires no frontend change.
- No UI component renders or uses `tmux_session` for display or logic — it is carried through the type system but never referenced in component source.

---

##### E2E Tests with tmux-Specific Assertions

| Test file | Assertion type | Migration path |
|-----------|---------------|----------------|
| `internal/tmux/tmux_test.go` | Integration tests against real tmux CLI | Delete entire file. |
| `test/e2e/session_lifecycle_test.go` lines 46–47, 368–369 | `tmuxSessionExists(...)` and `tmuxMouseEnabled(...)` assertions | Remove assertions; replace with PTY process liveness checks. |
| `test/e2e/helpers_test.go` lines 96–118 | `tmuxSessionExists`, `tmuxMouseEnabled`, tmux CLI helpers | Delete or replace with PTY-aware equivalents. |
| `test/e2e/ttyd_test.go` | Tests ttyd process launch and WS URL | Rewrite for PTY WS endpoint. |
| `internal/session/cleaner_test.go` | Uses `newTestManager` with fake `tmuxHasSession`; asserts on `TmuxSession` field | Replace `tmuxHasSession` closure with PTY liveness hook; remove `TmuxSession` field assertions. |
| `internal/hub/dispatch_test.go` | Mock manager without real tmux; no tmux-specific logic | Minimal changes; `tmux_session` in JSON becomes `""`. |
| `services/issues-ui/e2e/*.spec.ts` (4 files) | All mock session fixtures include `tmux_session: "lead-109"` etc. | Update fixtures to `tmux_session: ""` initially; remove field when protocol is cleaned up (Phase 6). |

---

##### Configuration Constants

| Item | Value | Notes |
|------|-------|-------|
| Default socket name | `"agentd"` | Set in `config.go` `applyDefaults`. Config key: `tmux.socket_name`. |
| Socket path | `$TMUX_TMPDIR/<uid>/agentd` or `os.TempDir()/<uid>/agentd` | Resolved by `CleanupStaleSocket`. |
| Session name pattern | `^[a-zA-Z0-9_-]+$` | `tmuxNameRe` in `manager.go` line 22. Constraint can be relaxed. |
| Auto-generated session name | `<agentProfile>-<unixNanoTimestamp>` | `manager.go` line 97. |
| Max session name length | 200 characters | `manager.go` line 101. |
| ttyd port range | `7681–7780` (base `7681`, max `100`) | Recycled on session destroy. Entire range is eliminated with ttyd. |
| Monitor interval | `5 * time.Second` | Hard-coded in `main.go` line 101 (not in config). |

---

##### Replacement Summary

| Current tmux mechanism | Replacement |
|------------------------|-------------|
| `NewSession` — process launch | `pty.Create(id, workdir, cmd, env, cols, rows)` via `creack/pty` |
| `set-option -g mouse on` | Eliminated; never set. xterm.js handles mouse natively. |
| `GetPanePID` — PID discovery | `pty.Session.PID` known at `cmd.Start()` time |
| `CapturePane` — visible pane text | `pty.ReadBuffer(id)` — ring buffer snapshot |
| `ListSessions` — recovery enumeration | No-op (Option A: restarts terminate sessions) |
| `SetEnv` — environment mirroring | Removed; env already in command-line `export` prefix |
| `HasSession` / `KillSession` — liveness/cleanup | `pty.Has(id)` / `pty.Destroy(id)` |
| `CleanupStaleSocket` | Eliminated; no socket files |
| `ttyd.Start/Stop/CleanupOrphans` | Eliminated; agentd serves WS terminal endpoint directly |
| `TmuxSession` field | Keep as `""` during transition; remove in Phase 6 protocol cleanup |
| `tmux_session` in hub JSON / gRPC | Populate with `""` initially; coordinate removal as breaking change |

---

### Phase 2: Design App-Layer PTY Session Persistence

**Goal:** Write the design for keeping PTY sessions alive and replaying buffered output on reconnect, before touching production code.

**Key design decisions to resolve:**

1. **PTY ownership**: agentd holds the PTY master `*os.File`. The child process (shell/agent) gets the PTY slave at fork. No tmux between them.

2. **Output buffer**: A ring buffer per session storing the last N bytes (or lines) of raw terminal bytes (VT sequences included). On reconnect, replay the buffer to xterm.js so the user sees recent history. Candidate: circular byte buffer, configurable max size (default ~256 KB).

3. **WebSocket terminal endpoint**: Options:
   - (A) Move terminal WebSocket into agentd — agentd serves `ws://<host>/terminal/<sessionID>` directly, agentd reads PTY master and forwards to WebSocket in both directions.
   - (B) Keep ttyd but replace `tmux attach-session` with a custom command that connects to the agentd PTY socket — more invasive and still requires ttyd.
   - **Recommendation:** Option A. Eliminates ttyd dependency, gives agentd full control over the connection lifecycle and buffer replay.

4. **Resize handling**: agentd receives JSON resize frames from xterm.js and calls `syscall.Syscall(syscall.SYS_IOCTL, ptyFd, syscall.TIOCSWINSZ, ...)` (or `unix.IoctlSetWinsize`).

5. **Process launch**: Replace `tmux.NewSession` with `os.StartProcess` or `exec.Cmd` with `SysProcAttr.Setsid = true` and a PTY allocated via `creack/pty` or the standard `posix_openpt` path.

6. **PID discovery**: The PTY child's PID is known at `cmd.Start()` time — no tmux query needed.

7. **WaitingForInput detection**: `Monitor` currently uses `tmux.CapturePane`. Replacement: parse the output ring buffer directly. The last N bytes of the buffer serve the same role as `capture-pane -p` output. The `promptPatterns` regex already operates on plain text.

8. **Session recovery after daemon restart**: tmux provided persistence across restarts "for free" (shell kept running in tmux server). With app-layer PTY management, the PTY master fd is held by the agentd process. If agentd restarts, the PTY master is lost and the child process receives SIGHUP. Options:
   - (A) Accept that daemon restarts terminate sessions (simpler; matches current behavior when tmux server also dies).
   - (B) Store PTY fd in a Unix domain socket and pass it via `SCM_RIGHTS` to the new agentd process on startup (complex, but true persistence).
   - **Recommendation:** Option A for the initial implementation. Document the limitation. A follow-up can explore fd passing if operators need zero-downtime restarts.

**Deliverable:** Finalized design notes committed to this document, with the open questions above resolved and interface sketches for the new `PTYManager` type.

**Dependencies:** Phase 1 audit complete.

---

### Phase 3: Implement Server-Side PTY Session Manager

**Goal:** Build `internal/pty` package (new) providing:
- `PTYManager`: creates PTY+process pairs, holds master fd, runs I/O copy goroutines
- `RingBuffer`: fixed-size byte buffer accumulating terminal output
- WebSocket handler: bidirectional relay between xterm.js and PTY master, with buffer replay on new connections

**Package sketch:**

```go
// internal/pty/manager.go
type Session struct {
    ID       string
    PID      int
    master   *os.File
    buf      *RingBuffer
    mu       sync.Mutex
    // ...
}

type Manager struct {
    sessions map[string]*Session
    mu       sync.RWMutex
}

func (m *Manager) Create(id, workdir, command string, env []string, cols, rows uint16) (*Session, error)
func (m *Manager) Get(id string) (*Session, bool)
func (m *Manager) Destroy(id string) error
func (m *Manager) ServeTerminal(id string, ws *websocket.Conn) error // replay buf, then bidirectional relay
```

**Key implementation notes:**
- Use `github.com/creack/pty` (already a common dependency in Go terminal projects) or raw `posix_openpt` syscalls for PTY allocation
- `RingBuffer.Snapshot()` returns a `[]byte` copy for replay — called once at WS connect time before entering the live relay loop
- The WebSocket endpoint speaks the same ttyd binary framing (`"0"`-prefixed output, `"1"`-prefixed resize) so the existing `Terminal.tsx` frontend code requires no changes during this phase
- Resize: decode `CMD_RESIZE` JSON from the WS, call `pty.Setsize(master, &pty.Winsize{Rows: r, Cols: c})`

**Integration:** Wire `PTYManager` into `session.Manager` as a replacement for `tmux.Client`. Both managers coordinate on session lifecycle events (create, destroy, recover).

**Testing:**
- Unit tests for `RingBuffer` (wrap-around, concurrent writes, snapshot)
- Unit tests for `PTYManager.Create` and `Destroy` with a simple `echo` command
- Integration test: connect two WebSocket clients sequentially to the same session; second client receives replayed buffer

**Dependencies:** Phase 2 design finalized.

---

### Phase 4: Update Session Init to Remove tmux

**Goal:** Swap `tmux.Client` out of `session.Manager` and replace each call site.

**Changes by file:**

| File | Change |
|------|--------|
| `internal/session/manager.go` | Replace `m.tmux.NewSession(...)` with `m.pty.Create(...)`. Remove `TmuxSession` population. Replace `m.tmux.GetPanePID(...)` with PID from `pty.Session`. Remove `m.tmux.SetEnv(...)` — env vars pass via `exec.Cmd.Env` instead. Remove `m.tmux.HasSession(...)` checks — PTY manager tracks liveness directly. Replace `m.ttyd.Start(...)` — WebSocket URL now points to agentd's own WS handler. |
| `internal/session/manager.go` `RecoverSessions` | Replace tmux session enumeration with PTY manager's own session list (which will be empty after restart under Option A). |
| `internal/session/store.go` (Session struct) | Rename or repurpose `TmuxSession` field. Options: remove it (breaking protocol change), keep it as a no-op legacy field, or rename to `SessionHandle`. |
| `internal/session/monitor.go` | Replace `m.tmux.CapturePane(sess.TmuxSession)` with `m.pty.ReadBuffer(sess.ID)` returning the ring buffer snapshot. |
| `cmd/agentd/main.go` | Remove `tmux.NewClient(...)`, `tmux.CleanupStaleSocket()`. Remove `ttyd.NewClient(...)` and `ttyd.CleanupOrphans(...)`. Wire PTY manager. Register WS terminal handler on the HTTP server. |
| `internal/config/config.go` | Mark `TmuxConfig` as deprecated; add `PTYConfig` (buffer size, max sessions). Keep `TtydConfig` present but flag it disabled. |
| `internal/tmux/` | Delete package after all call sites are removed. |
| `internal/ttyd/` | Delete package after all call sites are removed. |

**Protocol impact:**
The `tmux_session` field in the JSON hub protocol (`sessionInfo.TmuxSession`) is currently validated as required by the frontend (`agentHubClient.ts` line 132: `if (!isString(data.tmux_session))`). Options:
- Keep the field, populate it with the session ID or empty string (backward compat)
- Remove it with a coordinated frontend+backend change
- **Recommendation:** In this phase, keep the field and populate it with `""`. A follow-up issue can remove it from the protocol.

**Dependencies:** Phase 3 implementation complete and passing unit tests.

---

### Phase 5: Verify xterm.js Scrollback and Native Mouse Handling

**Goal:** Confirm that removing tmux mouse mode resolves the copy/paste UX issue and that xterm.js scrollback is adequate.

**Work:**

1. **Mouse handling**: With tmux gone, xterm.js should never receive mouse-mode escape sequences. Verify that:
   - Text selection with click-drag works in the browser
   - Copy with Ctrl+C (or system copy) works
   - Right-click context menu is no longer suppressed (or is suppressed intentionally for other reasons)
   - The `contextmenu` event handler in `Terminal.tsx` (line 204–210) that was added for tmux should be reconsidered — it may now be unnecessary

2. **Scrollback buffer**: xterm.js is configured with `scrollback: 1000` (Terminal.tsx line 72). The PTY ring buffer (Phase 3) replays terminal history on reconnect. Assess whether 1000 lines is sufficient:
   - For agent sessions that produce dense output (e.g., test runs), 1000 lines may be too few
   - Recommendation: increase default to `scrollback: 5000` and make it configurable
   - The ring buffer size should be tuned to hold at least as many bytes as 5000 average-length lines (~400 KB at 80 chars/line)

3. **Native scroll**: With tmux mouse mode gone, verify that the scroll wheel scrolls xterm.js's own scrollback buffer rather than sending escape sequences to the shell.

4. **Functional testing checklist:**
   - [ ] Select text in terminal with mouse
   - [ ] Copy selected text to clipboard
   - [ ] Paste text into terminal
   - [ ] Scroll up through history
   - [ ] Scroll back down to bottom
   - [ ] Terminal resizes correctly when window is resized
   - [ ] Agent output is visible in scrollback after a long run

**Dependencies:** Phase 4 complete; agentd running without tmux.

---

### Phase 6: Edge Cases, Cleanup, and Hardening

**Goal:** Address reconnect flow, session expiry, orphaned PTY cleanup, and remove all tmux artifacts.

**Edge cases to handle:**

1. **Reconnect flow**: When a browser tab reconnects after a drop, `Terminal.tsx` already calls `connect()` which creates a new xterm.js instance and new WebSocket. The PTY manager's `ServeTerminal` replays the ring buffer on the new connection, giving the user recent context. Verify the ring buffer replay is fast enough to not cause a visible delay.

2. **Multiple simultaneous connections**: Two browser tabs connecting to the same session. The PTY manager must support multiple concurrent WebSocket connections reading from the same ring buffer and receiving live output. This requires a broadcast mechanism (e.g., a list of active WS connections per session, written to from the PTY read goroutine). Define behavior: all connections receive the same bytes; resize from any connection updates the PTY window size (last-writer-wins is acceptable).

3. **Session expiry**: The existing `Cleaner` destroys stopped sessions after a configurable TTL (default 1h). With app-layer PTY management, a stopped session means the child process has exited. The PTY master fd should be closed at that point (SIGHUP is sent to the shell automatically when the master is closed). Verify `Cleaner` still triggers PTY cleanup correctly via `Manager.Destroy`.

4. **Orphaned PTY cleanup on startup**: With tmux, `CleanupStaleSocket` and `ttyd.CleanupOrphans` handled stale processes from a previous agentd run. With app-layer management, child processes receive SIGHUP when their PTY master is closed (i.e., when agentd exits). This should be sufficient for normal shutdown. On unclean restart, any surviving child processes will have lost their PTY master and will behave as if disconnected. No explicit cleanup should be needed, but verify with a test.

5. **Context menu suppression**: The `contextmenu` handler in `Terminal.tsx` was added specifically for tmux mouse mode (issue #266). Once tmux is removed, this handler should be removed or changed to allow the browser's native context menu (which enables copy/paste via right-click).

6. **`TmuxSession` field removal**: Coordinate removal of the `tmux_session` field from the hub JSON protocol, gRPC proto, and frontend types. This is a breaking API change and should be versioned or communicated to consuming integrations.

7. **Config migration**: Operators with `tmux.socket_name` and `ttyd.*` in their `config.yaml` should receive deprecation warnings, not errors, for one release cycle. Add `PTYConfig` section with documented defaults.

8. **Tests**: Delete or rewrite all tests in `internal/tmux/tmux_test.go` and `internal/ttyd/ttyd_test.go`. Update E2E tests in `test/e2e/` (ttyd_test.go, session_lifecycle_test.go) to use the new PTY manager. Update `internal/session/monitor_test.go` to use ring buffer snapshots instead of mock CapturePane.

**Dependencies:** Phase 5 verification complete.

---

## Sequencing

```
Phase 1 (Audit)
    │
    ├──► Phase 2 (Design)
    │         │
    │         ▼
    │    Phase 3 (Implement PTY Manager)
    │         │
    │         ▼
    │    Phase 4 (Remove tmux from Session Manager)
    │         │
    │         ▼
    │    Phase 5 (Verify xterm.js UX)
    │         │
    │         ▼
    │    Phase 6 (Edge Cases & Cleanup)
    │
    └──► (Phase 1 and Phase 2 can overlap: audit informs design,
          but initial design can begin while audit is finalized)
```

Phases 3–6 must run sequentially. Phases 1 and 2 can overlap.

---

## Open Questions

1. **WebSocket endpoint ownership**: Should the terminal WebSocket endpoint live inside agentd (preferred) or remain in issues-ui as a proxy to per-session ports? The issues-ui frontend already proxies through `/ws/terminal/<agent>/<session>` — with agentd serving the WS directly, issues-ui would proxy to a single agentd WS endpoint rather than per-process ttyd ports. Is that proxy path acceptable from a network/security standpoint?

2. **PTY library dependency**: Use `github.com/creack/pty` (mature, widely used) or raw `syscall`/`unix` calls? The `creack/pty` library handles platform differences (Linux/macOS) cleanly. Given agentd runs on Linux in production (see `install.sh`), raw syscalls are feasible but `creack/pty` reduces maintenance burden.

3. **Ring buffer size default**: 256 KB captures ~3,200 lines at 80 chars. Is this sufficient for typical agent sessions, or should the default be higher (e.g., 1 MB)? Needs input from operators who run long agent tasks.

4. **Multiple WS connections per session**: Is broadcasting to multiple tabs a required feature for the initial release, or can it be deferred? Supporting a single active connection per session simplifies the implementation significantly.

5. **Daemon restart session persistence (Option B)**: Is there an operator requirement for sessions to survive agentd restarts? If so, fd passing via `SCM_RIGHTS` should be designed into Phase 2 rather than deferred.

6. **`tmux_session` in the hub protocol**: The field is validated as required by the frontend. When and how should it be removed? This should be coordinated as a breaking protocol change with a migration path for consuming hub agents that may inspect the field.

7. **ttyd removal timeline**: Should ttyd support be removed in the same release as tmux, or kept as a disabled/deprecated option for one release? Given that ttyd is only meaningful when tmux is present, removing both together is cleaner.
