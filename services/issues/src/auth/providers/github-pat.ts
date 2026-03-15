import { Octokit } from "@octokit/rest";
import type { AuthProvider, GitHubUserProfile } from "../types.js";

export class GitHubPATProvider implements AuthProvider {
  name = "github-pat";

  async authenticate(credentials: Record<string, string>): Promise<GitHubUserProfile> {
    const { token } = credentials;
    if (!token) {
      throw new Error("GitHub Personal Access Token is required");
    }

    try {
      const octokit = new Octokit({ auth: token });
      const { data: user } = await octokit.users.getAuthenticated();

      return {
        githubId: user.id,
        login: user.login,
        displayName: user.name || user.login,
        avatarUrl: user.avatar_url || null,
      };
    } catch (error) {
      throw new Error(
        `Invalid or revoked GitHub PAT: ${error instanceof Error ? error.message : "authentication failed"}`
      );
    }
  }
}
