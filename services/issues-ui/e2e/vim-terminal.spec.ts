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
        // Send as binary ArrayBuffer so the hub relay receives MessageBinary.
        const encoded = new TextEncoder().encode(t);
        ws.send(encoded.buffer);
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

  test.setTimeout(60_000); // session startup + vim launch can be slow

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
    await page.waitForTimeout(1000);

    // Send an initial resize so the PTY knows the terminal dimensions.
    await term.send(resizeFrame(220, 50));
    await page.waitForTimeout(200);

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
    // Give vim a moment to finish drawing its initial screen.
    await page.waitForTimeout(300);
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

    await page.waitForTimeout(1000);
    await term.send(resizeFrame(220, 50));
    await page.waitForTimeout(200);

    // Clear before launching so ring buffer replay doesn't fool the detector.
    await term.clearOutput();

    // Launch vim in compatible mode (default, no nocompatible).
    await term.send(inputFrame("vim -u NONE\r"));

    await term.waitForOutput("\x1b[?1049h", 20_000);
    await page.waitForTimeout(300);

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
   * Regression test for the nil-writers window introduced by PR #670.
   *
   * React strict mode mounts every component twice in development. On the
   * terminal page this produces two rapid WebSocket connections to the same
   * session:
   *
   *   mount#1  → WS1 opens → hub creates relay#1 → ServeTerminal#1 registers wf1
   *   unmount#1 (strict-mode) — WS1 stays open briefly
   *   mount#2  → WS2 opens → hub creates relay#2 → RegisterRelaySession calls
   *              oldCancel(), immediately cancelling relay#1's context
   *              → ServeTerminal#1 exits, setting sess.writers = nil
   *              → before ServeTerminal#2 registers wf2: nil-writers window
   *
   * During the nil-writers window all PTY output goes to the ring buffer but
   * never reaches the browser. vim is alive and accepting input, but the
   * browser sees nothing — appearing completely unresponsive.
   *
   * The fix (aa6c83a) removes oldCancel() so relay#1 self-terminates via the
   * writerGen generation check instead, eliminating the gap.
   *
   * This test reproduces the scenario: open WS1, wait for relay#1 to settle,
   * open WS2 simultaneously (while WS1 is still open), close WS1 a moment
   * later, then verify vim nocompatible receives input on WS2.
   */
  test("vim nocompatible receives input after strict-mode double-connect", async ({
    page,
  }) => {
    const sessionId = await createBashSession(QA_URL!);
    console.log(`[vim-reconnect] Created session: ${sessionId}`);
    await waitForRunning(QA_URL!, sessionId);
    await page.goto(`${QA_URL}/`);

    const qaOrigin = new URL(QA_URL!);
    const wsScheme = qaOrigin.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${wsScheme}://${qaOrigin.host}/ws/terminal/${QA_AGENT}/${sessionId}`;

    // WS1 — first mount (React strict-mode: opens but is replaced immediately).
    console.log(`[vim-reconnect] Opening WS1 (first/discarded connection)`);
    const term1 = await connectTerminalWS(page, wsUrl, "ttyd1");

    // Let relay#1 settle: ServeTerminal#1 must have registered its writer before
    // WS2 opens, otherwise WS2 arrives before the relay is established and the
    // double-connect scenario doesn't apply.
    await page.waitForTimeout(300);

    // WS2 — second mount (the real connection, while WS1 is still open).
    // This is the moment that triggers the nil-writers bug: RegisterRelaySession
    // sees an existing relay and (before the fix) calls oldCancel(), cancelling
    // relay#1's context before relay#2 has registered its writer.
    console.log(`[vim-reconnect] Opening WS2 (second/live connection) while WS1 still open`);
    const term2 = await connectTerminalWS(page, wsUrl, "ttyd2");

    // Close WS1 shortly after — simulating React's strict-mode first-mount cleanup.
    await page.waitForTimeout(50);
    await term1.close();
    console.log(`[vim-reconnect] WS1 closed`);

    // Let WS2's relay settle and replay the ring buffer.
    await page.waitForTimeout(1000);

    await term2.send(resizeFrame(220, 50));
    await page.waitForTimeout(200);

    // Clear WS2 output before vim launch — ring buffer may contain stale escape
    // sequences from prior sessions.
    await term2.clearOutput();

    console.log(`[vim-reconnect] Launching vim nocompatible on WS2`);
    await term2.send(inputFrame("vim -u NONE --cmd 'set nocompatible'\r"));
    await term2.waitForOutput("\x1b[?1049h", 20_000);
    await page.waitForTimeout(300);
    console.log(`[vim-reconnect] Vim started on WS2`);

    await term2.send(inputFrame(`i`));
    await term2.waitForOutput("-- INSERT --", 5_000);
    console.log(`[vim-reconnect] Vim entered insert mode`);

    const tmpFile = `/tmp/vimtest_reconnect_${sessionId}`;
    await term2.send(
      inputFrame(`VIMTEST_RECONNECT_OK\x1b:w ${tmpFile}\r:q!\r`),
    );

    await term2.clearOutput();
    await term2.waitForOutput("\x1b[?1049l", 8_000);
    console.log(`[vim-reconnect] Vim exited`);

    await term2.clearOutput();
    await term2.send(inputFrame(`cat ${tmpFile}\r`));
    const shellOut = await term2.waitForOutput("VIMTEST_RECONNECT_OK", 5_000);
    console.log(
      `[vim-reconnect] File contents: ${JSON.stringify(shellOut.slice(0, 200))}`,
    );

    expect(shellOut).toContain("VIMTEST_RECONNECT_OK");

    await term2.close();
    await fetch(`${QA_URL}/api/v1/agents/${QA_AGENT}/sessions/${sessionId}`, {
      method: "DELETE",
    });
  });
});
