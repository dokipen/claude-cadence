import { GraphQLError } from "graphql";

/**
 * Parse the ALLOWED_USERS env var into a Set of lowercase GitHub logins.
 * Returns null if the env var is unset or empty (open access).
 */
export function parseAllowedUsers(
  envValue: string | undefined
): Set<string> | null {
  if (!envValue || envValue.trim() === "") return null;
  const users = new Set(
    envValue
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  );
  return users.size > 0 ? users : null;
}

const allowedUsers = parseAllowedUsers(process.env.ALLOWED_USERS);

export function enforceAllowlist(login: string): void {
  if (allowedUsers === null) return;
  if (!allowedUsers.has(login.toLowerCase())) {
    throw new GraphQLError("User is not authorized to access this application", {
      extensions: { code: "FORBIDDEN" },
    });
  }
}
