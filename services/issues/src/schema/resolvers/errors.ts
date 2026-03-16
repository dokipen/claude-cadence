import { GraphQLError } from "graphql";

/** Re-throw application errors with their original message; wrap unknown/database errors generically. */
export function rethrowOrWrap(error: unknown, fallbackMessage: string, logPrefix: string): never {
  if (error instanceof GraphQLError) throw error;
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`${logPrefix}:`, msg);
  // Prisma errors carry a `code` property (e.g. P2002); plain validation errors don't.
  const code = (error as { code?: string }).code;
  if (code && /^P\d{4}$/.test(code)) {
    throw new GraphQLError(fallbackMessage, { extensions: { code: "INTERNAL_SERVER_ERROR" } });
  }
  throw new GraphQLError(msg, { extensions: { code: "BAD_REQUEST" } });
}
