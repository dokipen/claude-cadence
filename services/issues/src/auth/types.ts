export interface GitHubUserProfile {
  githubId: number;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AuthProvider {
  name: string;
  authenticate(credentials: Record<string, string>): Promise<GitHubUserProfile>;
}
