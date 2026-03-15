import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Mock chalk to pass through strings without ANSI codes
vi.mock("chalk", () => ({
  default: {
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

// Mock client.js isAuthError
const mockIsAuthError = vi.fn();
vi.mock("./client.js", () => ({
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));

const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// Dynamic import after mocks are hoisted
const { handleError } = await import("./errors.js");

describe("handleError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockImplementation(() => undefined as never);
  });

  afterAll(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it("shows re-auth hint for auth errors", () => {
    mockIsAuthError.mockReturnValue(true);
    const error = new Error("Authentication required");
    (error as any).response = { errors: [{ message: "Authentication required" }] };

    handleError(error);

    const output = mockConsoleError.mock.calls.map(([msg]) => msg).join("\n");
    expect(output).toContain("Authentication required");
    expect(output).toContain("issues auth login");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("does not show re-auth hint for non-auth errors", () => {
    mockIsAuthError.mockReturnValue(false);

    handleError(new Error("Something else"));

    const output = mockConsoleError.mock.calls.map(([msg]) => msg).join("\n");
    expect(output).not.toContain("issues auth login");
    expect(output).toContain("Something else");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("shows generic message for non-Error values", () => {
    mockIsAuthError.mockReturnValue(false);

    handleError("string error");

    const output = mockConsoleError.mock.calls.map(([msg]) => msg).join("\n");
    expect(output).toContain("An unexpected error occurred");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("shows GraphQL error messages for Error with response.errors", () => {
    mockIsAuthError.mockReturnValue(false);
    const error = new Error("request failed");
    (error as any).response = { errors: [{ message: "Not found" }, { message: "Invalid input" }] };

    handleError(error);

    const output = mockConsoleError.mock.calls.map(([msg]) => msg).join("\n");
    expect(output).toContain("Not found");
    expect(output).toContain("Invalid input");
  });

  it("shows error.message for Error without response.errors", () => {
    mockIsAuthError.mockReturnValue(false);

    handleError(new Error("Network timeout"));

    const output = mockConsoleError.mock.calls.map(([msg]) => msg).join("\n");
    expect(output).toContain("Network timeout");
  });
});
