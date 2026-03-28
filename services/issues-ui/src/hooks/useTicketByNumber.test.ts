// @vitest-environment jsdom

// vi.mock calls must appear before imports — Vitest hoists them
const mockUsePollingQuery = vi.fn();
vi.mock("./usePollingQuery", () => ({
  usePollingQuery: (opts: unknown) => mockUsePollingQuery(opts),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTicketByNumber } from "./useTicketByNumber";
import { TICKET_BY_NUMBER_QUERY } from "../api/queries";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  mockUsePollingQuery.mockReturnValue({ data: null, loading: false, error: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTicketByNumber — projectId is undefined", () => {
  it("passes null variables to usePollingQuery when projectId is undefined", () => {
    renderHook(() => useTicketByNumber(undefined, 42));

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({ variables: null }),
    );
  });
});

describe("useTicketByNumber — number is undefined", () => {
  it("passes null variables to usePollingQuery when number is undefined", () => {
    renderHook(() => useTicketByNumber("proj-1", undefined));

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({ variables: null }),
    );
  });
});

describe("useTicketByNumber — both provided", () => {
  it("passes correct query and { projectId, number } variables to usePollingQuery", () => {
    renderHook(() => useTicketByNumber("proj-1", 99));

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: TICKET_BY_NUMBER_QUERY,
        variables: { projectId: "proj-1", number: 99 },
      }),
    );
  });
});

describe("useTicketByNumber — transform", () => {
  it("extracts ticketByNumber from the response, which may be null", () => {
    const fakeTicket = { id: "ticket-xyz", number: 99, title: "A ticket" };

    let capturedTransform: ((r: unknown) => unknown) | undefined;
    mockUsePollingQuery.mockImplementation((opts: { transform: (r: unknown) => unknown }) => {
      capturedTransform = opts.transform;
      return { data: fakeTicket, loading: false, error: null };
    });

    const { result } = renderHook(() => useTicketByNumber("proj-1", 99));

    // Hook surfaces data as `ticket`
    expect(result.current.ticket).toEqual(fakeTicket);

    // Transform extracts ticketByNumber from response envelope
    expect(capturedTransform).toBeDefined();
    const response = { ticketByNumber: fakeTicket };
    expect(capturedTransform!(response)).toBe(fakeTicket);

    // Transform handles null ticketByNumber
    expect(capturedTransform!({ ticketByNumber: null })).toBeNull();
  });
});
