// @vitest-environment jsdom

// vi.mock calls must appear before imports — Vitest hoists them
const mockUsePollingQuery = vi.fn();
vi.mock("./usePollingQuery", () => ({
  usePollingQuery: (opts: unknown) => mockUsePollingQuery(opts),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTicket } from "./useTicket";
import { TICKET_DETAIL_QUERY } from "../api/queries";

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

describe("useTicket — id is undefined", () => {
  it("passes null variables to usePollingQuery so no fetch is initiated", () => {
    renderHook(() => useTicket(undefined));

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({ variables: null }),
    );
  });

  it("returns loading: false when id is undefined", () => {
    mockUsePollingQuery.mockReturnValue({ data: null, loading: false, error: null });

    const { result } = renderHook(() => useTicket(undefined));

    expect(result.current.loading).toBe(false);
    expect(result.current.ticket).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe("useTicket — id is provided", () => {
  it("passes the correct query and { id } variables to usePollingQuery", () => {
    renderHook(() => useTicket("ticket-123"));

    expect(mockUsePollingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: TICKET_DETAIL_QUERY,
        variables: { id: "ticket-123" },
      }),
    );
  });
});

describe("useTicket — transform", () => {
  it("extracts ticket from the response object via the transform function", () => {
    const fakeTicket = { id: "ticket-abc", title: "Fix the thing", number: 7 };

    // Capture the transform passed to usePollingQuery and invoke it directly
    let capturedTransform: ((r: unknown) => unknown) | undefined;
    mockUsePollingQuery.mockImplementation((opts: { transform: (r: unknown) => unknown }) => {
      capturedTransform = opts.transform;
      return { data: fakeTicket, loading: false, error: null };
    });

    const { result } = renderHook(() => useTicket("ticket-abc"));

    // Verify the hook surfaces data as `ticket`
    expect(result.current.ticket).toEqual(fakeTicket);

    // Verify the transform extracts ticket from the response envelope
    expect(capturedTransform).toBeDefined();
    const response = { ticket: fakeTicket };
    expect(capturedTransform!(response)).toBe(fakeTicket);
  });
});
