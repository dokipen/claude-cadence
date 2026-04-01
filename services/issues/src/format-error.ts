import type { GraphQLFormattedError } from "graphql";
import { isProduction } from "./env.js";

// Error codes whose messages pass through to clients verbatim in production.
// Only add codes here when all messages using that code are static strings.
const KNOWN_ERROR_CODES = new Set([
  "BAD_USER_INPUT",
  "NOT_FOUND",
  "CONFLICT",
  "FORBIDDEN",
  "UNAUTHENTICATED",
]);

export function formatError(
  formattedError: GraphQLFormattedError,
): GraphQLFormattedError {
  const code = formattedError.extensions?.code as string | undefined;

  if (code && KNOWN_ERROR_CODES.has(code)) {
    return formattedError;
  }

  if (isProduction) {
    // Strip stacktrace from extensions — it contains internal file paths and
    // throw locations that must not be sent to clients in production.
    const extensions = formattedError.extensions
      ? (Object.fromEntries(
          Object.entries(formattedError.extensions).filter(([key]) => key !== "stacktrace")
        ) as typeof formattedError.extensions)
      : formattedError.extensions;
    return {
      ...formattedError,
      message: "Internal server error",
      extensions,
    };
  }

  return formattedError;
}
