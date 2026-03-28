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

import { NotificationDropdown } from "./NotificationDropdown";
import type { AgentSession } from "../hooks/useAllSessions";
import type { Session } from "../types";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.restoreAllMocks();
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
      <NotificationDropdown waitingSessions={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("NotificationDropdown — badge", () => {
  it("renders the trigger button with the session count", () => {
    const sessions = [makeAgentSession("lead"), makeAgentSession("refine")];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    expect(getByTestId("notification-badge").textContent).toBe("2");
  });

  it("renders '99+' when session count exceeds 99", () => {
    const sessions = Array.from({ length: 100 }, (_, i) =>
      makeAgentSession("lead", { id: `sess-${i}`, name: `Session ${i}` }),
    );
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    expect(getByTestId("notification-badge").textContent).toBe("99+");
  });

  it("renders the exact count when count is 99", () => {
    const sessions = Array.from({ length: 99 }, (_, i) =>
      makeAgentSession("lead", { id: `sess-${i}`, name: `Session ${i}` }),
    );
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    expect(getByTestId("notification-badge").textContent).toBe("99");
  });
});

describe("NotificationDropdown — open/close", () => {
  it("does not show the dropdown initially", () => {
    const sessions = [makeAgentSession()];
    const { queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    expect(queryByTestId("notification-dropdown")).toBeNull();
  });

  it("clicking the trigger button opens the dropdown", () => {
    const sessions = [makeAgentSession()];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getByTestId("notification-dropdown")).toBeTruthy();
  });

  it("clicking the trigger button again closes the dropdown", () => {
    const sessions = [makeAgentSession()];
    const { getByTestId, queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getByTestId("notification-dropdown")).toBeTruthy();
    fireEvent.click(getByTestId("notification-trigger"));
    expect(queryByTestId("notification-dropdown")).toBeNull();
  });

  it("dispatching mousedown outside the wrapper closes the dropdown", () => {
    const sessions = [makeAgentSession()];
    const { getByTestId, queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
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
      <NotificationDropdown waitingSessions={sessions} />,
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
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getAllByTestId("notification-item")).toHaveLength(2);
  });

  it("items link to /agents?session=<agentName>:<sessionId>", () => {
    const agentName = "lead";
    const sessionId = "abc-123";
    const sessions = [makeAgentSession(agentName, { id: sessionId })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    const item = getByTestId("notification-item") as HTMLAnchorElement;
    const expectedHref = `/agents?session=${encodeURIComponent(agentName)}:${encodeURIComponent(sessionId)}`;
    expect(item.getAttribute("href")).toBe(expectedHref);
  });

  it("encodes special characters in agentName and sessionId", () => {
    const agentName = "my agent";
    const sessionId = "id/with:special";
    const sessions = [makeAgentSession(agentName, { id: sessionId })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    const item = getByTestId("notification-item") as HTMLAnchorElement;
    expect(item.getAttribute("href")).toBe(
      `/agents?session=${encodeURIComponent(agentName)}:${encodeURIComponent(sessionId)}`,
    );
  });

  it("clicking a dropdown item closes the dropdown", () => {
    const sessions = [makeAgentSession("lead", { id: "s1" })];
    const { getByTestId, queryByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    expect(getByTestId("notification-dropdown")).toBeTruthy();

    fireEvent.click(getByTestId("notification-item"));
    expect(queryByTestId("notification-dropdown")).toBeNull();
  });

  it("displays the session name in each item", () => {
    const sessions = [makeAgentSession("lead", { id: "s1", name: "My Feature Work" })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    expect(getByTestId("notification-item").textContent).toContain("My Feature Work");
  });

  it("displays the agent name in each item", () => {
    const sessions = [makeAgentSession("refine-specialist", { id: "s1" })];
    const { getByTestId } = render(
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));

    expect(getByTestId("notification-item").textContent).toContain("refine-specialist");
  });
});

describe("NotificationDropdown — idle duration", () => {
  it("does not render idle span when idleSince is absent", () => {
    const sessions = [makeAgentSession("lead", { id: "s1", idleSince: undefined })];
    const { getByTestId, container } = render(
      <NotificationDropdown waitingSessions={sessions} />,
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
      <NotificationDropdown waitingSessions={sessions} />,
    );
    fireEvent.click(getByTestId("notification-trigger"));
    const item = getByTestId("notification-item");
    // Should contain some non-empty idle string (e.g. "1m")
    expect(item.textContent).toMatch(/\d+[smh]/);
  });
});
