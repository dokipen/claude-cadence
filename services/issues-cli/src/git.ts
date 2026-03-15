import { execSync } from "node:child_process";

/**
 * Extract the repository slug (owner/repo) from the git remote origin URL.
 * Supports both SSH and HTTPS formats:
 *   git@github.com:owner/repo.git  →  owner/repo
 *   https://github.com/owner/repo.git  →  owner/repo
 *   https://github.com/owner/repo  →  owner/repo
 *
 * Returns null if git is not available or no origin remote is configured.
 */
export function getRepoSlugFromOrigin(): string | null {
  let remoteUrl: string;
  try {
    remoteUrl = execSync("git remote get-url origin", {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }

  if (!remoteUrl) return null;

  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/[:\/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  return null;
}
