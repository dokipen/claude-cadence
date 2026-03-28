// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock CSS modules
vi.mock("../styles/board.module.css", () => ({ default: {} }));

// Mock useTickets to avoid deep dependency chains (GraphQL, polling, etc.)
vi.mock("../hooks/useTickets", () => ({
  useTickets: () => ({
    tickets: [],
    totalCount: 0,
    hasNextPage: false,
    loading: false,
    error: null,
  }),
}));

// Mock KanbanColumn so tests focus on KanbanBoard orchestration only
vi.mock("./KanbanColumn", () => ({
  KanbanColumn: ({ state }: { state: string }) => (
    <div data-testid="kanban-column" data-state={state} />
  ),
}));

import { KanbanBoard } from "./KanbanBoard";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("KanbanBoard", () => {
  it("renders 'Select a project' placeholder when projectId is null", () => {
    render(<KanbanBoard projectId={null} />);
    expect(screen.getByText("Select a project to view the board")).toBeTruthy();
  });

  it("does not render the board container when projectId is null", () => {
    render(<KanbanBoard projectId={null} />);
    expect(screen.queryByTestId("kanban-board")).toBeNull();
  });

  it("renders the kanban board container when projectId is provided", () => {
    render(<KanbanBoard projectId="my-project" />);
    expect(screen.getByTestId("kanban-board")).toBeTruthy();
  });

  it("renders 4 columns (BACKLOG, REFINED, IN_PROGRESS, CLOSED) when projectId is provided", () => {
    render(<KanbanBoard projectId="my-project" />);
    const columns = screen.getAllByTestId("kanban-column");
    expect(columns).toHaveLength(4);
    const states = columns.map((col) => col.getAttribute("data-state"));
    expect(states).toEqual(["BACKLOG", "REFINED", "IN_PROGRESS", "CLOSED"]);
  });
});
