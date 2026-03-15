import { execSync } from "node:child_process";

const VALID_SLUG = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

/**
 * Extract the repository slug (owner/repo) from the git remote origin URL.
 * Supports both SSH and HTTPS formats:
 *   git@github.com:owner/repo.git  →  owner/repo
 *   https://github.com/owner/repo.git  →  owner/repo
 *   https://github.com/owner/repo  →  owner/repo
 *   https://github.com/owner/repo/  →  owner/repo
 *
 * Returns null if git is not available, no origin remote is configured,
 * or the extracted slug contains unexpected characters.
 */
export function getRepoSlugFromOrigin(): string | null {
  let remoteUrl: string;
  try {
    remoteUrl = execSync("git remote get-url origin", {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }

  if (!remoteUrl) return null;

  // Strip trailing slash before matching
  const normalized = remoteUrl.replace(/\/+$/, "");

  // Match owner/repo from SSH (git@host:owner/repo) or HTTPS (https://host/owner/repo) URLs
  const match = normalized.match(/[:\/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (!match) return null;

  const slug = match[1];
  if (!VALID_SLUG.test(slug)) return null;

  return slug;
}
