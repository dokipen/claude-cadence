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
  const resp = await fetch(`${qaUrl}/api/v1/agents/dev/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: "bash" }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Failed to create session: ${resp.status} ${resp.statusText} — ${body}`,
    );
  }
  const data = (await resp.json()) as { id: string };
  return data.id;
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
      `${qaUrl}/api/v1/agents/dev/sessions/${sessionId}`,
    );
    if (resp.ok) {
      const data = (await resp.json()) as { state: string };
      if (data.state === "running") return;
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
 */
async function connectTerminalWS(
  page: import("@playwright/test").Page,
  wsUrl: string,
): Promise<{
  send: (text: string) => Promise<void>;
  output: () => string;
  waitForOutput: (
    matcher: string | RegExp,
    timeoutMs?: number,
  ) => Promise<string>;
  close: () => Promise<void>;
}> {
  // Inject a thin ttyd WebSocket client into the page.
  // We store shared state on window so the helpers can access it.
  await page.evaluate(
    ({ url }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__ttydOutput = "";
      w.__ttydWS = new WebSocket(url, ["tty"]);
      w.__ttydWS.binaryType = "arraybuffer";
      w.__ttydWS.addEventListener("message", (ev: MessageEvent) => {
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
          w.__ttydOutput += new TextDecoder("utf-8", {
            fatal: false,
          }).decode(bytes.slice(1));
        }
      });
    },
    { url: wsUrl },
  );

  const send = async (text: string) => {
    await page.evaluate(
      ({ t }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws = (window as any).__ttydWS as WebSocket;
        // Send as binary ArrayBuffer so the hub relay receives MessageBinary.
        const encoded = new TextEncoder().encode(t);
        ws.send(encoded.buffer);
      },
      { t: text },
    );
  };

  const output = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__ttydOutput as string;
    }) as unknown as string;

  const waitForOutput = async (
    matcher: string | RegExp,
    timeoutMs = 10_000,
  ): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__ttydOutput as string,
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
      () => (window as any).__ttydOutput as string,
    );
    throw new Error(
      `Timed out waiting for output to match ${matcher}. ` +
        `Last output (${current.length} chars): ${JSON.stringify(current.slice(-500))}`,
    );
  };

  const close = async () => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__ttydWS?.close();
    });
  };

  return { send, output: output as () => string, waitForOutput, close };
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

    // Navigate to about:blank so we have a real page context for WebSocket.
    await page.goto("about:blank");

    const wsHost = new URL(QA_URL!).host;
    const wsUrl = `ws://${wsHost}/ws/terminal/dev/${sessionId}`;
    console.log(`[vim-test] Connecting WebSocket: ${wsUrl}`);

    const term = await connectTerminalWS(page, wsUrl);

    // Give the WebSocket time to open and receive any initial output.
    await page.waitForTimeout(1000);

    // Send an initial resize so the PTY knows the terminal dimensions.
    await term.send(resizeFrame(220, 50));
    await page.waitForTimeout(200);

    // Launch vim with nocompatible mode.
    await term.send(inputFrame("vim -u NONE --cmd 'set nocompatible'\r"));

    // Wait for vim to start. The startup screen always contains "VIM" in the
    // splash text or "~" empty-line tildes in the buffer area.
    console.log(`[vim-test] Waiting for vim startup screen...`);
    await term.waitForOutput(/~|\x1b\[/, 20_000);
    console.log(`[vim-test] Vim started`);

    // Clear accumulated output so we can check only the response to our input.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__ttydOutput = "";
    });

    // Enter insert mode and type a unique marker string.
    const marker = "VIMTEST_NOCOMPAT_OK";
    await term.send(inputFrame("i" + marker));
    await page.waitForTimeout(500);

    // Assert the marker appears in terminal output. If vim is unresponsive
    // (the bug), it will never echo the typed characters and this fails.
    const out = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__ttydOutput as string,
    );
    console.log(
      `[vim-test] Output after typing (${out.length} chars): ${JSON.stringify(out.slice(0, 300))}`,
    );

    expect(out).toContain(marker);

    // Clean up: quit vim without saving, then destroy the session.
    await term.send(inputFrame("\x1b:q!\r")); // ESC then :q!
    await term.close();

    // Destroy the session so it doesn't linger.
    await fetch(`${QA_URL}/api/v1/agents/dev/sessions/${sessionId}`, {
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
    await page.goto("about:blank");

    const wsHost = new URL(QA_URL!).host;
    const wsUrl = `ws://${wsHost}/ws/terminal/dev/${sessionId}`;
    const term = await connectTerminalWS(page, wsUrl);

    await page.waitForTimeout(1000);
    await term.send(resizeFrame(220, 50));
    await page.waitForTimeout(200);

    // Launch vim in compatible mode (default, no nocompatible).
    await term.send(inputFrame("vim -u NONE\r"));

    await term.waitForOutput(/~|\x1b\[/, 20_000);

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__ttydOutput = "";
    });

    const marker = "VIMTEST_COMPAT_OK";
    await term.send(inputFrame("i" + marker));
    await page.waitForTimeout(500);

    const out = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__ttydOutput as string,
    );
    console.log(
      `[vim-test] Compatible baseline output: ${JSON.stringify(out.slice(0, 300))}`,
    );

    expect(out).toContain(marker);

    await term.send(inputFrame("\x1b:q!\r"));
    await term.close();
    await fetch(`${QA_URL}/api/v1/agents/dev/sessions/${sessionId}`, {
      method: "DELETE",
    });
  });
});
