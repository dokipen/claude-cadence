// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";

// Mock Terminal to avoid xterm dependency — capture props for inspection
const capturedTerminalProps = vi.hoisted(() => ({
  onResumeSession: undefined as (() => void) | undefined,
}));

vi.mock("./Terminal", () => ({
  Terminal: (props: { agentName?: string; sessionId?: string; onResumeSession?: () => void }) => {
    capturedTerminalProps.onResumeSession = props.onResumeSession;
    return <div data-testid="terminal" />;
  },
}));

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

// Mock useTicketByNumber to avoid AuthProvider dependency
const mockUseTicketByNumber = vi.fn();
mockUseTicketByNumber.mockReturnValue({ ticket: null, loading: false, error: null });
vi.mock("../hooks/useTicketByNumber", () => ({
  useTicketByNumber: (...args: unknown[]) => mockUseTicketByNumber(...args),
}));

// Mock hubFetch and createSession
const mockHubFetch = vi.fn();
const mockCreateSession = vi.fn();
vi.mock("../api/agentHubClient", () => ({
  hubFetch: (...args: unknown[]) => mockHubFetch(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  HubError: class HubError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "HubError";
      this.status = status;
    }
  },
}));

import { TerminalWindow } from "./TerminalWindow";
import { HubError } from "../api/agentHubClient";

const baseSession = create(SessionSchema, {
  id: "sess-abc",
  name: "lead-42",
  state: "running",
  agentProfile: "default",
  createdAt: "2026-01-01T00:00:00Z",
  agentPid: 1234,
  repoUrl: "https://github.com/test/repo",
  baseRef: "main",
  waitingForInput: false,
});

describe("TerminalWindow", () => {
  beforeEach(() => {
    mockHubFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("sends DELETE with force=true when terminate is clicked", async () => {
    mockHubFetch.mockResolvedValueOnce({});
    const onTerminated = vi.fn();

    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={onTerminated}
      />,
    );

    fireEvent.click(screen.getByTestId("tile-terminate"));
    await waitFor(() => expect(mockHubFetch).toHaveBeenCalled());

    expect(mockHubFetch).toHaveBeenCalledWith(
      "/agents/agent-1/sessions/sess-abc?force=true",
      { method: "DELETE" },
    );
    expect(onTerminated).toHaveBeenCalled();
  });

  it("calls onTerminated when session is already gone (404)", async () => {
    mockHubFetch.mockRejectedValueOnce(new HubError(404, "not found"));
    const onTerminated = vi.fn();

    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={onTerminated}
      />,
    );

    fireEvent.click(screen.getByTestId("tile-terminate"));
    await waitFor(() => expect(mockHubFetch).toHaveBeenCalled());

    expect(onTerminated).toHaveBeenCalled();
  });

  it("does not call onTerminated on non-404 errors", async () => {
    mockHubFetch.mockRejectedValueOnce(new HubError(500, "server error"));
    const onTerminated = vi.fn();

    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={onTerminated}
      />,
    );

    fireEvent.click(screen.getByTestId("tile-terminate"));
    await waitFor(() => expect(mockHubFetch).toHaveBeenCalled());
    expect(onTerminated).not.toHaveBeenCalled();
  });

  it("renders maximize button with data-testid and title 'Maximize' by default", () => {
    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const btn = screen.getByTestId("tile-maximize");
    expect(btn).toBeDefined();
    expect(btn.title).toBe("Maximize");
  });

  it("renders maximize button with title 'Restore' when isMaximized is true", () => {
    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
        isMaximized={true}
      />,
    );

    const btn = screen.getByTestId("tile-maximize");
    expect(btn.title).toBe("Restore");
  });

  it("calls onMaximize callback when maximize button is clicked", () => {
    const onMaximize = vi.fn();

    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
        onMaximize={onMaximize}
      />,
    );

    fireEvent.click(screen.getByTestId("tile-maximize"));
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });
});

describe("keyboard accessibility", () => {
  beforeEach(() => {
    mockHubFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  const accessibleSession = create(SessionSchema, {
    id: "sess-1",
    name: "test-session",
    state: "running",
    agentProfile: "default",
    createdAt: "2026-01-01T00:00:00Z",
    agentPid: 5678,
    baseRef: "main",
    waitingForInput: false,
  });

  it("tile header has tabIndex={0} and role='button'", () => {
    render(
      <TerminalWindow
        session={accessibleSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const header = screen.getByTestId("tile-header");
    expect(header.getAttribute("tabindex")).toBe("0");
    expect(header.getAttribute("role")).toBe("button");
  });

  it("tile header has aria-pressed='false' when isKeyboardGrabbed is false", () => {
    render(
      <TerminalWindow
        session={accessibleSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
        isKeyboardGrabbed={false}
      />,
    );

    const header = screen.getByTestId("tile-header");
    expect(header.getAttribute("aria-pressed")).toBe("false");
  });

  it("tile header has aria-pressed='true' when isKeyboardGrabbed is true", () => {
    render(
      <TerminalWindow
        session={accessibleSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
        isKeyboardGrabbed={true}
      />,
    );

    const header = screen.getByTestId("tile-header");
    expect(header.getAttribute("aria-pressed")).toBe("true");
  });

  it("tile header aria-label in idle state contains 'Rearrange window' and session name", () => {
    render(
      <TerminalWindow
        session={accessibleSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
        isKeyboardGrabbed={false}
      />,
    );

    const header = screen.getByTestId("tile-header");
    const label = header.getAttribute("aria-label") ?? "";
    expect(label).toContain("Rearrange window");
    expect(label).toContain(accessibleSession.name);
  });

  it("tile header aria-label in moving state contains 'Moving:' and 'arrow keys'", () => {
    render(
      <TerminalWindow
        session={accessibleSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
        isKeyboardGrabbed={true}
      />,
    );

    const header = screen.getByTestId("tile-header");
    const label = header.getAttribute("aria-label") ?? "";
    expect(label).toContain("Moving:");
    expect(label).toContain("arrow keys");
  });

  it("outer terminal-window aria-label contains position info", () => {
    render(
      <TerminalWindow
        session={accessibleSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
        windowIndex={1}
        windowCount={3}
      />,
    );

    const window = screen.getByTestId("terminal-window");
    const label = window.getAttribute("aria-label") ?? "";
    expect(label).toContain("position 2 of 3");
  });

  it("calls onHeaderKeyDown when a key is pressed on the tile header", () => {
    const onHeaderKeyDown = vi.fn();

    render(
      <TerminalWindow
        session={accessibleSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
        onHeaderKeyDown={onHeaderKeyDown}
      />,
    );

    const header = screen.getByTestId("tile-header");
    fireEvent.keyDown(header, { key: " " });

    expect(onHeaderKeyDown).toHaveBeenCalledOnce();
  });
});

describe("ticket title in header", () => {
  beforeEach(() => {
    mockHubFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  const leadSession = create(SessionSchema, {
    id: "sess-lead",
    name: "lead-42",
    state: "running",
    agentProfile: "default",
    createdAt: "2026-01-01T00:00:00Z",
    agentPid: 9000,
    baseRef: "main",
    waitingForInput: false,
  });

  it("shows ticket title as link with CUID href when hook returns ticket", () => {
    mockUseTicketByNumber.mockReturnValue({
      ticket: { id: "cuid-abc", number: 42, title: "My ticket title" },
      loading: false,
      error: null,
    });

    render(
      <TerminalWindow
        session={leadSession}
        agentName="agent-1"
        projectId="proj-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const link = document.querySelector('a[href="/ticket/cuid-abc"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("My ticket title");
    expect(document.querySelector('a[href="/ticket/42"]')).toBeNull();
  });

  it("shows plain #N span (no link) while ticket is loading (null)", () => {
    mockUseTicketByNumber.mockReturnValue({
      ticket: null,
      loading: true,
      error: null,
    });

    render(
      <TerminalWindow
        session={leadSession}
        agentName="agent-1"
        projectId="proj-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    expect(screen.getByText("#42")).toBeDefined();
    expect(document.querySelector('a[href*="/ticket/"]')).toBeNull();
  });

  it("shows no ticket link for session without lead-N name pattern", () => {
    mockUseTicketByNumber.mockReturnValue({
      ticket: null,
      loading: false,
      error: null,
    });

    const workSession = create(SessionSchema, {
      id: "sess-work",
      name: "work-session",
      state: "running",
      agentProfile: "default",
      createdAt: "2026-01-01T00:00:00Z",
      agentPid: 1111,
      baseRef: "main",
      waitingForInput: false,
    });

    render(
      <TerminalWindow
        session={workSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    expect(document.querySelector('a[href*="/ticket/"]')).toBeNull();
    // No #N text in the tile header (the header contains session name "work-session")
    const header = screen.getByTestId("tile-header");
    expect(header.textContent).not.toMatch(/#\d+/);
  });
});


describe("handleResumeSession", () => {
  beforeEach(() => {
    mockHubFetch.mockReset();
    mockCreateSession.mockReset();
  });

  afterEach(() => {
    cleanup();
    capturedTerminalProps.onResumeSession = undefined;
  });

  it("calls createSession with agentProfile, a resume-prefixed name, and /resume <sessionId> when agentProfile is set", () => {
    mockCreateSession.mockResolvedValue({});

    const sessionWithProfile = create(SessionSchema, {
      id: "sess-abc",
      name: "lead-42",
      state: "running",
      agentProfile: "default",
      createdAt: "2026-01-01T00:00:00Z",
      agentPid: 1234,
      baseRef: "main",
      waitingForInput: false,
    });

    render(
      <TerminalWindow
        session={sessionWithProfile}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    // onResumeSession should have been passed to Terminal
    expect(capturedTerminalProps.onResumeSession).toBeDefined();

    // Invoke the handler (simulates button click in Terminal)
    capturedTerminalProps.onResumeSession!();

    expect(mockCreateSession).toHaveBeenCalledWith(
      "agent-1",
      "default",
      expect.stringMatching(/^resume-[\w-]+-\d+$/),
      ["/resume sess-abc"],
    );
  });


  it("produces distinct session names on successive invocations", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    mockCreateSession.mockResolvedValue({});

    const sessionWithProfile = create(SessionSchema, {
      id: "sess-abc",
      name: "lead-42",
      state: "running",
      agentProfile: "default",
      createdAt: "2026-01-01T00:00:00Z",
      agentPid: 1234,
      baseRef: "main",
      waitingForInput: false,
    });

    render(
      <TerminalWindow
        session={sessionWithProfile}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    expect(capturedTerminalProps.onResumeSession).toBeDefined();

    capturedTerminalProps.onResumeSession!();
    capturedTerminalProps.onResumeSession!();

    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    const firstName = mockCreateSession.mock.calls[0][2] as string;
    const secondName = mockCreateSession.mock.calls[1][2] as string;
    expect(firstName).not.toBe(secondName);
  });
  it("passes onResumeSession={undefined} to Terminal when agentProfile is empty", () => {
    const sessionNoProfile = create(SessionSchema, {
      id: "sess-xyz",
      name: "work-session",
      state: "running",
      agentProfile: "",
      createdAt: "2026-01-01T00:00:00Z",
      agentPid: 5678,
      baseRef: "main",
      waitingForInput: false,
    });

    render(
      <TerminalWindow
        session={sessionNoProfile}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    expect(capturedTerminalProps.onResumeSession).toBeUndefined();
  });
});
