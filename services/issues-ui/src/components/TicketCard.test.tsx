// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import React, { useEffect, useRef } from "react";

vi.mock("lucide-react", () => ({
  Archive: ({ size }: { size?: number }) => <svg data-testid="icon-archive" data-size={size} />,
  StopCircle: ({ size }: { size?: number }) => <svg data-testid="icon-stop-circle" data-size={size} />,
}));
import type { ActiveSessionInfo, SessionState, Ticket } from "../types";

// ---------------------------------------------------------------------------
// Hoisted mutable state shared between mock factories and tests
// ---------------------------------------------------------------------------
const { mockHubFetch, mockOptimisticSetDestroying, mockOptimisticResetState, MockHubError } = vi.hoisted(() => {
  class MockHubError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "HubError";
      this.status = status;
    }
  }
  return {
    mockHubFetch: vi.fn(),
    mockOptimisticSetDestroying: vi.fn(),
    mockOptimisticResetState: vi.fn(),
    MockHubError,
  };
});

// Mock CSS modules
vi.mock("../styles/card.module.css", () => ({ default: new Proxy({}, { get: (_t, key) => String(key) }) }));
vi.mock("../styles/agents.module.css", () => ({ default: {} }));
vi.mock("../styles/animated-icon.module.css", () => ({ default: {} }));

// Mock child components to keep tests focused
vi.mock("./ConfirmDialog", () => ({
  ConfirmDialog: ({
    open,
    title,
    confirmLabel,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title?: string;
    confirmLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }) =>
    open ? (
      <div data-testid="confirm-dialog" data-title={title} data-confirm-label={confirmLabel}>
        <button data-testid="confirm-dialog-confirm" onClick={onConfirm}>
          Confirm
        </button>
        <button data-testid="confirm-dialog-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}));

const mockTransition = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useTransitionTicket", () => ({
  useTransitionTicket: () => ({
    transition: mockTransition,
    loading: false,
    error: null,
  }),
}));

vi.mock("./LaunchAgentDialog", () => ({
  LaunchAgentDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="launch-dialog" /> : null,
}));
vi.mock("./SessionOutputTooltip", () => ({
  SessionOutputTooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("./PriorityBadge", () => ({
  PriorityBadge: () => null,
}));
vi.mock("./LabelBadge", () => ({
  LabelBadge: () => null,
}));

// ---------------------------------------------------------------------------
// agentHubClient — mock hubFetch and re-implement deleteSession on top of it
// ---------------------------------------------------------------------------
vi.mock("../api/agentHubClient", () => ({
  hubFetch: mockHubFetch,
  HubError: MockHubError,
  deleteSession: async (agentName: string, sessionId: string) => {
    try {
      await mockHubFetch(`/agents/${agentName}/sessions/${sessionId}?force=true`, { method: "DELETE" });
    } catch (err) {
      if (err instanceof MockHubError && err.status === 404) return;
      throw err;
    }
  },
}));

// ---------------------------------------------------------------------------
// SessionsContext — supply optimistic fn mocks
// ---------------------------------------------------------------------------
vi.mock("../hooks/SessionsContext", () => ({
  useSessionsContext: vi.fn(() => ({
    optimisticSetDestroying: mockOptimisticSetDestroying,
    optimisticResetState: mockOptimisticResetState,
    optimisticAddSession: vi.fn(),
  })),
}));

const mockNavigate = vi.fn();

// Mock react-router.
//
// The Link mock registers a *native* (non-React) click listener in the capture
// phase.  This mirrors real browser behaviour: an anchor tag activates its href
// even when a descendant child calls e.stopPropagation() on the React synthetic
// event, because stopPropagation() only stops the React synthetic-event bubbling
// and does not cancel the native anchor activation.
vi.mock("react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.PropsWithChildren<{ to: string } & Record<string, unknown>>) => {
    const ref = useRef<HTMLAnchorElement>(null);

    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      // Native capture-phase listener — fires before any React handlers and
      // cannot be stopped by stopPropagation on a child React element.
      const handler = () => {
        mockNavigate(to);
      };
      el.addEventListener("click", handler, { capture: true });
      return () => el.removeEventListener("click", handler, { capture: true });
    }, [to]);

    return (
      <a ref={ref} href={to as string} {...props}>
        {children}
      </a>
    );
  },
  useNavigate: () => mockNavigate,
}));

import { hasActiveSession, TicketCard } from "./TicketCard";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockNavigate.mockReset();
  mockTransition.mockReset();
  mockTransition.mockResolvedValue(undefined);
  mockHubFetch.mockReset();
  mockOptimisticSetDestroying.mockReset();
  mockOptimisticResetState.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSession = (
  name: string,
  state: SessionState,
  extra: Partial<ActiveSessionInfo> = {},
): ActiveSessionInfo => ({
  name,
  state,
  ...extra,
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
  it("returns null when sessions array is empty", () => {
    expect(hasActiveSession([], 5)).toBeNull();
  });

  it("returns null when no session matches the ticket number", () => {
    const sessions = [
      makeSession("lead-99", "running"),
      makeSession("refine-10", "running"),
    ];
    expect(hasActiveSession(sessions, 5)).toBeNull();
  });

  it("returns null when session name matches but state is 'stopped'", () => {
    const sessions = [makeSession("lead-5", "stopped")];
    expect(hasActiveSession(sessions, 5)).toBeNull();
  });

  it("returns null when session name matches but state is 'error'", () => {
    const sessions = [makeSession("refine-5", "error")];
    expect(hasActiveSession(sessions, 5)).toBeNull();
  });

  it("returns the session for lead-N with state 'running'", () => {
    const sessions = [makeSession("lead-5", "running")];
    expect(hasActiveSession(sessions, 5)).not.toBeNull();
  });

  it("returns the session for refine-N with state 'running'", () => {
    const sessions = [makeSession("refine-5", "running")];
    expect(hasActiveSession(sessions, 5)).not.toBeNull();
  });

  it("returns the session for discuss-N with state 'running'", () => {
    const sessions = [makeSession("discuss-5", "running")];
    expect(hasActiveSession(sessions, 5)).not.toBeNull();
  });

  it("returns the session for any matching name with state 'creating'", () => {
    expect(hasActiveSession([makeSession("lead-5", "creating")], 5)).not.toBeNull();
    expect(hasActiveSession([makeSession("refine-5", "creating")], 5)).not.toBeNull();
    expect(hasActiveSession([makeSession("discuss-5", "creating")], 5)).not.toBeNull();
  });

  it("returns null when session name partially matches (lead-12 should not match ticket 1)", () => {
    const sessions = [makeSession("lead-12", "running")];
    expect(hasActiveSession(sessions, 1)).toBeNull();
  });

  it("returns the session for matching name with state 'destroying'", () => {
    expect(hasActiveSession([makeSession("lead-5", "destroying")], 5)).not.toBeNull();
  });

  it("matches prefixed session names when projectId is provided", () => {
    expect(hasActiveSession([makeSession("myproject-lead-5", "running")], 5, "myproject")).not.toBeNull();
    expect(hasActiveSession([makeSession("myproject-refine-5", "running")], 5, "myproject")).not.toBeNull();
    expect(hasActiveSession([makeSession("myproject-discuss-5", "running")], 5, "myproject")).not.toBeNull();
  });

  it("does not match a session from a different project when projectId is provided", () => {
    expect(hasActiveSession([makeSession("other-lead-5", "running")], 5, "myproject")).toBeNull();
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

  it("active-session-logo button contains an SVG element", () => {
    const ticket = makeTicket({ number: 5 });
    const sessions = [makeSession("lead-5", "running")];
    const { getByTestId } = render(
      <TicketCard ticket={ticket} sessions={sessions} />,
    );
    const button = getByTestId("active-session-logo");
    expect(button.querySelector("svg")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TicketCard launch button — navigation and dialog behavior
// ---------------------------------------------------------------------------

describe("TicketCard launch button", () => {
  it("clicking card-launch-button does not navigate", () => {
    const ticket = makeTicket();
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    const button = getByTestId("card-launch-button");
    fireEvent.click(button);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("clicking card-launch-button opens launch dialog", () => {
    const ticket = makeTicket();
    const { getByTestId, queryByTestId } = render(
      <TicketCard ticket={ticket} sessions={[]} />,
    );
    expect(queryByTestId("launch-dialog")).toBeNull();
    const button = getByTestId("card-launch-button");
    fireEvent.click(button);
    expect(getByTestId("launch-dialog")).toBeTruthy();
    // Navigation must not occur when the launch dialog is opened
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TicketCard close button — visibility and behavior
// ---------------------------------------------------------------------------

describe("TicketCard close button", () => {
  it("shows close button for BACKLOG tickets", () => {
    const ticket = makeTicket({ state: "BACKLOG" });
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(getByTestId("card-close-button")).toBeTruthy();
  });

  it("shows close button for REFINED tickets", () => {
    const ticket = makeTicket({ state: "REFINED" });
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(getByTestId("card-close-button")).toBeTruthy();
  });

  it("does not show close button for IN_PROGRESS tickets", () => {
    const ticket = makeTicket({ state: "IN_PROGRESS" });
    const { queryByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(queryByTestId("card-close-button")).toBeNull();
  });

  it("does not show close button for CLOSED tickets", () => {
    const ticket = makeTicket({ state: "CLOSED" });
    const { queryByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(queryByTestId("card-close-button")).toBeNull();
  });

  it("clicking close button does not navigate", () => {
    const ticket = makeTicket({ state: "BACKLOG" });
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    fireEvent.click(getByTestId("card-close-button"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("clicking close button opens confirm dialog", () => {
    const ticket = makeTicket({ state: "BACKLOG" });
    const { getByTestId, queryByTestId } = render(
      <TicketCard ticket={ticket} sessions={[]} />,
    );
    expect(queryByTestId("confirm-dialog")).toBeNull();
    fireEvent.click(getByTestId("card-close-button"));
    expect(getByTestId("confirm-dialog")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TicketCard footer — no-assignee layout
// ---------------------------------------------------------------------------

describe("TicketCard footer without assignee", () => {
  it("shows launch button when ticket has no assignee", () => {
    const ticket = makeTicket({ assignee: undefined });
    const { getByTestId, queryByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(queryByTestId("assignee")).toBeNull();
    expect(getByTestId("card-launch-button")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TicketCard blocked badge — rendering
// ---------------------------------------------------------------------------

describe("TicketCard blocked badge", () => {
  it("shows blocked badge when blockedBy has an open ticket", () => {
    const ticket = makeTicket({
      blockedBy: [{ id: "blocker-1", state: "IN_PROGRESS" }],
    });
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(getByTestId("blocked-badge")).toBeTruthy();
  });

  it("does not show blocked badge when all blockers are CLOSED", () => {
    const ticket = makeTicket({
      blockedBy: [{ id: "blocker-1", state: "CLOSED" }],
    });
    const { queryByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(queryByTestId("blocked-badge")).toBeNull();
  });

  it("does not show blocked badge when blockedBy is empty", () => {
    const ticket = makeTicket({ blockedBy: [] });
    const { queryByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(queryByTestId("blocked-badge")).toBeNull();
  });

  it("shows blocked badge when at least one blocker is not CLOSED", () => {
    const ticket = makeTicket({
      blockedBy: [
        { id: "blocker-1", state: "CLOSED" },
        { id: "blocker-2", state: "REFINED" },
      ],
    });
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(getByTestId("blocked-badge")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TicketCard active-session-logo — click navigation routing
// ---------------------------------------------------------------------------

describe("TicketCard active-session-logo click navigation", () => {
  it("clicking active-session-logo on a REFINED ticket navigates to ticket detail", () => {
    const ticket = makeTicket({ state: "REFINED", number: 5 });
    const sessions = [
      makeSession("lead-5", "running", { agentName: "agent1", sessionId: "sess-abc" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);
    fireEvent.click(getByTestId("active-session-logo"));
    expect(mockNavigate).toHaveBeenCalledWith("/ticket/ticket-1");
  });

  it("clicking active-session-logo on an IN_PROGRESS ticket navigates to ticket detail", () => {
    const ticket = makeTicket({ state: "IN_PROGRESS", number: 5 });
    const sessions = [
      makeSession("lead-5", "running", { agentName: "agent1", sessionId: "sess-abc" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);
    fireEvent.click(getByTestId("active-session-logo"));
    expect(mockNavigate).toHaveBeenCalledWith("/ticket/ticket-1");
  });

  it("clicking active-session-logo on a BACKLOG ticket navigates to agents view with session key", () => {
    const ticket = makeTicket({ state: "BACKLOG", number: 5 });
    const sessions = [
      makeSession("refine-5", "running", { agentName: "agent1", sessionId: "sess-abc" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);
    fireEvent.click(getByTestId("active-session-logo"));
    expect(mockNavigate).toHaveBeenCalledWith("/agents?session=agent1:sess-abc");
  });

  it("clicking active-session-logo on a CLOSED ticket navigates to agents view with session key", () => {
    const ticket = makeTicket({ state: "CLOSED", number: 5 });
    const sessions = [
      makeSession("discuss-5", "running", { agentName: "agent1", sessionId: "sess-xyz" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);
    fireEvent.click(getByTestId("active-session-logo"));
    expect(mockNavigate).toHaveBeenCalledWith("/agents?session=agent1:sess-xyz");
  });

  it("clicking active-session-logo on BACKLOG ticket without agentName/sessionId falls back to ticket detail", () => {
    const ticket = makeTicket({ state: "BACKLOG", number: 5 });
    const sessions = [makeSession("refine-5", "running")];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);
    fireEvent.click(getByTestId("active-session-logo"));
    expect(mockNavigate).toHaveBeenCalledWith("/ticket/ticket-1");
  });

  it("clicking active-session-logo on CLOSED ticket without agentName/sessionId falls back to ticket detail", () => {
    const ticket = makeTicket({ state: "CLOSED", number: 5 });
    const sessions = [makeSession("discuss-5", "running")];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);
    fireEvent.click(getByTestId("active-session-logo"));
    expect(mockNavigate).toHaveBeenCalledWith("/ticket/ticket-1");
  });
});

// ---------------------------------------------------------------------------
// TicketCard kill session — button visibility and kill flow
// ---------------------------------------------------------------------------

describe("kill session", () => {
  it("renders kill button when active session is running", () => {
    const ticket = makeTicket({ number: 5 });
    const sessions = [
      makeSession("lead-5", "running", { agentName: "agent1", sessionId: "sess-run" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);
    expect(getByTestId("session-kill-button")).toBeTruthy();
  });

  it("does not render kill button when no active session", () => {
    const ticket = makeTicket({ number: 5 });
    const { queryByTestId } = render(<TicketCard ticket={ticket} sessions={[]} />);
    expect(queryByTestId("session-kill-button")).toBeNull();
  });

  it("does not render kill button when session is destroying", () => {
    const ticket = makeTicket({ number: 5 });
    const sessions = [
      makeSession("lead-5", "destroying", { agentName: "agent1", sessionId: "sess-destroying" }),
    ];
    const { queryByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);
    expect(queryByTestId("session-kill-button")).toBeNull();
  });

  it("clicking kill button opens confirm dialog", () => {
    const ticket = makeTicket({ number: 5 });
    const sessions = [
      makeSession("lead-5", "running", { agentName: "agent1", sessionId: "sess-run" }),
    ];
    const { getByTestId, queryByTestId } = render(
      <TicketCard ticket={ticket} sessions={sessions} />,
    );
    expect(queryByTestId("confirm-dialog")).toBeNull();
    fireEvent.click(getByTestId("session-kill-button"));
    expect(getByTestId("confirm-dialog")).toBeTruthy();
  });

  it("confirming kill calls optimisticSetDestroying and DELETE API", async () => {
    mockHubFetch.mockResolvedValue(undefined);
    const ticket = makeTicket({ number: 5 });
    const sessions = [
      makeSession("lead-5", "running", { agentName: "agent1", sessionId: "sess-kill" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);

    fireEvent.click(getByTestId("session-kill-button"));

    await act(async () => {
      fireEvent.click(getByTestId("confirm-dialog-confirm"));
      await Promise.resolve();
    });

    expect(mockOptimisticSetDestroying).toHaveBeenCalledWith("sess-kill");
    expect(mockHubFetch).toHaveBeenCalledWith(
      expect.stringContaining("sess-kill"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("cancelling kill dialog does not call API", () => {
    const ticket = makeTicket({ number: 5 });
    const sessions = [
      makeSession("lead-5", "running", { agentName: "agent1", sessionId: "sess-cancel" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);

    fireEvent.click(getByTestId("session-kill-button"));
    fireEvent.click(getByTestId("confirm-dialog-cancel"));

    expect(mockHubFetch).not.toHaveBeenCalled();
  });

  it("kill button does not trigger card navigation", () => {
    const ticket = makeTicket({ number: 5 });
    const sessions = [
      makeSession("lead-5", "running", { agentName: "agent1", sessionId: "sess-nav" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);

    fireEvent.click(getByTestId("session-kill-button"));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows error when kill API fails", async () => {
    mockHubFetch.mockRejectedValue(new MockHubError(500, "server error"));

    const ticket = makeTicket({ number: 5 });
    const sessions = [
      makeSession("lead-5", "running", { agentName: "agent1", sessionId: "sess-err" }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);

    fireEvent.click(getByTestId("session-kill-button"));

    await act(async () => {
      fireEvent.click(getByTestId("confirm-dialog-confirm"));
      await Promise.resolve();
    });

    expect(mockOptimisticResetState).toHaveBeenCalledWith("sess-err", "running");
    expect(getByTestId("card-kill-error")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TicketCard visual distinction — kill session vs close ticket buttons
// ---------------------------------------------------------------------------

describe('TicketCard visual distinction: kill session vs close ticket', () => {
  it('session-kill-button uses StopCircle icon and card-close-button uses Archive icon', () => {
    const ticket = makeTicket({ state: 'REFINED', number: 5 });
    const sessions = [
      makeSession('lead-5', 'running', { agentName: 'agent1', sessionId: 'sess-abc' }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);

    // Kill session button contains the StopCircle icon
    const killButton = getByTestId('session-kill-button');
    expect(killButton.querySelector('[data-testid="icon-stop-circle"]')).not.toBeNull();

    // Close ticket button contains the Archive icon
    const closeButton = getByTestId('card-close-button');
    expect(closeButton.querySelector('[data-testid="icon-archive"]')).not.toBeNull();
  });

  it('kill session confirm dialog has distinct title and label from close ticket dialog', () => {
    const ticket = makeTicket({ state: 'REFINED', number: 5 });
    const sessions = [
      makeSession('lead-5', 'running', { agentName: 'agent1', sessionId: 'sess-abc' }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);

    // Open kill session dialog
    fireEvent.click(getByTestId('session-kill-button'));
    const killDialog = getByTestId('confirm-dialog');
    expect(killDialog.dataset.title).toBe('Stop session?');
    expect(killDialog.dataset.confirmLabel).toBe('Stop session');
  });

  it('session-kill-button and card-close-button have different CSS class names', () => {
    const ticket = makeTicket({ state: 'REFINED', number: 5 });
    const sessions = [
      makeSession('lead-5', 'running', { agentName: 'agent1', sessionId: 'sess-abc' }),
    ];
    const { getByTestId } = render(<TicketCard ticket={ticket} sessions={sessions} />);

    const killButton = getByTestId('session-kill-button');
    const closeButton = getByTestId('card-close-button');

    // Each button must use a distinct CSS class so they can be styled differently
    expect(killButton.className).not.toBe(closeButton.className);
  });
});
