/**
 * Validates that a redirect target is a safe relative path.
 * Returns the path if valid, or "/" as a fallback.
 */
export function validateRedirect(redirect: string | null): string {
  if (!redirect) return "/";
  // Must start with "/" but not "//" (protocol-relative)
  if (!redirect.startsWith("/") || redirect.startsWith("//")) return "/";
  return redirect;
}
