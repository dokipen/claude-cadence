import { Octokit } from "@octokit/rest";
import type { AuthProvider, GitHubUserProfile } from "../types.js";

export class GitHubOAuthProvider implements AuthProvider {
  name = "github-oauth";

  async authenticate(credentials: Record<string, string>): Promise<GitHubUserProfile> {
    const { code } = credentials;
    if (!code) {
      throw new Error("OAuth authorization code is required");
    }

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("GitHub OAuth is not configured (missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET)");
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(
        `GitHub OAuth error: ${tokenData.error_description || tokenData.error || "Failed to exchange code"}`
      );
    }

    // Fetch user profile
    const octokit = new Octokit({ auth: tokenData.access_token });
    const { data: user } = await octokit.users.getAuthenticated();

    return {
      githubId: user.id,
      login: user.login,
      displayName: user.name || user.login,
      avatarUrl: user.avatar_url || null,
    };
  }
}
