// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTickets } from "./useTickets";
import type { Ticket } from "../types";

vi.mock("./usePollingQuery", () => ({
  usePollingQuery: vi.fn(),
}));

import { usePollingQuery } from "./usePollingQuery";

const mockUsePollingQuery = usePollingQuery as ReturnType<typeof vi.fn>;

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: "t1",
  number: 1,
  title: "Test ticket",
  state: "BACKLOG",
  priority: "MEDIUM",
  labels: [],
  blockedBy: [],
  ...overrides,
});

beforeEach(() => {
  mockUsePollingQuery.mockClear();
  mockUsePollingQuery.mockReturnValue({
    data: { tickets: [], totalCount: 0, hasNextPage: false },
    loading: false,
    error: null,
  });
});

describe("useTickets — server-side variable passing", () => {
  it("passes excludeLabelName to usePollingQuery variables when provided in filters", () => {
    renderHook(() =>
      useTickets("BACKLOG", "project-1", 50, { excludeLabelName: "bug" }),
    );

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({ excludeLabelName: "bug" }),
      }),
    );
  });

  it("passes excludePriority to usePollingQuery variables when provided in filters", () => {
    renderHook(() =>
      useTickets("BACKLOG", "project-1", 50, { excludePriority: "LOW" }),
    );

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({ excludePriority: "LOW" }),
      }),
    );
  });

  it("passes both excludeLabelName and excludePriority together", () => {
    renderHook(() =>
      useTickets("BACKLOG", "project-1", 50, {
        excludeLabelName: "bug",
        excludePriority: "LOW",
      }),
    );

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          excludeLabelName: "bug",
          excludePriority: "LOW",
        }),
      }),
    );
  });

  it("omits excludeLabelName from variables when not provided", () => {
    renderHook(() => useTickets("BACKLOG", "project-1", 50, {}));

    const call = mockUsePollingQuery.mock.calls[0][0];
    expect(call.variables?.excludeLabelName).toBeUndefined();
  });

  it("omits excludePriority from variables when not provided", () => {
    renderHook(() => useTickets("BACKLOG", "project-1", 50, {}));

    const call = mockUsePollingQuery.mock.calls[0][0];
    expect(call.variables?.excludePriority).toBeUndefined();
  });
});

describe("useTickets — no client-side filtering", () => {
  it("returns tickets from server response as-is (no client-side label filtering)", () => {
    const bugTicket = makeTicket({
      id: "t1",
      labels: [{ id: "l1", name: "bug", color: "#f00" }],
    });
    const featureTicket = makeTicket({
      id: "t2",
      labels: [{ id: "l2", name: "feature", color: "#0f0" }],
    });

    mockUsePollingQuery.mockReturnValue({
      data: {
        tickets: [bugTicket, featureTicket],
        totalCount: 2,
        hasNextPage: false,
      },
      loading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useTickets("BACKLOG", "project-1", 50, { excludeLabelName: "bug" }),
    );

    // Both tickets returned as-is; server handles the exclusion
    expect(result.current.tickets).toHaveLength(2);
    expect(result.current.tickets).toEqual([bugTicket, featureTicket]);
  });

  it("returns tickets from server response as-is (no client-side priority filtering)", () => {
    const lowTicket = makeTicket({ id: "t1", priority: "LOW" });
    const highTicket = makeTicket({ id: "t2", priority: "HIGH" });

    mockUsePollingQuery.mockReturnValue({
      data: {
        tickets: [lowTicket, highTicket],
        totalCount: 2,
        hasNextPage: false,
      },
      loading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useTickets("BACKLOG", "project-1", 50, { excludePriority: "LOW" }),
    );

    // Both tickets returned as-is; server handles the exclusion
    expect(result.current.tickets).toHaveLength(2);
    expect(result.current.tickets).toEqual([lowTicket, highTicket]);
  });

  it("returns totalCount directly from server response", () => {
    const tickets = [makeTicket({ id: "t1" }), makeTicket({ id: "t2" })];

    mockUsePollingQuery.mockReturnValue({
      data: { tickets, totalCount: 42, hasNextPage: false },
      loading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useTickets("BACKLOG", "project-1", 50, { excludeLabelName: "bug" }),
    );

    expect(result.current.totalCount).toBe(42);
  });

  it("returns an empty array when no tickets are in server response", () => {
    mockUsePollingQuery.mockReturnValue({
      data: { tickets: [], totalCount: 0, hasNextPage: false },
      loading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useTickets("BACKLOG", "project-1", 50, { excludeLabelName: "bug" }),
    );

    expect(result.current.tickets).toEqual([]);
    expect(result.current.totalCount).toBe(0);
  });
});

describe("useTickets — variables when projectId is null", () => {
  it("passes null variables to usePollingQuery when projectId is null", () => {
    renderHook(() => useTickets("BACKLOG", null, 50, { excludeLabelName: "bug" }));

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({ variables: null }),
    );
  });
});

describe("useTickets — empty string coercion", () => {
  it("coerces excludeLabelName empty string to undefined in variables", () => {
    renderHook(() =>
      useTickets("BACKLOG", "project-1", 50, { excludeLabelName: "" }),
    );

    const call = mockUsePollingQuery.mock.calls[0][0];
    expect(call.variables?.excludeLabelName).toBeUndefined();
  });
});

describe("useTickets — hasNextPage passthrough", () => {
  it("returns hasNextPage: true when server response includes hasNextPage: true", () => {
    const tickets = [makeTicket({ id: "t1" }), makeTicket({ id: "t2" })];

    mockUsePollingQuery.mockReturnValue({
      data: { tickets, totalCount: 5, hasNextPage: true },
      loading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useTickets("BACKLOG", "project-1", 2, {}),
    );

    expect(result.current.hasNextPage).toBe(true);
  });
});
