import { GraphQLClient, gql } from "graphql-request";

const REFRESH_TOKEN_MUTATION = gql`
  mutation RefreshToken($refreshToken: String!) {
    refreshToken(refreshToken: $refreshToken) {
      token
      refreshToken
      user {
        id
        login
        displayName
        avatarUrl
      }
    }
  }
`;

interface RefreshResult {
  refreshToken: {
    token: string;
    refreshToken: string;
  };
}

export function getStoredToken(): string | null {
  return localStorage.getItem("token");
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem("refreshToken");
}

export function setStoredTokens(token: string, refreshToken: string): void {
  localStorage.setItem("token", token);
  localStorage.setItem("refreshToken", refreshToken);
}

export function clearStoredTokens(): void {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
}

export function createRawClient(token?: string | null): GraphQLClient {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const url = new URL("/graphql", window.location.origin).href;
  return new GraphQLClient(url, { headers });
}

// Shared in-flight refresh promise to prevent parallel 401s from
// triggering multiple refresh calls and causing token thrashing.
let inflightRefresh: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (inflightRefresh) {
    return inflightRefresh;
  }

  inflightRefresh = (async () => {
    const refreshTokenValue = getStoredRefreshToken();
    if (!refreshTokenValue) {
      return null;
    }

    try {
      const client = createRawClient();
      const result = await client.request<RefreshResult>(
        REFRESH_TOKEN_MUTATION,
        { refreshToken: refreshTokenValue },
      );

      const newToken = result.refreshToken.token;
      const newRefreshToken = result.refreshToken.refreshToken;
      setStoredTokens(newToken, newRefreshToken);
      return newToken;
    } catch {
      return null;
    }
  })();

  try {
    return await inflightRefresh;
  } finally {
    inflightRefresh = null;
  }
}

export function isAuthError(error: unknown): boolean {
  const err = error as {
    response?: { errors?: Array<{ extensions?: { code?: string } }> };
  };
  return (
    err?.response?.errors?.some(
      (e) => e?.extensions?.code === "UNAUTHENTICATED",
    ) ?? false
  );
}

/**
 * Returns a GraphQL client that automatically refreshes the access token
 * on UNAUTHENTICATED errors. If refresh fails, triggers the onAuthFailure
 * callback (if provided) so the app can redirect to login.
 */
export function getClient(onAuthFailure?: () => void): GraphQLClient {
  const token = getStoredToken();
  const client = createRawClient(token);

  const originalRequest = client.request.bind(client) as typeof client.request;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).request = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    documentOrOptions: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestHeaders?: any,
  ) => {
    try {
      return await originalRequest(documentOrOptions, variables, requestHeaders);
    } catch (error: unknown) {
      if (!isAuthError(error)) {
        throw error;
      }

      const newToken = await tryRefresh();
      if (!newToken) {
        onAuthFailure?.();
        throw error;
      }

      const retryClient = createRawClient(newToken);
      return await retryClient.request(
        documentOrOptions,
        variables,
        requestHeaders,
      );
    }
  };

  return client;
}
