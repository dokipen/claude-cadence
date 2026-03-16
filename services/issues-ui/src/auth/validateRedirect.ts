/**
 * Validates that a redirect target is a safe relative path.
 * Returns the path if valid, or "/" as a fallback.
 */
export function validateRedirect(redirect: string | null): string {
  if (!redirect) return "/";
  // Decode to catch encoded bypass attempts (e.g. /%2Fevil.com)
  let decoded: string;
  try {
    decoded = decodeURIComponent(redirect);
  } catch {
    return "/";
  }
  // Must start with "/" but not "//" (protocol-relative)
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return "/";
  return decoded;
}
