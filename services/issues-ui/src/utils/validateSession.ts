/**
 * Validates that a session ID is safe to use in createSession extra_args and URLs.
 * Accepts the full range of server-generated IDs (CUIDs, CUID2, short slugs like
 * "sess-1") — intentionally a broad safe-characters allowlist rather than a strict
 * CUID format check, so it stays valid across server ID scheme changes.
 */
export function validateSessionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/**
 * Validates that an agent profile name is safe to pass to createSession.
 * Colons are permitted for profile namespacing (e.g. "agent:local").
 */
export function validateAgentProfile(profile: string): boolean {
  return /^[a-zA-Z0-9_.:-]{1,64}$/.test(profile);
}
