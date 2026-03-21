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

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_RETRY_AFTER_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function isAuthError(error: unknown): boolean {
  const err = error as { response?: { errors?: Array<{ extensions?: { code?: string } }> } };
  return err?.response?.errors?.some(
    (e) => e?.extensions?.code === "UNAUTHENTICATED"
  ) ?? false;
}

export function is429Error(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  const err = error as {
    response?: {
      status?: number;
      errors?: Array<{ extensions?: { code?: string } }>;
    };
  };
  if (err?.response?.status === 429) {
    return true;
  }
  return err?.response?.errors?.some(
    (e) => e?.extensions?.code === "TOO_MANY_REQUESTS"
  ) ?? false;
}

export function getRetryAfterMs(error: unknown): number | null {
  const err = error as {
    response?: {
      errors?: Array<{ extensions?: { retryAfter?: number } }>;
    };
  };
  const errors = err?.response?.errors;
  if (!errors) {
    return null;
  }
  for (const e of errors) {
    const retryAfter = e?.extensions?.retryAfter;
    if (typeof retryAfter === "number" && retryAfter > 0) {
      return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
    }
  }
  return null;
}

/**
 * Returns a GraphQL client that automatically refreshes the access token
 * when it receives an UNAUTHENTICATED error and a refresh token is available.
 * Also retries with exponential backoff on 429 Too Many Requests errors.
 */
export function getClient(): GraphQLClient {
  const url = getApiUrl();
  const token = getAuthToken();
  const client = createRawClient(url, token);

  // Wrap the request method to intercept auth errors and rate limit errors
  let originalRequest = client.request.bind(client) as typeof client.request;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).request = async (documentOrOptions: any, variables?: any, requestHeaders?: any) => {
    let attempt = 0;

    while (true) {
      try {
        return await originalRequest(documentOrOptions, variables, requestHeaders);
      } catch (error: unknown) {
        if (is429Error(error)) {
          if (attempt >= MAX_RETRIES) {
            throw error;
          }
          const retryAfterMs = getRetryAfterMs(error);
          const backoffMs = retryAfterMs ?? BASE_BACKOFF_MS * Math.pow(2, attempt);
          const delaySec = Math.ceil(backoffMs / 1000);
          console.error(`Rate limited. Retrying in ${delaySec}s... (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(backoffMs);
          attempt++;
          continue;
        }

        if (!isAuthError(error)) {
          throw error;
        }

        const newToken = await tryRefresh(url);
        if (!newToken) {
          throw error;
        }

        // Switch to refreshed-token client and retry (stays in the loop for 429 protection)
        const retryClient = createRawClient(url, newToken);
        originalRequest = retryClient.request.bind(retryClient) as typeof originalRequest;
      }
    }
  };

  return client;
}
