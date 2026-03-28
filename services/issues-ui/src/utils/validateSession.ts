/**
 * Validates that a session ID matches the expected CUID/alphanumeric format.
 * Accepts CUIDs, CUID2, and alphanumeric-with-hyphens formats used by the server.
 */
export function validateSessionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/**
 * Validates that an agent profile name matches a safe-string pattern.
 * Only allows alphanumeric characters, underscores, dots, hyphens, and colons.
 */
export function validateAgentProfile(profile: string): boolean {
  return /^[a-zA-Z0-9_.:-]{1,64}$/.test(profile);
}
