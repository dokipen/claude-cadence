import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Mock chalk to pass through strings without ANSI codes
vi.mock("chalk", () => ({
  default: {
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

// Mock client.js isAuthError and is429Error
const mockIsAuthError = vi.fn();
const mockIs429Error = vi.fn();
vi.mock("./client.js", () => ({
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
  is429Error: (...args: unknown[]) => mockIs429Error(...args),
}));

const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// Dynamic import after mocks are hoisted
const { handleError } = await import("./errors.js");

describe("handleError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockImplementation(() => undefined as never);
    mockIs429Error.mockReturnValue(false);
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

  it("shows clean rate-limit message for 429 errors", () => {
    mockIs429Error.mockReturnValue(true);
    mockIsAuthError.mockReturnValue(false);
    const error = new Error("rate limited");
    (error as any).response = { errors: [{ message: "Too Many Requests" }] };

    handleError(error);

    const output = mockConsoleError.mock.calls.map(([msg]) => msg).join("\n");
    expect(output).toContain("Rate limit exceeded after retries");
    expect(output).not.toContain("Too Many Requests");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("does not show rate-limit message for non-429 errors", () => {
    mockIs429Error.mockReturnValue(false);
    mockIsAuthError.mockReturnValue(false);

    handleError(new Error("Something else"));

    const output = mockConsoleError.mock.calls.map(([msg]) => msg).join("\n");
    expect(output).not.toContain("Rate limit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
