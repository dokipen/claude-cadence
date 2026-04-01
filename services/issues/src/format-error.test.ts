import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GraphQLFormattedError } from "graphql";

/**
 * Helper: imports formatError with a fresh module graph so the
 * module-level isProduction value picks up the mocked env value.
 */
async function loadFormatError(isProduction: boolean) {
  vi.doMock("./env.js", () => ({ isProduction }));
  const { formatError } = await import("./format-error.js");
  return formatError;
}

function makeError(
  message: string,
  code?: string,
): GraphQLFormattedError {
  return {
    message,
    extensions: code ? { code } : undefined,
  };
}

describe("formatError", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("known error codes always pass through unchanged", () => {
    const knownCodes = [
      "BAD_USER_INPUT",
      "NOT_FOUND",
      "CONFLICT",
      "FORBIDDEN",
      "UNAUTHENTICATED",
    ];

    for (const code of knownCodes) {
      it(`passes through errors with code ${code} in production`, async () => {
        const formatError = await loadFormatError(true);
        const error = makeError("Something went wrong", code);
        expect(formatError(error)).toBe(error);
      });

      it(`passes through errors with code ${code} in non-production`, async () => {
        const formatError = await loadFormatError(false);
        const error = makeError("Something went wrong", code);
        expect(formatError(error)).toBe(error);
      });
    }
  });

  describe("INTERNAL_SERVER_ERROR code", () => {
    it("masks the message in production", async () => {
      const formatError = await loadFormatError(true);
      const error = makeError("Detailed internal error", "INTERNAL_SERVER_ERROR");
      const result = formatError(error);
      expect(result.message).toBe("Internal server error");
    });

    it("preserves the message in non-production", async () => {
      const formatError = await loadFormatError(false);
      const error = makeError("Detailed internal error", "INTERNAL_SERVER_ERROR");
      const result = formatError(error);
      expect(result.message).toBe("Detailed internal error");
      expect(result).toBe(error);
    });
  });

  describe("errors without a code", () => {
    it("masks the message in production", async () => {
      const formatError = await loadFormatError(true);
      const error = makeError("Database connection failed");
      const result = formatError(error);
      expect(result.message).toBe("Internal server error");
    });

    it("preserves the message in non-production", async () => {
      const formatError = await loadFormatError(false);
      const error = makeError("Database connection failed");
      const result = formatError(error);
      expect(result.message).toBe("Database connection failed");
      expect(result).toBe(error);
    });
  });

  describe("masked errors in production retain other fields", () => {
    it("preserves non-stacktrace extensions and locations when masking", async () => {
      const formatError = await loadFormatError(true);
      const error: GraphQLFormattedError = {
        message: "Secret internal detail",
        extensions: { code: "INTERNAL_SERVER_ERROR", traceId: "abc123" },
        locations: [{ line: 1, column: 5 }],
        path: ["someField"],
      };
      const result = formatError(error);
      expect(result.message).toBe("Internal server error");
      expect(result.extensions).toEqual(error.extensions);
      expect(result.locations).toEqual(error.locations);
      expect(result.path).toEqual(error.path);
    });

    it("strips stacktrace from extensions in production", async () => {
      const formatError = await loadFormatError(true);
      const error: GraphQLFormattedError = {
        message: "Secret internal detail",
        extensions: {
          code: "INTERNAL_SERVER_ERROR",
          stacktrace: [
            "GraphQLError: Failed to create ticket",
            " at Object.createTicket (file:///app/dist/src/schema/resolvers/ticket.js:236:27)",
          ],
        },
      };
      const result = formatError(error);
      expect(result.message).toBe("Internal server error");
      expect(result.extensions).not.toHaveProperty("stacktrace");
      expect(result.extensions).toEqual({ code: "INTERNAL_SERVER_ERROR" });
    });

    it("preserves stacktrace in non-production", async () => {
      const formatError = await loadFormatError(false);
      const error: GraphQLFormattedError = {
        message: "Failed to create ticket",
        extensions: {
          code: "INTERNAL_SERVER_ERROR",
          stacktrace: ["GraphQLError: Failed to create ticket"],
        },
      };
      const result = formatError(error);
      expect(result.message).toBe("Failed to create ticket");
      expect(result.extensions).toHaveProperty("stacktrace");
    });
  });
});
