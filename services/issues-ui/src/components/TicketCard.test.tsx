// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ActiveSessionInfo, SessionState, Ticket } from "../types";

// Mock CSS modules
vi.mock("../styles/card.module.css", () => ({ default: {} }));
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

// Mock child components to keep tests focused
vi.mock("./LaunchAgentDialog", () => ({
  LaunchAgentDialog: () => null,
}));
vi.mock("./PriorityBadge", () => ({
  PriorityBadge: () => null,
}));
vi.mock("./LabelBadge", () => ({
  LabelBadge: () => null,
}));

// Mock react-router Link
vi.mock("react-router", () => ({
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...props}>{children}</a>
  ),
}));

import { hasActiveSession, TicketCard } from "./TicketCard";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSession = (name: string, state: SessionState): ActiveSessionInfo => ({
  name,
  state,
});

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: "ticket-1",
  number: 5,
  title: "Test ticket",
  state: "REFINED",
  priority: "MEDIUM",
  labels: [],
  blockedBy: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// hasActiveSession — pure function tests (no DOM needed)
// ---------------------------------------------------------------------------

describe("hasActiveSession", () => {
  it("returns false when sessions array is empty", () => {
    expect(hasActiveSession([], 5)).toBe(false);
  });

  it("returns false when no session matches the ticket number", () => {
    const sessions = [
      makeSession("lead-99", "running"),
      makeSession("refine-10", "running"),
    ];
    expect(hasActiveSession(sessions, 5)).toBe(false);
  });

  it("returns false when session name matches but state is 'stopped'", () => {
    const sessions = [makeSession("lead-5", "stopped")];
    expect(hasActiveSession(sessions, 5)).toBe(false);
  });

  it("returns false when session name matches but state is 'error'", () => {
    const sessions = [makeSession("refine-5", "error")];
    expect(hasActiveSession(sessions, 5)).toBe(false);
  });

  it("returns true for lead-N with state 'running'", () => {
    const sessions = [makeSession("lead-5", "running")];
    expect(hasActiveSession(sessions, 5)).toBe(true);
  });

  it("returns true for refine-N with state 'running'", () => {
    const sessions = [makeSession("refine-5", "running")];
    expect(hasActiveSession(sessions, 5)).toBe(true);
  });

  it("returns true for discuss-N with state 'running'", () => {
    const sessions = [makeSession("discuss-5", "running")];
    expect(hasActiveSession(sessions, 5)).toBe(true);
  });

  it("returns true for any matching name with state 'creating'", () => {
    expect(hasActiveSession([makeSession("lead-5", "creating")], 5)).toBe(true);
    expect(hasActiveSession([makeSession("refine-5", "creating")], 5)).toBe(true);
    expect(hasActiveSession([makeSession("discuss-5", "creating")], 5)).toBe(true);
  });

  it("returns false when session name partially matches (lead-12 should not match ticket 1)", () => {
    const sessions = [makeSession("lead-12", "running")];
    expect(hasActiveSession(sessions, 1)).toBe(false);
  });

  it("returns true for matching name with state 'destroying'", () => {
    expect(hasActiveSession([makeSession("lead-5", "destroying")], 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TicketCard — component rendering tests
// ---------------------------------------------------------------------------

describe("TicketCard", () => {
  it("shows card-launch-button when no active session", () => {
    const ticket = makeTicket();
    const { getByTestId } = render(
      <TicketCard ticket={ticket} sessions={[]} />,
    );
    expect(getByTestId("card-launch-button")).toBeTruthy();
  });

  it("shows card-launch-button when sessions prop is omitted", () => {
    const ticket = makeTicket();
    const { getByTestId } = render(<TicketCard ticket={ticket} />);
    expect(getByTestId("card-launch-button")).toBeTruthy();
  });

  it("shows active-session-logo when active session exists", () => {
    const ticket = makeTicket({ number: 5 });
    const sessions = [makeSession("lead-5", "running")];
    const { getByTestId } = render(
      <TicketCard ticket={ticket} sessions={sessions} />,
    );
    expect(getByTestId("active-session-logo")).toBeTruthy();
  });

  it("hides card-launch-button when active session exists", () => {
    const ticket = makeTicket({ number: 5 });
    const sessions = [makeSession("lead-5", "running")];
    const { queryByTestId } = render(
      <TicketCard ticket={ticket} sessions={sessions} />,
    );
    expect(queryByTestId("card-launch-button")).toBeNull();
  });
});
