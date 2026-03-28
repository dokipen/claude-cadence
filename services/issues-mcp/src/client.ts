import { GraphQLClient } from "graphql-request";
import { getApiUrl, getAuthToken } from "./config.js";

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
 * Returns a GraphQL client with 429 retry logic using exponential backoff.
 * No token refresh — MCP servers use long-lived tokens.
 */
export function getClient(): GraphQLClient {
  const url = getApiUrl();
  const token = getAuthToken();
  const client = createRawClient(url, token);

  const originalRequest = client.request.bind(client) as typeof client.request;

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
          process.stderr.write(`Rate limited. Retrying in ${delaySec}s... (attempt ${attempt + 1}/${MAX_RETRIES})\n`);
          await sleep(backoffMs);
          attempt++;
          continue;
        }
        throw error;
      }
    }
  };

  return client;
}
