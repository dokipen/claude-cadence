# Plan: Remove tmux from Web Terminal — App-Layer PTY Session Management

**Issue:** #276
**Status:** Planning
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

**Deliverable:** Updated section in this document or a separate audit table committed alongside code changes.

**Dependencies:** None — can be done in parallel with Phase 2 design.

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
