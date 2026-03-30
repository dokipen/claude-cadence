/**
 * Regression test for: vim input unresponsive with `set nocompatible`
 *
 * Bug: when vim is launched with `set nocompatible` via the terminal relay
 * path, all keyboard input is silently dropped — vim never responds to
 * keystrokes. Compatible mode (no `set nocompatible`) works fine, pointing to
 * something nocompatible-specific in how vim initialises the terminal.
 *
 * Root cause: the hub relay was writing browser→PTY input frames as
 * websocket.MessageText instead of websocket.MessageBinary. Under some
 * conditions (back-pressure, buffering, framing differences) this caused
 * the agentd side to receive malformed frames that were silently discarded.
 * With `set nocompatible`, vim's terminal handling is stricter, making the
 * failure deterministic.
 *
 * This test requires the full docker-compose QA stack to be running with vim
 * installed in the agentd container. Set QA_URL to the Caddy proxy URL before
 * running (e.g. QA_URL=http://localhost:80 npx playwright test vim-terminal).
 *
 * Skip condition: QA_URL is not set.
 */
import { test, expect } from "@playwright/test";

const QA_URL = process.env.QA_URL?.replace(/\/$/, "");
const QA_AGENT = process.env.QA_AGENT ?? "dev";
const QA_PROFILE = process.env.QA_PROFILE ?? "bash";

// ttyd framing: all frames start with a 1-byte type prefix.
// '0' (0x30) = terminal data; '1' (0x31) = resize JSON.
const FRAME_DATA = 0x30;
const FRAME_RESIZE = 0x31;

/** Encode a terminal input frame: byte '0' + utf-8 payload. */
function inputFrame(text: string): string {
  return String.fromCharCode(FRAME_DATA) + text;
}

/** Encode a resize frame: byte '1' + JSON. */
function resizeFrame(cols: number, rows: number): string {
  return (
    String.fromCharCode(FRAME_RESIZE) +
    JSON.stringify({ columns: cols, rows: rows })
  );
}

/**
 * Create a bash session on the dev agent and return its ID.
 * Uses the REST API proxied through Caddy, which injects the auth header.
 */
async function createBashSession(qaUrl: string): Promise<string> {
  const resp = await fetch(`${qaUrl}/api/v1/agents/${QA_AGENT}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_profile: QA_PROFILE }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Failed to create session: ${resp.status} ${resp.statusText} — ${body}`,
    );
  }
  const data = (await resp.json()) as { session: { id: string } };
  return data.session.id;
}

/**
 * Poll until the session reaches state "running", up to timeoutMs.
 */
async function waitForRunning(
  qaUrl: string,
  sessionId: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetch(
      `${qaUrl}/api/v1/agents/${QA_AGENT}/sessions/${sessionId}`,
    );
    if (resp.ok) {
      const data = (await resp.json()) as { session: { state: string } };
      if (data.session?.state === "running") return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Session ${sessionId} did not reach 'running' within ${timeoutMs}ms`);
}

/**
 * Connect a ttyd WebSocket to the given terminal endpoint and return
 * helpers for sending input and reading accumulated output.
 *
 * The WebSocket is created inside the browser page so Playwright's CDP
 * websocket instrumentation captures it.
 *
 * key allows multiple simultaneous connections on the same page (e.g. for
 * the strict-mode double-connect test). State is stored as window.__<key>WS
 * and window.__<key>Output.
 */
async function connectTerminalWS(
  page: import("@playwright/test").Page,
  wsUrl: string,
  key = "ttyd",
): Promise<{
  send: (text: string) => Promise<void>;
  output: () => string;
  clearOutput: () => Promise<void>;
  waitForOutput: (
    matcher: string | RegExp,
    timeoutMs?: number,
  ) => Promise<string>;
  close: () => Promise<void>;
}> {
  // Inject a thin ttyd WebSocket client into the page.
  // We store shared state on window so the helpers can access it.
  await page.evaluate(
    ({ url, k }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w[`__${k}Output`] = "";
      w[`__${k}WS`] = new WebSocket(url, ["tty"]);
      w[`__${k}WS`].binaryType = "arraybuffer";
      w[`__${k}WS`].addEventListener("message", (ev: MessageEvent) => {
        let bytes: Uint8Array;
        if (ev.data instanceof ArrayBuffer) {
          bytes = new Uint8Array(ev.data);
        } else {
          // Text frame: convert char-by-char
          const s = ev.data as string;
          bytes = new Uint8Array(s.length);
          for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
        }
        // First byte is the ttyd frame type ('0' = data). Skip it.
        if (bytes.length > 1 && bytes[0] === 0x30 /* '0' */) {
          w[`__${k}Output`] += new TextDecoder("utf-8", {
            fatal: false,
          }).decode(bytes.slice(1));
        }
      });
    },
    { url: wsUrl, k: key },
  );

  const send = async (text: string) => {
    await page.evaluate(
      ({ t, k }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws = (window as any)[`__${k}WS`] as WebSocket;
        // Send as a text string, exactly as Terminal.tsx does:
        //   ws.send(CMD_INPUT + data)
        // This reproduces the real browser behaviour and exposes the
        // MessageText relay bug — the hub relays the text frame directly
        // to agentd, which (before the fix) received malformed frames
        // that caused vim nocompatible input to be silently dropped.
        ws.send(t);
      },
      { t: text, k: key },
    );
  };

  const output = () =>
    page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ k }) => (window as any)[`__${k}Output`] as string,
      { k: key },
    ) as unknown as string;

  const clearOutput = async () => {
    await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ k }) => { (window as any)[`__${k}Output`] = ""; },
      { k: key },
    );
  };

  const waitForOutput = async (
    matcher: string | RegExp,
    timeoutMs = 10_000,
  ): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ k }) => (window as any)[`__${k}Output`] as string,
        { k: key },
      );
      if (
        typeof matcher === "string"
          ? current.includes(matcher)
          : matcher.test(current)
      ) {
        return current;
      }
      await page.waitForTimeout(100);
    }
    const current = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ k }) => (window as any)[`__${k}Output`] as string,
      { k: key },
    );
    throw new Error(
      `Timed out waiting for output to match ${matcher}. ` +
        `Last output (${current.length} chars): ${JSON.stringify(current.slice(-500))}`,
    );
  };

  const close = async () => {
    await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ k }) => { (window as any)[`__${k}WS`]?.close(); },
      { k: key },
    );
  };

  return { send, output: output as () => string, clearOutput, waitForOutput, close };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("vim nocompatible input regression", () => {
  test.skip(!QA_URL, "QA_URL not set — requires full docker-compose QA stack");

  test.setTimeout(90_000); // session startup + vim launch + capability negotiation delays

  /**
   * Core regression test.
   *
   * 1. Create a real bash session on the dev agent.
   * 2. Connect a ttyd WebSocket through Caddy.
   * 3. Launch `vim -u NONE --cmd "set nocompatible"`.
   * 4. Wait for vim to render its startup screen.
   * 5. Enter insert mode and type a short string.
   * 6. Assert the string appears in the terminal output.
   *
   * Before the fix (MessageText relay path): vim renders but ignores all
   * input — step 6 fails. After the fix (MessageBinary): input reaches vim
   * and the typed text appears on screen.
   */
  test("vim with set nocompatible receives keyboard input", async ({
    page,
  }) => {
    const sessionId = await createBashSession(QA_URL!);
    console.log(`[vim-test] Created session: ${sessionId}`);

    await waitForRunning(QA_URL!, sessionId);
    console.log(`[vim-test] Session is running`);

    // Navigate to the issues-ui home page so the WebSocket shares the same
    // origin as the Caddy proxy (connect-src 'self' in the CSP allows it).
    await page.goto(`${QA_URL}/`);

    const qaOrigin = new URL(QA_URL!);
    const wsScheme = qaOrigin.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${wsScheme}://${qaOrigin.host}/ws/terminal/${QA_AGENT}/${sessionId}`;
    console.log(`[vim-test] Connecting WebSocket: ${wsUrl}`);

    const term = await connectTerminalWS(page, wsUrl);

    // Give the WebSocket time to open and receive any initial output.
    await page.waitForTimeout(2000);

    // Send an initial resize so the PTY knows the terminal dimensions.
    await term.send(resizeFrame(220, 50));
    await page.waitForTimeout(500);

    // Clear output before launching vim so the ring buffer replay (which may
    // contain \x1b[?1049h from a previous session) doesn't trigger a false
    // "vim started" detection.
    await term.clearOutput();

    // Launch vim with nocompatible mode.
    await term.send(inputFrame("vim -u NONE --cmd 'set nocompatible'\r"));

    // Wait for vim to fully own the terminal: \x1b[?1049h switches to the
    // alternate screen buffer and is only sent once vim has initialised and
    // disabled the PTY's echo mode.
    console.log(`[vim-test] Waiting for vim to take over terminal...`);
    await term.waitForOutput("\x1b[?1049h", 20_000);
    // Give vim time to complete terminal capability negotiation (cursor position
    // queries, terminfo reads). With nocompatible, vim does more negotiation than
    // compatible mode, and sending input too early causes it to be dropped.
    await page.waitForTimeout(2000);
    console.log(`[vim-test] Vim started`);

    // Write a file from vim to prove it received our keystrokes end-to-end.
    // This is immune to false positives from PTY echo or ring buffer replay:
    // the file can only exist if vim received 'i', the content, ESC, and :wq.
    const tmpFile = `/tmp/vimtest_nocompat_${sessionId}`;
    console.log(`[vim-test] Writing file via vim: ${tmpFile}`);

    // Enter insert mode, type content, ESC, write and quit.
    await term.send(inputFrame(`i`));
    console.log(`[vim-test] Waiting for -- INSERT -- mode indicator...`);
    await term.waitForOutput("-- INSERT --", 5_000);
    console.log(`[vim-test] vim entered insert mode`);

    await term.send(inputFrame(`VIMTEST_NOCOMPAT_OK\x1b:w ${tmpFile}\r:q!\r`));

    // Wait for vim to exit (alternate screen is restored: \x1b[?1049l).
    await term.clearOutput();
    await term.waitForOutput("\x1b[?1049l", 8_000);
    console.log(`[vim-test] vim exited`);

    // Back at shell — check the file was created.
    await term.clearOutput();
    await term.send(inputFrame(`cat ${tmpFile}\r`));
    const shellOut = await term.waitForOutput("VIMTEST_NOCOMPAT_OK", 5_000);
    console.log(`[vim-test] File contents: ${JSON.stringify(shellOut.slice(0, 200))}`);

    expect(shellOut).toContain("VIMTEST_NOCOMPAT_OK");

    await term.close();
    await fetch(`${QA_URL}/api/v1/agents/${QA_AGENT}/sessions/${sessionId}`, {
      method: "DELETE",
    });
  });

  /**
   * Sanity check: vim WITHOUT nocompatible mode must also receive input.
   * This establishes a baseline — if this test also fails, the problem is
   * not specific to nocompatible mode.
   */
  test("vim without nocompatible receives keyboard input (baseline)", async ({
    page,
  }) => {
    const sessionId = await createBashSession(QA_URL!);
    await waitForRunning(QA_URL!, sessionId);
    await page.goto(`${QA_URL}/`);

    const qaOrigin = new URL(QA_URL!);
    const wsScheme = qaOrigin.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${wsScheme}://${qaOrigin.host}/ws/terminal/${QA_AGENT}/${sessionId}`;
    const term = await connectTerminalWS(page, wsUrl);

    await page.waitForTimeout(2000);
    await term.send(resizeFrame(220, 50));
    await page.waitForTimeout(500);

    // Clear before launching so ring buffer replay doesn't fool the detector.
    await term.clearOutput();

    // Launch vim in compatible mode (default, no nocompatible).
    await term.send(inputFrame("vim -u NONE\r"));

    await term.waitForOutput("\x1b[?1049h", 20_000);
    await page.waitForTimeout(2000);

    await term.clearOutput();

    // Compatible mode vim does not display "-- INSERT --", so we use the same
    // file-write approach: if the file exists with the right content, vim
    // received and processed the keystrokes.
    const tmpFile = `/tmp/vimtest_compat_${sessionId}`;
    await term.send(inputFrame(`iVIMTEST_COMPAT_OK\x1b:w ${tmpFile}\r:q!\r`));

    await term.clearOutput();
    await term.waitForOutput("\x1b[?1049l", 8_000);

    await term.clearOutput();
    await term.send(inputFrame(`cat ${tmpFile}\r`));
    const shellOut = await term.waitForOutput("VIMTEST_COMPAT_OK", 5_000);
    console.log(
      `[vim-test] Compatible baseline file contents: ${JSON.stringify(shellOut.slice(0, 200))}`,
    );

    expect(shellOut).toContain("VIMTEST_COMPAT_OK");

    await term.close();
    await fetch(`${QA_URL}/api/v1/agents/${QA_AGENT}/sessions/${sessionId}`, {
      method: "DELETE",
    });
  });

  /**
   * Core regression test for the nil-writers window introduced by PR #670.
   *
   * When a terminal relay is already running for a session (relay#1, established
   * by WS1) and a second browser WebSocket opens for the same session (WS2),
   * RegisterRelaySession calls oldCancel() to tear down relay#1. This
   * immediately cancels relay#1's context:
   *
   *   WS1 open → relay#1 starts → ServeTerminal#1 registers wf1
   *   vim launched and running on relay#1
   *   WS2 opens → RegisterRelaySession → oldCancel() → relay#1 ctx cancelled
   *              → ServeTerminal#1 exits → sess.writers = nil
   *              → nil-writers window before ServeTerminal#2 registers wf2
   *
   * During the nil-writers window all PTY output (vim screen updates, cursor
   * movement) goes only to the ring buffer — never to WS2's browser. The
   * window lasts until relay#2's loopback server is up and ServeTerminal#2
   * registers its writer, typically 3-10ms. In practice relay#1 can remain
   * running for arbitrarily long (e.g. if the first browser WS closed without
   * cancelling the agentd-side relay), meaning any reconnect fires oldCancel
   * and reproduces the freeze.
   *
   * The fix removes oldCancel(): relay#1 self-terminates via the writerGen
   * generation check once ServeTerminal#2 atomically replaces the writers
   * entry, eliminating the nil-writers gap.
   *
   * Reproduction: pre-launch vim on WS1, let WS1 close (relay#1 stays alive
   * on agentd), then open WS2 — triggering oldCancel and the nil-writers
   * window while vim is actively running. Verify that vim responds to input
   * on WS2 after the relay settles.
   */
  test("vim nocompatible stays responsive when relay reconnects mid-session", async ({
    page,
  }) => {
    const sessionId = await createBashSession(QA_URL!);
    console.log(`[vim-relay] Created session: ${sessionId}`);
    await waitForRunning(QA_URL!, sessionId);
    await page.goto(`${QA_URL}/`);

    const qaOrigin = new URL(QA_URL!);
    const wsScheme = qaOrigin.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${wsScheme}://${qaOrigin.host}/ws/terminal/${QA_AGENT}/${sessionId}`;

    // WS1 (bootstrap): launch vim so the agentd relay#1 is established with
    // vim actively running. Closing WS1 removes the hub-side channel but does
    // NOT cancel relay#1 on the agentd side — relay#1 keeps running.
    console.log(`[vim-relay] Opening WS1 (bootstrap) and launching vim`);
    const ws1 = await connectTerminalWS(page, wsUrl, "ws1");
    await page.waitForTimeout(500);
    await ws1.send(resizeFrame(220, 50));
    await page.waitForTimeout(200);
    await ws1.clearOutput();
    await ws1.send(inputFrame("vim -u NONE --cmd 'set nocompatible'\r"));
    await ws1.waitForOutput("\x1b[?1049h", 20_000);
    await page.waitForTimeout(500);
    console.log(`[vim-relay] Vim started on WS1; closing WS1 (relay#1 stays alive on agentd)`);
    await ws1.close();
    // Give relay#1 a moment to notice the hub-side channel is gone but keep running.
    await page.waitForTimeout(300);

    // WS2: reconnect to the same session while relay#1 is still alive on agentd.
    // With the bug (oldCancel present): RegisterRelaySession cancels relay#1 →
    // ServeTerminal#1 exits → writers=nil → nil-writers window until
    // ServeTerminal#2 starts. Vim output during the window is lost to the ring
    // buffer only, and if vim's terminal state is mid-update, the session can
    // appear permanently frozen.
    // With the fix (no oldCancel): relay#1 self-terminates cleanly; no window.
    console.log(`[vim-relay] Opening WS2 (triggers oldCancel on unfixed prod)`);
    const ws2 = await connectTerminalWS(page, wsUrl, "ws2");

    // Wait for relay#2 to fully settle (ServeTerminal#2 registered, ring buffer
    // replayed). On an unfixed build this is the period where writers=nil.
    await page.waitForTimeout(2000);
    await ws2.send(resizeFrame(220, 50));
    await page.waitForTimeout(500);

    console.log(`[vim-relay] Sending 'i' to enter insert mode on WS2`);
    await ws2.send(inputFrame("i"));
    await ws2.waitForOutput("-- INSERT --", 8_000);
    console.log(`[vim-relay] Vim entered insert mode`);

    const tmpFile = `/tmp/vimtest_relay_${sessionId}`;
    await ws2.send(inputFrame(`VIMTEST_RELAY_OK\x1b:w ${tmpFile}\r:q!\r`));

    await ws2.clearOutput();
    await ws2.waitForOutput("\x1b[?1049l", 8_000);
    console.log(`[vim-relay] Vim exited`);

    await ws2.clearOutput();
    await ws2.send(inputFrame(`cat ${tmpFile}\r`));
    const shellOut = await ws2.waitForOutput("VIMTEST_RELAY_OK", 5_000);
    console.log(
      `[vim-relay] File contents: ${JSON.stringify(shellOut.slice(0, 200))}`,
    );

    expect(shellOut).toContain("VIMTEST_RELAY_OK");

    await ws2.close();
    await fetch(`${QA_URL}/api/v1/agents/${QA_AGENT}/sessions/${sessionId}`, {
      method: "DELETE",
    });
  });

  /**
   * End-to-end UI regression test for the nil-writers window introduced by PR #670.
   *
   * This test FAILS on unfixed code (oldCancel present in RegisterRelaySession) and
   * PASSES on the fix (oldCancel removed, PR #675).
   *
   * Reproduction mechanism (requires the full browser + xterm.js):
   *   1. vim is pre-launched via a bootstrap raw WS before the UI connects
   *   2. The test navigates to the agents page and hovers + clicks the session item:
   *        hover  → mouseenter  → SessionOutputTooltip mounts    → tooltip WS  → relay#0
   *        click  → terminal mounts                               → WS1         → relay#1
   *        strict → React strict-mode unmount/remount             → WS2         → relay#2
   *   3. On unfixed code, relay#1 calls oldCancel(relay#0) and relay#2 calls
   *      oldCancel(relay#1). Each cancellation tears down the previous ServeTerminal
   *      before the new one registers its writer → multiple nil-writers windows.
   *   4. During each window, PTY output goes to the ring buffer only. Each new relay
   *      replays the entire ring buffer to xterm.js, which responds to the terminal
   *      capability queries (t_RV/DA2, t_u7/cursor-position) found in the replay.
   *      These out-of-sequence responses arrive at vim while it is in normal mode
   *      (no longer expecting them), causing vim to misinterpret them as user input
   *      and permanently freeze.
   *
   * On the fix (no oldCancel):
   *   relay#0, relay#1, relay#2 run concurrently. writerGen atomically transfers
   *   sess.writers without a nil gap. The final relay replays the ring buffer once;
   *   xterm.js receives one coherent replay and vim remains fully responsive.
   *
   * The test intercepts WebSocket frames via Playwright's page.on("websocket")
   * to read terminal output without depending on xterm.js's canvas rendering.
   * Keyboard input is sent via the xterm.js hidden textarea exactly as a real
   * user would type.
   */
  test("vim nocompatible receives keyboard input via React UI (xterm.js)", async ({
    page,
  }) => {
    const sessionId = await createBashSession(QA_URL!);
    console.log(`[vim-ui] Created session: ${sessionId}`);
    await waitForRunning(QA_URL!, sessionId);
    console.log(`[vim-ui] Session running`);

    // Pre-launch vim via raw WebSocket so the PTY is in vim's alternate-screen
    // mode when the React UI connects. This means the React strict-mode
    // double-connect fires while vim is already running — the exact condition
    // that triggers the nil-writers window.
    {
      await page.goto(`${QA_URL}/`);
      const qaOrigin = new URL(QA_URL!);
      const wsScheme = qaOrigin.protocol === "https:" ? "wss" : "ws";
      const wsUrl = `${wsScheme}://${qaOrigin.host}/ws/terminal/${QA_AGENT}/${sessionId}`;
      const bootstrap = await connectTerminalWS(page, wsUrl, "bootstrap");
      await page.waitForTimeout(1000);
      await bootstrap.send(resizeFrame(220, 50));
      await page.waitForTimeout(200);
      await bootstrap.clearOutput();
      await bootstrap.send(inputFrame("vim -u NONE --cmd 'set nocompatible'\r"));
      console.log(`[vim-ui] Waiting for vim to start in bootstrap connection...`);
      await bootstrap.waitForOutput("\x1b[?1049h", 20_000);
      await page.waitForTimeout(500); // let vim finish initialization
      console.log(`[vim-ui] Vim started; closing bootstrap connection`);
      await bootstrap.close();
      // Give the relay a moment to settle after the bootstrap WS closes.
      await page.waitForTimeout(500);
    }

    // Accumulate terminal output from all WebSocket connections for this session.
    // React strict mode creates two connections — we capture output from both.
    let termOutput = "";
    const clearTerm = () => { termOutput = ""; };
    const waitForTerm = async (
      matcher: string | RegExp,
      timeoutMs = 20_000,
    ): Promise<string> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (
          typeof matcher === "string"
            ? termOutput.includes(matcher)
            : matcher.test(termOutput)
        ) {
          return termOutput;
        }
        await page.waitForTimeout(100);
      }
      throw new Error(
        `Timed out waiting for ${String(matcher)}.\n` +
          `Last output (${termOutput.length} chars): ${JSON.stringify(termOutput.slice(-500))}`,
      );
    };

    // Set up WebSocket interception BEFORE navigating.
    let totalFrames = 0;
    page.on("websocket", (ws) => {
      if (!ws.url().includes(`/ws/terminal/${QA_AGENT}/${sessionId}`)) return;
      console.log(`[vim-ui] WS opened: ${ws.url()}`);
      ws.on("framereceived", (frame) => {
        totalFrames++;
        try {
          let buf: Buffer;
          if (typeof frame.payload === "string") {
            buf = Buffer.from(frame.payload, "binary");
          } else {
            buf = Buffer.from(frame.payload as ArrayBuffer);
          }
          // TTY server→client frame: byte 0x30 ('0') + terminal data
          if (buf.length > 1 && buf[0] === FRAME_DATA) {
            termOutput += buf.slice(1).toString("utf-8");
          } else if (buf.length > 0) {
            console.log(`[vim-ui] Non-data frame: len=${buf.length} first=0x${buf[0].toString(16)}`);
          }
        } catch {
          // ignore decode errors
        }
      });
      ws.on("close", () => {
        console.log(`[vim-ui] WS closed: ${ws.url()}`);
      });
    });

    // Navigate to the agents page. React strict mode will mount Terminal twice
    // in development, creating two rapid WebSocket connections — the scenario
    // that triggers the nil-writers window when oldCancel() is present.
    await page.goto(`${QA_URL}/agents`);
    await page.waitForSelector('[data-testid="agent-manager"]', {
      timeout: 15_000,
    });

    // Click the session in the sidebar to open the terminal.
    //
    // Use the real Playwright .click() (which simulates mouse movement + hover)
    // to deliberately trigger the mouseenter → SessionOutputTooltip flow:
    //   hover  → SessionOutputTooltip mounts  → tooltip WS opens  → relay#0
    //   click  → terminal mounts               → WS1 opens         → relay#1
    //   strict → terminal unmounts/remounts    → WS1 closes/WS2    → relay#2
    //
    // With the bug (oldCancel present in RegisterRelaySession):
    //   relay#1 fires oldCancel(relay#0) → nil-writers window
    //   relay#2 fires oldCancel(relay#1) → another nil-writers window
    //   Each window causes the ring buffer to accumulate output that was
    //   never delivered live; xterm.js receives the replay and sends terminal
    //   capability responses that arrive at vim out-of-sequence, freezing it.
    //
    // With the fix (oldCancel removed):
    //   relay#0, relay#1, relay#2 start concurrently; writerGen atomically
    //   transfers writers from relay#0→#1→#2 without a nil window.
    //   The final relay's ServeTerminal replays the ring buffer once; xterm.js
    //   gets a single coherent replay and vim remains responsive.
    const sessionBtn = page.locator(`[data-session-id="${sessionId}"]`);
    await sessionBtn.waitFor({ timeout: 15_000 });
    await sessionBtn.click();
    console.log(`[vim-ui] Clicked session in sidebar (hover triggers tooltip WS → relay race)`);

    // Wait for the terminal container to appear and the overlay to clear.
    await page.waitForSelector('[data-testid="terminal-container"]', {
      timeout: 15_000,
    });
    // Wait for the "connecting" overlay to disappear — terminal is live.
    await page.waitForSelector('[data-testid="terminal-connecting"]', {
      state: "hidden",
      timeout: 20_000,
    });
    console.log(`[vim-ui] Terminal connected`);

    // Give xterm.js a moment to fully initialise and let vim capability
    // negotiation complete before sending input.
    await page.waitForTimeout(2000);

    // Focus the xterm.js hidden textarea inside the terminal tile.
    // Use the terminal-container testid to avoid matching the read-only preview
    // textarea in the session output tooltip.
    const xtermTextarea = page.locator(
      '[data-testid="terminal-container"] .xterm-helper-textarea',
    );
    await xtermTextarea.focus();

    console.log(`[vim-ui] Ring buffer frames received so far: ${totalFrames}, output: ${termOutput.length} chars`);
    const baselineLen = termOutput.length;
    console.log(`[vim-ui] Vim already running; entering insert mode`);

    // Enter insert mode. Don't clearTerm - check if ANY new output arrives.
    await page.keyboard.press("i");
    console.log(`[vim-ui] Pressed i, waiting for any output change...`);
    // Wait up to 5 seconds to see if output grows at all
    let attempts = 0;
    while (termOutput.length === baselineLen && attempts < 50) {
      await page.waitForTimeout(100);
      attempts++;
    }
    console.log(`[vim-ui] After pressing i: totalLen=${termOutput.length} baseline=${baselineLen} new=${termOutput.length - baselineLen} chars`);
    // Now wait for INSERT mode indicator
    await waitForTerm("-- INSERT --", 8_000);
    console.log(`[vim-ui] Vim entered insert mode`);

    // Write file content, then save and quit.
    // Clear output BEFORE typing the save/quit sequence so the exit escape
    // sequence (\x1b[?1049l) is captured in the clean output buffer — not
    // cleared by a subsequent clearTerm() call before we can wait for it.
    const tmpFile = `/tmp/vimtest_ui_${sessionId}`;
    clearTerm();
    await page.keyboard.type("VIMTEST_UI_OK", { delay: 30 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.keyboard.type(`:w ${tmpFile}\r`, { delay: 30 });
    await page.keyboard.type(`:q!\r`, { delay: 30 });

    // Wait for vim to exit (alternate screen restore).
    await waitForTerm("\x1b[?1049l", 8_000);
    console.log(`[vim-ui] Vim exited`);

    // Verify the file was written by reading it back through the terminal.
    clearTerm();
    await page.keyboard.type(`cat ${tmpFile}\r`, { delay: 30 });
    const out = await waitForTerm("VIMTEST_UI_OK", 5_000);
    console.log(
      `[vim-ui] File contents: ${JSON.stringify(out.slice(0, 200))}`,
    );
    expect(out).toContain("VIMTEST_UI_OK");

    await fetch(`${QA_URL}/api/v1/agents/${QA_AGENT}/sessions/${sessionId}`, {
      method: "DELETE",
    });
  });
});
