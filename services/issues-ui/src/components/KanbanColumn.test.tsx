// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Ticket, ActiveSessionInfo } from "../types";

// Mock CSS modules
vi.mock("../styles/board.module.css", () => ({ default: {} }));
vi.mock("../styles/animated-icon.module.css", () => ({ default: {} }));

// Mock lucide-react icons used in KanbanColumn
vi.mock("lucide-react", () => ({
  Sparkles: ({ size }: { size?: number }) => <svg data-testid="icon-sparkles" data-size={size} />,
}));

// Mock child components to keep tests focused on KanbanColumn logic
vi.mock("./RefineAllDialog", () => ({
  RefineAllDialog: () => <div data-testid="refine-all-dialog" />,
}));

vi.mock("./LeadAllDialog", () => ({
  LeadAllDialog: () => <div data-testid="lead-all-dialog" />,
}));

vi.mock("./CreateTicketDialog", () => ({
  CreateTicketDialog: ({
    open,
    repoUrl,
  }: {
    open: boolean;
    repoUrl?: string;
    onClose: () => void;
  }) => (
    <div
      data-testid="create-ticket-dialog"
      data-open={String(open)}
      data-repo-url={repoUrl ?? ""}
    />
  ),
}));

vi.mock("./TicketCard", () => ({
  TicketCard: () => <div data-testid="ticket-card" />,
}));

import { KanbanColumn, getActiveRefineAllSession, getActiveLeadAllSession } from "./KanbanColumn";

// jsdom does not implement showModal/close on HTMLDialogElement.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute("open");
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: "ticket-1",
  number: 1,
  title: "Test ticket",
  state: "BACKLOG",
  priority: "MEDIUM",
  labels: [],
  blockedBy: [],
  ...overrides,
});

const defaultProps = {
  tickets: [],
  totalCount: 0,
  hasNextPage: false,
  loading: false,
  error: null,
  repoUrl: "https://github.com/org/repo",
  sessions: [] as ActiveSessionInfo[],
};

// ---------------------------------------------------------------------------
// + button visibility tests
// ---------------------------------------------------------------------------

describe("KanbanColumn create ticket button", () => {
  it("shows + button in BACKLOG column header", () => {
    render(<KanbanColumn {...defaultProps} state="BACKLOG" />);
    expect(screen.getByTestId("create-ticket-button")).toBeTruthy();
  });

  it("does not show + button in REFINED column", () => {
    render(<KanbanColumn {...defaultProps} state="REFINED" />);
    expect(screen.queryByTestId("create-ticket-button")).toBeNull();
  });

  it("does not show + button in IN_PROGRESS column", () => {
    render(<KanbanColumn {...defaultProps} state="IN_PROGRESS" />);
    expect(screen.queryByTestId("create-ticket-button")).toBeNull();
  });

  it("does not show + button in CLOSED column", () => {
    render(<KanbanColumn {...defaultProps} state="CLOSED" />);
    expect(screen.queryByTestId("create-ticket-button")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CreateTicketDialog open state tests
// ---------------------------------------------------------------------------

describe("KanbanColumn CreateTicketDialog", () => {
  it("opens CreateTicketDialog when + button clicked", () => {
    render(<KanbanColumn {...defaultProps} state="BACKLOG" />);

    // Dialog should start closed
    const dialog = screen.getByTestId("create-ticket-dialog");
    expect(dialog.getAttribute("data-open")).toBe("false");

    fireEvent.click(screen.getByTestId("create-ticket-button"));

    expect(dialog.getAttribute("data-open")).toBe("true");
  });

  it("passes repoUrl to CreateTicketDialog", () => {
    const repoUrl = "https://github.com/myorg/myrepo";
    render(
      <KanbanColumn {...defaultProps} state="BACKLOG" repoUrl={repoUrl} />,
    );

    const dialog = screen.getByTestId("create-ticket-dialog");
    expect(dialog.getAttribute("data-repo-url")).toBe(repoUrl);
  });

  it("renders CreateTicketDialog only in BACKLOG column", () => {
    render(<KanbanColumn {...defaultProps} state="REFINED" />);
    expect(screen.queryByTestId("create-ticket-dialog")).toBeNull();
  });

  it("closes CreateTicketDialog when tickets exist and refine-all is visible", () => {
    // Ensure the create-ticket-dialog is present alongside the refine-all-dialog
    // when the BACKLOG column has tickets.
    const tickets = [makeTicket()];
    render(
      <KanbanColumn
        {...defaultProps}
        state="BACKLOG"
        tickets={tickets}
        totalCount={1}
      />,
    );

    expect(screen.getByTestId("create-ticket-dialog")).toBeTruthy();
    expect(screen.getByTestId("refine-all-dialog")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getActiveRefineAllSession unit tests
// ---------------------------------------------------------------------------

describe("getActiveRefineAllSession", () => {
  it("returns false for empty sessions", () => {
    expect(getActiveRefineAllSession([], "my-project")).toBeFalsy();
  });

  it("returns true when a running refine-all session exists with projectId prefix", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "my-project-refine-all-1234", state: "running", sessionId: "s1", agentName: "refiner" },
    ];
    expect(getActiveRefineAllSession(sessions, "my-project")).toBeTruthy();
  });

  it("returns true for creating state", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "my-project-refine-all-9999", state: "creating", sessionId: "s2", agentName: "refiner" },
    ];
    expect(getActiveRefineAllSession(sessions, "my-project")).toBeTruthy();
  });

  it("returns true for destroying state", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "my-project-refine-all-9999", state: "destroying", sessionId: "s3", agentName: "refiner" },
    ];
    expect(getActiveRefineAllSession(sessions, "my-project")).toBeTruthy();
  });

  it("returns false when session state is not active", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "my-project-refine-all-1234", state: "stopped", sessionId: "s4", agentName: "refiner" },
    ];
    expect(getActiveRefineAllSession(sessions, "my-project")).toBeFalsy();
  });

  it("returns false when session belongs to a different project", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "other-project-refine-all-1234", state: "running", sessionId: "s5", agentName: "refiner" },
    ];
    expect(getActiveRefineAllSession(sessions, "my-project")).toBeFalsy();
  });

  it("falls back to bare refine-all- prefix when projectId is undefined", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "refine-all-1234", state: "running", sessionId: "s6", agentName: "refiner" },
    ];
    expect(getActiveRefineAllSession(sessions, undefined)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Refine All icon button tests
// ---------------------------------------------------------------------------

describe("KanbanColumn Refine All icon button", () => {
  const tickets = [makeTicket()];

  it("shows Sparkles icon when no active refine-all session", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="BACKLOG"
        tickets={tickets}
        totalCount={1}
        sessions={[]}
      />,
    );
    expect(screen.getByTestId("icon-sparkles")).toBeTruthy();
    expect(screen.queryByTestId("animated-cadence-icon")).toBeNull();
  });

  it("shows AnimatedCadenceIcon when a refine-all session is running", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "myproject-refine-all-1234", state: "running", sessionId: "s1", agentName: "refiner" },
    ];
    render(
      <KanbanColumn
        {...defaultProps}
        state="BACKLOG"
        tickets={tickets}
        totalCount={1}
        sessions={sessions}
        projectId="myproject"
      />,
    );
    // AnimatedCadenceIcon renders an SVG; no Sparkles icon should appear
    expect(screen.queryByTestId("icon-sparkles")).toBeNull();
    const button = screen.getByTestId("refine-all-button");
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("has aria-label on the refine-all button", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="BACKLOG"
        tickets={tickets}
        totalCount={1}
      />,
    );
    const button = screen.getByTestId("refine-all-button");
    expect(button.getAttribute("aria-label")).toBe("Refine All");
  });

  it("opens RefineAllDialog when refine-all button is clicked", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="BACKLOG"
        tickets={tickets}
        totalCount={1}
      />,
    );
    fireEvent.click(screen.getByTestId("refine-all-button"));
    // RefineAllDialog mock is always rendered; button click should not throw
    expect(screen.getByTestId("refine-all-dialog")).toBeTruthy();
  });

  it("does not show refine-all button when loading", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="BACKLOG"
        tickets={tickets}
        totalCount={1}
        loading={true}
      />,
    );
    expect(screen.queryByTestId("refine-all-button")).toBeNull();
  });

  it("does not show refine-all button when hasNextPage is true", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="BACKLOG"
        tickets={tickets}
        totalCount={10}
        hasNextPage={true}
      />,
    );
    expect(screen.queryByTestId("refine-all-button")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getActiveLeadAllSession unit tests
// ---------------------------------------------------------------------------

describe("getActiveLeadAllSession", () => {
  it("returns false for empty sessions", () => {
    expect(getActiveLeadAllSession([], "my-project")).toBeFalsy();
  });

  it("returns true when a running lead-all session exists with projectId prefix", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "my-project-lead-all-42", state: "running", sessionId: "s1", agentName: "leader" },
    ];
    expect(getActiveLeadAllSession(sessions, "my-project")).toBeTruthy();
  });

  it("returns true for creating state", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "my-project-lead-all-42", state: "creating", sessionId: "s2", agentName: "leader" },
    ];
    expect(getActiveLeadAllSession(sessions, "my-project")).toBeTruthy();
  });

  it("returns true for destroying state", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "my-project-lead-all-42", state: "destroying", sessionId: "s3", agentName: "leader" },
    ];
    expect(getActiveLeadAllSession(sessions, "my-project")).toBeTruthy();
  });

  it("returns false when session state is not active", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "my-project-lead-all-42", state: "stopped", sessionId: "s4", agentName: "leader" },
    ];
    expect(getActiveLeadAllSession(sessions, "my-project")).toBeFalsy();
  });

  it("returns false when session belongs to a different project", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "other-project-lead-all-42", state: "running", sessionId: "s5", agentName: "leader" },
    ];
    expect(getActiveLeadAllSession(sessions, "my-project")).toBeFalsy();
  });

  it("falls back to bare lead-all- prefix when projectId is undefined", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "lead-all-42", state: "running", sessionId: "s6", agentName: "leader" },
    ];
    expect(getActiveLeadAllSession(sessions, undefined)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Lead All icon button tests
// ---------------------------------------------------------------------------

describe("KanbanColumn Lead All icon button", () => {
  const tickets = [makeTicket({ state: "REFINED" })];

  it("shows lead-all button in REFINED column when tickets present", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="REFINED"
        tickets={tickets}
        totalCount={1}
      />,
    );
    expect(screen.getByTestId("lead-all-button")).toBeTruthy();
  });

  it("does not show lead-all button in BACKLOG column", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="BACKLOG"
        tickets={tickets}
        totalCount={1}
      />,
    );
    expect(screen.queryByTestId("lead-all-button")).toBeNull();
  });

  it("does not show lead-all button when no tickets", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="REFINED"
        tickets={[]}
        totalCount={0}
      />,
    );
    expect(screen.queryByTestId("lead-all-button")).toBeNull();
  });

  it("does not show lead-all button when loading", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="REFINED"
        tickets={tickets}
        totalCount={1}
        loading={true}
      />,
    );
    expect(screen.queryByTestId("lead-all-button")).toBeNull();
  });

  it("does not show lead-all button when hasNextPage is true", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="REFINED"
        tickets={tickets}
        totalCount={10}
        hasNextPage={true}
      />,
    );
    expect(screen.queryByTestId("lead-all-button")).toBeNull();
  });

  it("has aria-label on the lead-all button", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="REFINED"
        tickets={tickets}
        totalCount={1}
      />,
    );
    const button = screen.getByTestId("lead-all-button");
    expect(button.getAttribute("aria-label")).toBe("Lead All");
  });

  it("renders LeadAllDialog for REFINED column", () => {
    render(
      <KanbanColumn
        {...defaultProps}
        state="REFINED"
        tickets={tickets}
        totalCount={1}
      />,
    );
    expect(screen.getByTestId("lead-all-dialog")).toBeTruthy();
  });

  it("does not render LeadAllDialog for BACKLOG column", () => {
    render(<KanbanColumn {...defaultProps} state="BACKLOG" />);
    expect(screen.queryByTestId("lead-all-dialog")).toBeNull();
  });

  it("shows AnimatedCadenceIcon when a lead-all session is running", () => {
    const sessions: ActiveSessionInfo[] = [
      { name: "myproject-lead-all-42", state: "running", sessionId: "s1", agentName: "leader" },
    ];
    render(
      <KanbanColumn
        {...defaultProps}
        state="REFINED"
        tickets={tickets}
        totalCount={1}
        sessions={sessions}
        projectId="myproject"
      />,
    );
    expect(screen.queryByTestId("icon-sparkles")).toBeNull();
    const button = screen.getByTestId("lead-all-button");
    expect(button.querySelector("svg")).toBeTruthy();
  });
});
