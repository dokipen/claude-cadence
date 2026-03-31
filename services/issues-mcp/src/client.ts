import { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import {
  getApiUrl,
  getAuthToken,
  getRefreshToken,
  getGhPat,
  setResolvedAuthToken,
  setResolvedRefreshToken,
} from "./config.js";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_RETRY_AFTER_MS = 30_000;

const AUTHENTICATE_WITH_PAT = gql`
  mutation AuthenticateWithGitHubPAT($token: String!) {
    authenticateWithGitHubPAT(token: $token) {
      token
      refreshToken
    }
  }
`;

const REFRESH_TOKEN_MUTATION = gql`
  mutation RefreshToken($refreshToken: String!) {
    refreshToken(refreshToken: $refreshToken) {
      token
      refreshToken
    }
  }
`;

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
 * Exchanges a GitHub PAT for API tokens and stores them in memory.
 * Returns the new auth token on success, null if no PAT is available or the exchange fails.
 */
async function exchangeGhPat(url: string): Promise<string | null> {
  const ghPat = getGhPat();
  if (!ghPat) return null;

  try {
    const unauthClient = createRawClient(url);
    const result = await unauthClient.request<{ authenticateWithGitHubPAT: { token: string; refreshToken: string } }>(
      AUTHENTICATE_WITH_PAT,
      { token: ghPat }
    );
    const newToken = result.authenticateWithGitHubPAT.token;
    setResolvedAuthToken(newToken);
    setResolvedRefreshToken(result.authenticateWithGitHubPAT.refreshToken);
    return newToken;
  } catch (error) {
    if (process.env.DEBUG) {
      process.stderr.write(`Auth refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return null;
  }
}

async function tryAuth(url: string): Promise<string | null> {
  // Try refresh token first
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      const client = createRawClient(url);
      const result = await client.request<{ refreshToken: { token: string; refreshToken: string } }>(
        REFRESH_TOKEN_MUTATION,
        { refreshToken }
      );
      const newToken = result.refreshToken.token;
      setResolvedAuthToken(newToken);
      setResolvedRefreshToken(result.refreshToken.refreshToken);
      return newToken;
    } catch (error) {
      if (process.env.DEBUG) {
        process.stderr.write(`Auth refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      // Fall through to gh auth token
    }
  }

  // Fall back to gh auth token via PAT exchange
  return exchangeGhPat(url);
}

/**
 * Bootstraps authentication at startup if no token is available.
 * Tries gh auth token -> PAT exchange and stores the resulting tokens.
 * Returns true on success, false if no PAT is available or auth fails.
 */
export async function bootstrapAuth(): Promise<boolean> {
  if (getAuthToken()) return true;

  const url = getApiUrl();
  const newToken = await exchangeGhPat(url);
  return newToken !== null;
}

/**
 * Returns a GraphQL client with 429 retry logic using exponential backoff
 * and automatic re-authentication on UNAUTHENTICATED errors via refresh token
 * or gh auth token exchange.
 */
export function getClient(): GraphQLClient {
  const url = getApiUrl();
  const token = getAuthToken();
  const client = createRawClient(url, token);

  const originalRequest = client.request.bind(client) as typeof client.request;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).request = async (documentOrOptions: any, variables?: any, requestHeaders?: any) => {
    let attempt = 0;
    let currentRequest = originalRequest;
    let authRetried = false;

    while (true) {
      try {
        return await currentRequest(documentOrOptions, variables, requestHeaders);
      } catch (error: unknown) {
        if (is429Error(error)) {
          if (attempt >= MAX_RETRIES) {
            throw error;
          }
          const retryAfterMs = getRetryAfterMs(error);
          const backoffMs = retryAfterMs ?? BASE_BACKOFF_MS * Math.pow(2, attempt);
          const delaySec = Math.ceil(backoffMs / 1000);
          process.stderr.write(`Rate limited. Retrying in ${delaySec}s... (attempt ${attempt + 1}/${MAX_RETRIES})\n`);
          await sleep(backoffMs);
          attempt++;
          continue;
        }

        if (!isAuthError(error)) {
          throw error;
        }

        if (authRetried) {
          throw new Error(
            "Authentication failed: token expired and automatic re-authentication failed. " +
            "Run `gh auth login` to re-authenticate, or set ISSUES_AUTH_TOKEN to a valid token."
          );
        }
        authRetried = true;
        const newToken = await tryAuth(url);
        if (!newToken) {
          throw new Error(
            "Authentication failed: token expired and automatic re-authentication failed. " +
            "Run `gh auth login` to re-authenticate, or set ISSUES_AUTH_TOKEN to a valid token."
          );
        }

        // Switch to refreshed-token client and retry (stays in the loop for 429 protection)
        const retryClient = createRawClient(url, newToken);
        currentRequest = retryClient.request.bind(retryClient) as typeof currentRequest;
      }
    }
  };

  return client;
}
