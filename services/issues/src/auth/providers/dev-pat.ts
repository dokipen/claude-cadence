import type { AuthProvider, GitHubUserProfile } from "../types.js";

/**
 * Dev-only auth provider that accepts any token without calling GitHub.
 * Returns a synthetic user profile using the token value as the login name.
 * Only used when NODE_ENV is "development" or "test".
 */
export class DevPATProvider implements AuthProvider {
  name = "dev-pat";

  async authenticate(credentials: Record<string, string>): Promise<GitHubUserProfile> {
    const { token } = credentials;
    if (!token) {
      throw new Error("Token is required");
    }

    const login = token.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 39) || "dev-user";

    return {
      githubId: 1,
      login,
      displayName: login,
      avatarUrl: null,
    };
  }
}
