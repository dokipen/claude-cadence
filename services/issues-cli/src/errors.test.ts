import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Mock process.exit to prevent test runner from exiting
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const { handleError } = await import("./errors.js");

describe("handleError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockImplementation(() => undefined as never);
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
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
