import type { GraphQLFormattedError } from "graphql";
import { isProduction } from "./env.js";

const KNOWN_ERROR_CODES = new Set([
  "BAD_USER_INPUT",
  "NOT_FOUND",
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
    return {
      ...formattedError,
      message: "Internal server error",
    };
  }

  return formattedError;
}
