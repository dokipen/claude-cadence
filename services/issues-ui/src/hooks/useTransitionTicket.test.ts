// @vitest-environment jsdom

vi.mock("../api/client", () => ({
  getClient: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTransitionTicket } from "./useTransitionTicket";
import { getClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { TRANSITION_TICKET_MUTATION } from "../api/queries";

const mockGetClient = getClient as ReturnType<typeof vi.fn>;
const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();

  const mockLogout = vi.fn();
  mockUseAuth.mockReturnValue({ logout: mockLogout });

  const mockRequest = vi.fn().mockResolvedValue({
    transitionTicket: { id: "t1", state: "IN_PROGRESS" },
  });
  mockGetClient.mockReturnValue({ request: mockRequest });
});

describe("useTransitionTicket — initial state", () => {
  it("initializes with loading: false and error: null", () => {
    const { result } = renderHook(() => useTransitionTicket());

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useTransitionTicket — loading state during mutation", () => {
  it("sets loading: true while the mutation is in flight", async () => {
    let resolveRequest!: (value: unknown) => void;
    const pendingRequest = new Promise((resolve) => {
      resolveRequest = resolve;
    });

    mockGetClient.mockReturnValue({ request: vi.fn().mockReturnValue(pendingRequest) });

    const { result } = renderHook(() => useTransitionTicket());

    let transitionPromise!: Promise<void>;
    act(() => {
      transitionPromise = result.current.transition("t1", "IN_PROGRESS");
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveRequest({ transitionTicket: { id: "t1", state: "IN_PROGRESS" } });
      await transitionPromise;
    });
  });
});

describe("useTransitionTicket — success", () => {
  it("returns loading: false and error: null after a successful transition", async () => {
    const { result } = renderHook(() => useTransitionTicket());

    await act(async () => {
      await result.current.transition("t1", "IN_PROGRESS");
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useTransitionTicket — failure", () => {
  it("sets error: 'Failed to update ticket' and loading: false when request throws", async () => {
    mockGetClient.mockReturnValue({
      request: vi.fn().mockRejectedValue(new Error("network error")),
    });

    const { result } = renderHook(() => useTransitionTicket());

    await act(async () => {
      await result.current.transition("t1", "IN_PROGRESS").catch(() => {});
    });

    expect(result.current.error).toBe("Failed to update ticket");
    expect(result.current.loading).toBe(false);
  });

  it("rethrows the error so the caller can catch it", async () => {
    const originalError = new Error("network error");
    mockGetClient.mockReturnValue({
      request: vi.fn().mockRejectedValue(originalError),
    });

    const { result } = renderHook(() => useTransitionTicket());

    let caught: unknown;
    await act(async () => {
      await result.current.transition("t1", "IN_PROGRESS").catch((err) => {
        caught = err;
      });
    });

    expect(caught).toBe(originalError);
  });
});

describe("useTransitionTicket — client wiring", () => {
  it("calls getClient with the logout function from useAuth", async () => {
    const mockLogout = vi.fn();
    mockUseAuth.mockReturnValue({ logout: mockLogout });

    const mockRequest = vi.fn().mockResolvedValue({
      transitionTicket: { id: "t1", state: "IN_PROGRESS" },
    });
    mockGetClient.mockReturnValue({ request: mockRequest });

    const { result } = renderHook(() => useTransitionTicket());

    await act(async () => {
      await result.current.transition("t1", "IN_PROGRESS");
    });

    expect(mockGetClient).toHaveBeenCalledWith(mockLogout);
  });

  it("calls client.request with TRANSITION_TICKET_MUTATION and the correct variables", async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      transitionTicket: { id: "t42", state: "CLOSED" },
    });
    mockGetClient.mockReturnValue({ request: mockRequest });

    const { result } = renderHook(() => useTransitionTicket());

    await act(async () => {
      await result.current.transition("t42", "CLOSED");
    });

    expect(mockRequest).toHaveBeenCalledWith(TRANSITION_TICKET_MUTATION, {
      id: "t42",
      to: "CLOSED",
    });
  });
});
