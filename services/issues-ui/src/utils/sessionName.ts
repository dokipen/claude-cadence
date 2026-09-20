import { normalizeRepo } from "../hooks/useAgents";

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

export type SessionKind = "lead" | "refine" | "discuss";

export interface ParsedSessionName {
  projectId?: string;
  kind?: SessionKind;
  ticketNumber?: number;
}

const TICKET_SESSION_RE = /(?:^|-)(lead|refine|discuss)-(\d+)$/;

/**
 * Parse a session name into its optional project prefix and ticket reference.
 * Names that are not ticket sessions (e.g. `refine-all-*`, `resume-*`,
 * `<profile>-<uuid>`) yield no `kind`/`ticketNumber`.
 */
export function parseSessionName(name: string): ParsedSessionName {
  const hasPrefix = name.length > 26 && name[25] === "-";
  const projectId = hasPrefix ? name.slice(0, 25) : undefined;
  const match = stripProjectPrefix(name).match(TICKET_SESSION_RE);
  if (!match) return projectId ? { projectId } : {};
  return {
    ...(projectId ? { projectId } : {}),
    kind: match[1] as SessionKind,
    ticketNumber: Number(match[2]),
  };
}

/**
 * Whether a session belongs to the given ticket. The ticket number must match;
 * a prefixed name must carry the ticket's project id; an unprefixed name
 * matches when the session's repo equals the project's repository, or when no
 * project repository is known.
 */
export function sessionMatchesTicket(
  session: { name: string; repoUrl?: string },
  ticketNumber: number,
  projectId?: string,
  projectRepoUrl?: string,
): boolean {
  const parsed = parseSessionName(session.name);
  if (parsed.ticketNumber !== ticketNumber) return false;
  if (parsed.projectId) return !projectId || parsed.projectId === projectId;
  if (!projectRepoUrl) return true;
  return !!session.repoUrl && normalizeRepo(session.repoUrl) === normalizeRepo(projectRepoUrl);
}
