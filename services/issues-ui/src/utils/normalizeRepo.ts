/**
 * Extract "owner/repo" slug from a GitHub repo reference.
 *
 * Handles:
 * - HTTPS:  https://github.com/owner/repo[.git]
 * - HTTP:   http://github.com/owner/repo[.git]
 * - SSH:    git@github.com:owner/repo[.git]
 *
 * Non-GitHub hosts are returned as-is (minus any trailing .git).
 *
 * Before matching, the input is trimmed, lowercased, and stripped of a
 * trailing slash so that differently-cased or whitespace/slash-padded
 * representations of the same repo compare equal.
 *
 * @returns A plain "owner/repo" slug for GitHub URLs, or the input (minus
 *   .git) for other inputs. Do not render the return value as HTML or use it
 *   as a URL without further validation.
 */
export function normalizeRepo(repo: string | undefined): string {
  if (!repo) return "";
  return repo
    .trim()
    .toLowerCase()
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "") // SSH: git@github.com:owner/repo
    .replace(/^https?:\/\/github\.com\//, ""); // HTTPS/HTTP: https://github.com/owner/repo
}
