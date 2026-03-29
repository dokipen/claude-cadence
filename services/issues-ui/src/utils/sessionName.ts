// Session names are formatted as "{projectId}-{sessionName}" where projectId is a 25-char CUID.
// Strip the prefix for display; preserve the full name for internal API usage.
export function stripProjectPrefix(name: string): string {
  if (name.length > 26 && name[25] === "-") {
    return name.slice(26);
  }
  return name;
}

/**
 * Normalize a user-supplied session name to a valid session identifier.
 * - Lowercases the input
 * - Replaces any character outside [a-z0-9_-] with a hyphen
 * - Collapses consecutive hyphens into one
 * - Strips leading characters that are not alphanumeric (the server requires
 *   the first character to be [a-zA-Z0-9])
 * - Strips trailing hyphens and underscores
 * Returns an empty string if no valid characters remain.
 */
export function normalizeSessionName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-_]+$/, "");
}
