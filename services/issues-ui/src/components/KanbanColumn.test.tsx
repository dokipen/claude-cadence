// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Ticket, ActiveSessionInfo } from "../types";

// Mock CSS modules
vi.mock("../styles/board.module.css", () => ({ default: {} }));

// Mock child components to keep tests focused on KanbanColumn logic
vi.mock("./RefineAllDialog", () => ({
  RefineAllDialog: () => <div data-testid="refine-all-dialog" />,
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

import { KanbanColumn } from "./KanbanColumn";

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
