# Runbook: `mac` agentd missing / "dead" in the dashboard

**Symptom:** the `mac` host is missing from "available hosts" in the claude-cadence
dashboard, or it blinks in and out.

**Key fact:** agentd on `mac` talks to the hub over an **outbound** WebSocket — it
dials the hub, the hub never dials agentd (see
[`skills/agent-service/SKILL.md`](../../skills/agent-service/SKILL.md), "host loopback
only"). So "mac is gone" almost never means the process crashed. It usually means the
**registration with the hub is broken** while the process is still alive.

There are three distinct failure modes. Triage tells you which one you have — **the fix
differs**, and for one of them restarting does **not** help.

---

## Reference facts

| Thing | Value |
|---|---|
| launchd label | `com.cadence.agentd` |
| Binary | `/Users/bob/bin/agentd` |
| Config | `~/.config/agentd/config.yaml` (operator-managed — do **not** read programmatically; it triggers macOS popups) |
| Log | `/Users/bob/lib/agentd/agentd.log` |
| Hub | `cadence.whatisbackdoor.com` → `192.168.86.28` (`bootsy.lan`), `:443` |
| Terminal listener | `:8001` on the LAN IP (`advertise_address`) — LAN-bound by design, **not** localhost |

---

## Step 1 — Triage (always run this first)

```bash
# Is the process alive and managed by launchd?
pgrep -lf '/Users/bob/bin/agentd'
launchctl list | grep -i cadence

# What does the hub actually think? (authoritative for the dashboard)
curl -s -m 8 https://cadence.whatisbackdoor.com/api/v1/agents \
  | jq -r '.agents[] | "\(.name)  status=\(.status)  last_seen=\(.last_seen)"'

# What is agentd's own recent history?
tail -30 /Users/bob/lib/agentd/agentd.log
```

Now match what you see to one of the three modes below.

---

## Mode A — Process is dead / launchd not running it

**Signature:**
- `pgrep` returns nothing, **or** `launchctl list | grep cadence` shows no
  `com.cadence.agentd` line (or a non-zero exit status in the middle column).

**Fix:**
```bash
launchctl kickstart -k gui/$(id -u)/com.cadence.agentd
```
If it immediately dies again, read the tail of the log for a startup/config error and
escalate to the operator (config is operator-managed).

---

## Mode B — Zombie / stale WebSocket (process up, hub doesn't list mac)

**Signature:**
- `pgrep` shows a live agentd PID.
- The hub agents list does **not** include `mac` (only `bootsy`, etc.).
- agentd holds a TCP socket to the hub but its log shows **no recent**
  `reconnecting to hub` / `connected to hub` activity — it has believed it was
  "connected" for hours or days.

```bash
# Confirm: socket open at the OS level, but app-level registration is dead
lsof -nP -a -p "$(pgrep -f '/Users/bob/bin/agentd')" -iTCP -sTCP:ESTABLISHED | grep ':443'
```

**Cause:** the hub on bootsy was restarted (wipes its in-memory agent registry), but
mac's TCP socket stayed half-open, so agentd never noticed and never re-registered.

**Fix:** restart agentd to force a fresh handshake.
```bash
launchctl kickstart -k gui/$(id -u)/com.cadence.agentd
```

**Verify:**
```bash
# Expect a fresh "connected to hub" line, then mac appears online
tail -6 /Users/bob/lib/agentd/agentd.log
curl -s -m 8 https://cadence.whatisbackdoor.com/api/v1/agents \
  | jq -r '.agents[] | "\(.name)  status=\(.status)"'
```

> Restarting drops any sessions whose processes are already dead (logged as
> `auto-destroying session: process no longer alive`) — that's cleanup, not lost work.
> But it **will** interrupt genuinely live sessions, so check the session list first if
> work is in flight.

---

## Mode C — Frame-too-big flapping (mac blinks online/offline)

**Signature:**
- The hub list shows `mac` intermittently — online one moment, gone the next.
- `last_seen` for `mac` stops advancing for ~30s, then the host drops and returns.
- The log shows a repeating cycle, possibly dozens of times:
  ```
  WARN hub connection failed: received close frame:
       status = StatusMessageTooBig, reason = "..."
  INFO reconnecting to hub
  INFO connected to hub
  ```
- The trigger is often **user-visible**: hovering a session in the sidebar, or opening
  a terminal panel for a long-lived session, knocks the host offline.
- `GET /api/v1/agents/mac/sessions` may return `{"error":"agent offline"}` if you query
  during a down-swing.

```bash
# How pervasive is it?
grep -c "StatusMessageTooBig" /Users/bob/lib/agentd/agentd.log
```

**Cause:** a single WebSocket message from agentd exceeded the hub's read limit on the
agent connection, and the hub (or the websocket library) responded by closing the
**whole** connection — taking every relayed terminal with it and marking the host
offline. agentd reconnects, the same message is sent again, and the cycle repeats.

Two concrete instances were found (both fixed in **#685**):

1. **Relay snapshot replay, 17 bytes over.** Hovering/opening a session replays the
   session's PTY ring buffer through the relay. A full buffer (`1 MiB − 1`) plus the
   ttyd prefix (1) plus the relay header (17) is 1,048,593 bytes — but the hub's read
   limit was exactly 1,048,576. Any session with ≥1 MiB of scrollback (every
   long-running Claude TUI session gets there within minutes) was a "poison" session:
   hovering it dropped the host. This is what caused the 2026-08-23 outage
   (`discuss-47`).
2. **Oversized `listSessions` reply** (#677 / PR #785). `prompt_context` for many TUI
   sessions blew past the hub's 64 KiB RPC frame check, which closed the connection.

> The earlier theory in this runbook — a persisted session record pushed to the hub on
> connect — was wrong. The ~8s-after-connect close was the UI reopening the terminal
> relay (and replaying the snapshot) after each reconnect.

**Post-#685 state:** the hub no longer closes the agent connection or marks an agent
offline because of message size; the only limit left is a 16 MiB bug backstop
(`services/shared/relay.AgentMaxMessageSize`), the hub advertises that limit to agentd
in the `register` response, agentd refuses to send RPC replies over the negotiated
limit (degrading `prompt_context` first), and `listSessions` is metadata-only. If Mode C
recurs after #685 is deployed on **both** hosts, it is a new bug — collect the log line
with the frame size and escalate.

**If you are on a pre-#685 build — mitigation:**

- A plain `kickstart` restart alone does NOT help while the poison session is still
  live — agentd restores it and the next hover/terminal-open replays the same frame.
- The hub session API is unreachable during a down-swing, so you may not be able to
  destroy the session through the hub. If you can catch an up-swing,
  `DELETE /api/v1/agents/mac/sessions/<id>` works.

Otherwise clear it locally:
1. Kill the offending session's live process so agentd will treat it as dead:
   ```bash
   # find session processes (children of agentd)
   pgrep -P "$(pgrep -f '/Users/bob/bin/agentd')"
   kill <session-pid>
   ```
2. Restart agentd. On startup it restores persisted sessions and **auto-destroys any
   whose process is no longer alive**:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.cadence.agentd
   ```
   Expect log lines: `restored persisted sessions` → `auto-destroying session: process
   no longer alive` → `connected to hub`.
3. Verify no renewed flapping and that mac stays registered:
   ```bash
   grep -c "StatusMessageTooBig" /Users/bob/lib/agentd/agentd.log   # watch it stop climbing
   curl -s -m 8 https://cadence.whatisbackdoor.com/api/v1/agents \
     | jq -r '.agents[] | "\(.name)  status=\(.status)"'
   ```
4. Deploy the #685 builds of **both** `agent-hub` (bootsy) and `agentd` (mac). The
   relay fix is hub-side only, so deploying the hub alone stops the hover-triggered
   drops; the agentd half adds the negotiated limit and sender-side degrade.

---

## Decision tree (quick reference)

```
mac missing from dashboard?
├─ No agentd process / not in launchctl ............... Mode A → kickstart
├─ Process up, hub omits mac, log quiet (stale) ....... Mode B → kickstart
└─ Log shows StatusMessageTooBig closes, mac blinks .... Mode C → DO NOT just restart;
                                                                  clear session / code fix
```

## Escalation

- Config errors on startup, or repeated Mode C → owner of `services/agent-hub` / the
  agentd daemon.
- `~/.config/agentd/config.yaml` is operator-managed; agents must not read it.
