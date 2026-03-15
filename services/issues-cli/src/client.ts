import { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { getApiUrl, getAuthToken, getRefreshToken, setAuthTokens } from "./config.js";

const REFRESH_TOKEN_MUTATION = gql`
  mutation RefreshToken($refreshToken: String!) {
    refreshToken(refreshToken: $refreshToken) {
      token
      refreshToken
      user {
        id
        login
      }
    }
  }
`;

interface RefreshResult {
  refreshToken: {
    token: string;
    refreshToken: string;
    user: { id: string; login: string };
  };
}

function createRawClient(url: string, token?: string): GraphQLClient {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new GraphQLClient(url, { headers });
}

async function tryRefresh(url: string): Promise<string | null> {
  const refreshTokenValue = getRefreshToken();
  if (!refreshTokenValue) {
    return null;
  }

  try {
    const refreshClient = createRawClient(url);
    const result = await refreshClient.request<RefreshResult>(
      REFRESH_TOKEN_MUTATION,
      { refreshToken: refreshTokenValue }
    );

    const newToken = result.refreshToken.token;
    const newRefreshToken = result.refreshToken.refreshToken;
    setAuthTokens(newToken, newRefreshToken);
    return newToken;
  } catch {
    return null;
  }
}

function isAuthError(error: unknown): boolean {
  const err = error as { response?: { errors?: Array<{ extensions?: { code?: string } }> } };
  return err?.response?.errors?.some(
    (e) => e?.extensions?.code === "UNAUTHENTICATED"
  ) ?? false;
}

/**
 * Returns a GraphQL client that automatically refreshes the access token
 * when it receives an UNAUTHENTICATED error and a refresh token is available.
 */
export function getClient(): GraphQLClient {
  const url = getApiUrl();
  const token = getAuthToken();
  const client = createRawClient(url, token);

  // Wrap the request method to intercept auth errors
  const originalRequest = client.request.bind(client) as typeof client.request;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).request = async (documentOrOptions: any, variables?: any, requestHeaders?: any) => {
    try {
      return await originalRequest(documentOrOptions, variables, requestHeaders);
    } catch (error: unknown) {
      if (!isAuthError(error)) {
        throw error;
      }

      const newToken = await tryRefresh(url);
      if (!newToken) {
        throw error;
      }

      // Retry with the new token
      const retryClient = createRawClient(url, newToken);
      return await retryClient.request(documentOrOptions, variables, requestHeaders);
    }
  };

  return client;
}
