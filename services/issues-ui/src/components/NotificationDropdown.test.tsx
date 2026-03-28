// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

// Mock CSS modules
vi.mock("../styles/layout.module.css", () => ({ default: {} }));

// Mock react-router — forward all extra props so data-testid etc. are preserved
vi.mock("react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: { children: React.ReactNode; to: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

// Mock agentHubClient
vi.mock("../api/agentHubClient", () => ({
  sendSessionInput: vi.fn().mockResolvedValue(undefined),
  fetchAgents: vi.fn(),
  fetchAllSessions: vi.fn(),
  fetchSessionOutput: vi.fn(),
  createSession: vi.fn(),
  HubError: class HubError extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = "HubError";
    }
  },
}));

// Mock useTicketByNumber
vi.mock("../hooks/useTicketByNumber", () => ({
  useTicketByNumber: vi.fn(() => ({ ticket: null, loading: false, error: null })),
}));

import { NotificationDropdown } from "./NotificationDropdown";
import type { AgentSession } from "../hooks/useAllSessions";
import type { Session } from "../types";
import { sendSessionInput } from "../api/agentHubClient";
import { useTicketByNumber } from "../hooks/useTicketByNumber";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.restoreAllMocks();
  // Re-apply default mock after restoreAllMocks
  vi.mocked(useTicketByNumber).mockReturnValue({ ticket: null, loading: false, error: null });
  vi.mocked(sendSessionInput).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Helpers / factories
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    name: "My Session",
    agentProfile: "default",
    state: "running",
    createdAt: new Date().toISOString(),
    waitingForInput: true,
    ...overrides,
  } as Session;
}

function makeAgentSession(
  agentName = "lead",
  sessionOverrides: Partial<Session> = {},
): AgentSession {
  return {
    agentName,
    session: makeSession(sessionOverrides),
  };
}

// ---------------------------------------------------------------------------
// NotificationDropdown
// ---------------------------------------------------------------------------

describe("NotificationDropdown — empty state", () => {
  it("returns null when waitingSessions is empty", () => {
    const { container } = render(
      <NotificationDropdown waitingSessions={[]} projectId={undefined} projectName={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("NotificationDropdown — badge", () => {
  it("renders the trigger button with the session count", () => {
    const sessions = [makeAgentSession("lead"), makeAgentSession("refine")];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    expect(getByTestId("notification-badge").textContent).toBe("2");
  });

  it("renders '99+' when session count exceeds 99", () => {
    const sessions = Array.from({ length: 100 }, (_, i) =>
      makeAgentSession("lead", { id: `sess-${i}`, name: `Session ${i}` }),
    );
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    expect(getByTestId("notification-badge").textContent).toBe("99+");
  });

  it("renders the exact count when count is 99", () => {
    const sessions = Array.from({ length: 99 }, (_, i) =>
      makeAgentSession("lead", { id: `sess-${i}`, name: `Session ${i}` }),
    );
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    expect(getByTestId("notification-badge").textContent).toBe("99");
  });
});

describe("NotificationDropdown — open/close", () => {
  it("does not show the dropdown initially", () => {
    const sessions = [makeAgentSession()];
    const { queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    expect(queryByTestId("notification-dropdown")).toBeNull();
  });

  it("clicking the trigger button opens the dropdown", () => {
    const sessions = [makeAgentSession()];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getByTestId("notification-dropdown")).toBeTruthy();
  });

  it("clicking the trigger button again closes the dropdown", () => {
    const sessions = [makeAgentSession()];
    const { getByTestId, queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getByTestId("notification-dropdown")).toBeTruthy();
    fireEvent.click(getByTestId("notification-trigger"));
    expect(queryByTestId("notification-dropdown")).toBeNull();
  });

  it("dispatching mousedown outside the wrapper closes the dropdown", () => {
    const sessions = [makeAgentSession()];
    const { getByTestId, queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getByTestId("notification-dropdown")).toBeTruthy();

    // Simulate a click outside by dispatching mousedown on document.body
    fireEvent.mouseDown(document.body);
    expect(queryByTestId("notification-dropdown")).toBeNull();
  });

  it("dispatching mousedown inside the wrapper does not close the dropdown", () => {
    const sessions = [makeAgentSession()];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    const dropdown = getByTestId("notification-dropdown");

    fireEvent.mouseDown(dropdown);
    expect(getByTestId("notification-dropdown")).toBeTruthy();
  });
});

describe("NotificationDropdown — dropdown items", () => {
  it("renders one item per waiting session", () => {
    const sessions = [
      makeAgentSession("lead", { id: "s1", name: "Work A" }),
      makeAgentSession("refine", { id: "s2", name: "Work B" }),
    ];
    const { getAllByTestId, getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getAllByTestId("notification-item")).toHaveLength(2);
  });

  it("items link to /agents?session=<agentName>:<sessionId>", () => {
    const agentName = "lead";
    const sessionId = "abc-123";
    const sessions = [makeAgentSession(agentName, { id: sessionId })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    const link = getByTestId("notification-item-link") as HTMLAnchorElement;
    const expectedHref = `/agents?session=${encodeURIComponent(agentName)}:${encodeURIComponent(sessionId)}`;
    expect(link.getAttribute("href")).toBe(expectedHref);
  });

  it("encodes special characters in agentName and sessionId", () => {
    const agentName = "my agent";
    const sessionId = "id/with:special";
    const sessions = [makeAgentSession(agentName, { id: sessionId })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    const link = getByTestId("notification-item-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      `/agents?session=${encodeURIComponent(agentName)}:${encodeURIComponent(sessionId)}`,
    );
  });

  it("clicking the item link closes the dropdown", () => {
    const sessions = [makeAgentSession("lead", { id: "s1" })];
    const { getByTestId, queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getByTestId("notification-dropdown")).toBeTruthy();

    fireEvent.click(getByTestId("notification-item-link"));
    expect(queryByTestId("notification-dropdown")).toBeNull();
  });

  it("displays the session name in each item", () => {
    const sessions = [makeAgentSession("lead", { id: "s1", name: "My Feature Work" })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    expect(getByTestId("notification-item").textContent).toContain("My Feature Work");
  });

  it("displays the agent name in each item", () => {
    const sessions = [makeAgentSession("refine-specialist", { id: "s1" })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    expect(getByTestId("notification-item").textContent).toContain("refine-specialist");
  });
});

describe("NotificationDropdown — idle duration", () => {
  it("does not render idle span when idleSince is absent", () => {
    const sessions = [makeAgentSession("lead", { id: "s1", idleSince: undefined })];
    const { getByTestId, container } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    // The item should render without any idle text
    const item = getByTestId("notification-item");
    // Check there is no empty idle span (the component only renders the span when idleSince is set)
    expect(item).toBeTruthy();
    // Confirm idle content is absent — the component conditionally renders idle span
    expect(container.querySelector("[class*='notificationIdle']")).toBeNull();
  });

  it("renders idle duration span when idleSince is provided", () => {
    // Use a fixed past time so the idle duration is non-empty
    const idleSince = new Date(Date.now() - 65_000).toISOString(); // ~1 minute ago
    const sessions = [makeAgentSession("lead", { id: "s1", idleSince })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    const item = getByTestId("notification-item");
    // Should contain some non-empty idle string (e.g. "1m")
    expect(item.textContent).toMatch(/\d+[smh]/);
  });
});

// ---------------------------------------------------------------------------
// Prompt interaction tests
// ---------------------------------------------------------------------------

describe("NotificationDropdown — yesno prompt", () => {
  it("Yes button calls sendSessionInput with 'y\\n'", async () => {
    const agentName = "lead";
    const sessionId = "sess-yesno";
    const sessions = [
      makeAgentSession(agentName, {
        id: sessionId,
        promptType: "yesno",
        promptContext: "Do you want to continue? (y/N)",
      }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    fireEvent.click(getByTestId("btn-yes"));

    // sendSessionInput is async; wait for it to be called
    await vi.waitFor(() => {
      expect(sendSessionInput).toHaveBeenCalledWith(agentName, sessionId, "y\n");
    });
  });

  it("No button calls sendSessionInput with 'n\\n'", async () => {
    const agentName = "lead";
    const sessionId = "sess-yesno";
    const sessions = [
      makeAgentSession(agentName, {
        id: sessionId,
        promptType: "yesno",
        promptContext: "Do you want to continue? (y/N)",
      }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    fireEvent.click(getByTestId("btn-no"));

    await vi.waitFor(() => {
      expect(sendSessionInput).toHaveBeenCalledWith(agentName, sessionId, "n\n");
    });
  });
});

describe("NotificationDropdown — parseSelectPrompt no ❯ marker", () => {
  it("defaults currentIndex to 0 when no ❯ marker is present", async () => {
    const agentName = "lead";
    const sessionId = "sess-select-nomarker";
    // Context has no ❯ — currentIndex should default to 0
    const contextNoMarker = "? Pick one\n  Option A\n  Option B\n  Option C";
    const sessions = [
      makeAgentSession(agentName, {
        id: sessionId,
        promptType: "select",
        promptContext: contextNoMarker,
      }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    // Click Option B (index 1) — currentIndex defaults to 0, delta = 1, one down arrow
    fireEvent.click(getByTestId("btn-option-1"));

    await vi.waitFor(() => {
      expect(sendSessionInput).toHaveBeenCalledWith(agentName, sessionId, "\x1b[B\r");
    });
  });
});

describe("NotificationDropdown — select prompt", () => {
  const selectContext = "? Pick one\n  Option A\n❯ Option B\n  Option C";

  it("renders a button for each parsed option", () => {
    const sessions = [
      makeAgentSession("lead", {
        id: "sess-select",
        promptType: "select",
        promptContext: selectContext,
      }),
    ];
    const { getByTestId, getByText } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    // Options: "Option A", "Option B", "Option C"
    expect(getByText("Option A")).toBeTruthy();
    expect(getByText("Option B")).toBeTruthy();
    expect(getByText("Option C")).toBeTruthy();
  });

  it("clicking a non-current option sends arrow-key sequence + \\r", async () => {
    const agentName = "lead";
    const sessionId = "sess-select";
    // currentIndex is 1 (Option B, index 1)
    const sessions = [
      makeAgentSession(agentName, {
        id: sessionId,
        promptType: "select",
        promptContext: selectContext,
      }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    // Click Option C (index 2) — delta = 2 - 1 = 1, down arrow once + \r
    fireEvent.click(getByTestId("btn-option-2"));

    await vi.waitFor(() => {
      expect(sendSessionInput).toHaveBeenCalledWith(agentName, sessionId, "\x1b[B\r");
    });
  });
});

describe("NotificationDropdown — text input prompt", () => {
  it("renders a text input and Send button", () => {
    const sessions = [
      makeAgentSession("lead", {
        id: "sess-text",
        promptType: "text",
      }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    expect(getByTestId("text-input")).toBeTruthy();
    expect(getByTestId("btn-send")).toBeTruthy();
  });

  it("Send button calls sendSessionInput with typed text + \\n", async () => {
    const agentName = "lead";
    const sessionId = "sess-text";
    const sessions = [
      makeAgentSession(agentName, {
        id: sessionId,
        promptType: "text",
      }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    const input = getByTestId("text-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed text" } });
    fireEvent.click(getByTestId("btn-send"));

    await vi.waitFor(() => {
      expect(sendSessionInput).toHaveBeenCalledWith(agentName, sessionId, "typed text\n");
    });
  });
});

describe("NotificationDropdown — controls do not navigate", () => {
  it("clicking Yes keeps the dropdown open (controls are siblings of the link, not children)", async () => {
    const sessions = [
      makeAgentSession("lead", {
        id: "sess-stop",
        promptType: "yesno",
        promptContext: "Continue? (y/N)",
      }),
    ];
    const { getByTestId, queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    // Controls are siblings of <Link>, not nested inside it.
    // Clicking a control button does not trigger the link's onClick (onClose).
    fireEvent.click(getByTestId("btn-yes"));

    expect(queryByTestId("notification-dropdown")).toBeTruthy();
  });
});

describe("NotificationDropdown — ticket title", () => {
  it("shows ticket title when useTicketByNumber returns a ticket", () => {
    vi.mocked(useTicketByNumber).mockReturnValue({
      ticket: { id: "t1", number: 42, title: "Add sound effects" },
      loading: false,
      error: null,
    });

    const sessions = [
      makeAgentSession("lead", { id: "s1", name: "lead-42" }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId="proj-1" projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    expect(getByTestId("notification-item").textContent).toContain("Add sound effects");
  });

  it("shows session name as fallback when no ticket is found", () => {
    vi.mocked(useTicketByNumber).mockReturnValue({
      ticket: null,
      loading: false,
      error: null,
    });

    const sessions = [
      makeAgentSession("lead", { id: "s1", name: "general-work" }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    expect(getByTestId("notification-item").textContent).toContain("general-work");
  });
});

describe("NotificationDropdown — error state on sendSessionInput rejection", () => {
  it("shows error message when sendSessionInput rejects", async () => {
    vi.mocked(sendSessionInput).mockRejectedValue(new Error("network error"));

    const sessions = [
      makeAgentSession("lead", {
        id: "sess-err",
        promptType: "yesno",
        promptContext: "Continue? (y/N)",
      }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    fireEvent.click(getByTestId("btn-yes"));

    await vi.waitFor(() => {
      expect(getByTestId("send-error").textContent).toBe("network error");
    });
  });

  it("clears error when user types in the text input", async () => {
    vi.mocked(sendSessionInput).mockRejectedValueOnce(new Error("network error"));

    const sessions = [
      makeAgentSession("lead", {
        id: "sess-err-clear",
        promptType: "text",
      }),
    ];
    const { getByTestId, queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    // Trigger the error
    fireEvent.click(getByTestId("btn-send"));
    await vi.waitFor(() => {
      expect(getByTestId("send-error")).toBeTruthy();
    });

    // Typing clears the error
    fireEvent.change(getByTestId("text-input"), { target: { value: "x" } });
    expect(queryByTestId("send-error")).toBeNull();
  });
});

describe("NotificationDropdown — Sent state", () => {
  it("Yes button becomes disabled after click", async () => {
    vi.useFakeTimers();

    const sessions = [
      makeAgentSession("lead", {
        id: "sess-sent",
        promptType: "yesno",
        promptContext: "Continue? (y/N)",
      }),
    ];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} projectId={undefined} projectName={null} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    const yesBtn = getByTestId("btn-yes") as HTMLButtonElement;
    expect(yesBtn.disabled).toBe(false);

    fireEvent.click(yesBtn);

    // After async sendSessionInput resolves, setSent(true) is called
    await vi.waitFor(() => {
      expect(yesBtn.disabled).toBe(true);
    });

    // After the 1s timeout, the button reverts
    vi.runAllTimers();
    await vi.waitFor(() => {
      expect(yesBtn.disabled).toBe(false);
    });

    vi.useRealTimers();
  });
});
