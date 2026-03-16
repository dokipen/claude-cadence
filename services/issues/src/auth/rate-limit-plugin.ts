import type { ApolloServerPlugin } from "@apollo/server";
import { GraphQLError } from "graphql";
import type { AuthenticatedContext } from "../schema/resolvers/auth.js";

/**
 * Auth mutations that are subject to stricter rate limits.
 * Only credential-bearing operations susceptible to brute-force attacks.
 */
const AUTH_MUTATIONS = new Set([
  "authenticateWithGitHubCode",
  "authenticateWithGitHubPAT",
  "refreshToken",
]);

interface WindowEntry {
  timestamps: number[];
}

export interface RateLimitConfig {
  /** Max requests per window for auth mutations. Default: 10 */
  authMaxRequests: number;
  /** Max requests per window for general queries. Default: 100 */
  generalMaxRequests: number;
  /** Window duration in milliseconds. Default: 60000 (1 minute) */
  windowMs: number;
}

export function loadConfig(): RateLimitConfig {
  return {
    authMaxRequests: parseInt(
      process.env.RATE_LIMIT_AUTH_MAX || "10",
      10,
    ),
    generalMaxRequests: parseInt(
      process.env.RATE_LIMIT_GENERAL_MAX || "100",
      10,
    ),
    windowMs: parseInt(
      process.env.RATE_LIMIT_WINDOW_MS || "60000",
      10,
    ),
  };
}

const PURGE_INTERVAL_MS = 30_000;

/**
 * In-memory sliding-window rate limiter.
 * Tracks request timestamps per key and prunes expired entries periodically.
 */
export class RateLimitStore {
  private windows = new Map<string, WindowEntry>();
  private maxSize = 50_000;
  private purgeTimer: ReturnType<typeof setInterval> | null = null;
  private windowMs: number;

  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
  }

  /** Start the periodic purge timer. Call once at startup. */
  startPurgeSchedule(): void {
    if (this.purgeTimer) return;
    this.purgeTimer = setInterval(() => this.purgeExpired(Date.now()), PURGE_INTERVAL_MS);
    this.purgeTimer.unref();
  }

  /** Stop the periodic purge timer. */
  stopPurgeSchedule(): void {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }
  }

  hit(key: string, now: number, windowMs: number, maxRequests: number): boolean {
    let entry = this.windows.get(key);
    if (!entry) {
      if (this.windows.size >= this.maxSize) {
        return true; // fail open — allow request when store is saturated
      }
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Remove timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      return false; // rate limited
    }

    entry.timestamps.push(now);
    return true; // allowed
  }

  /** Returns the number of milliseconds until the oldest entry in the window expires. */
  retryAfterMs(key: string, now: number, windowMs: number): number {
    const entry = this.windows.get(key);
    if (!entry || entry.timestamps.length === 0) return 0;
    const oldest = entry.timestamps[0];
    return Math.max(0, windowMs - (now - oldest));
  }

  private purgeExpired(now: number): void {
    for (const [key, entry] of this.windows) {
      // Evict if all timestamps are expired (check the newest one)
      if (
        entry.timestamps.length === 0 ||
        now - entry.timestamps[entry.timestamps.length - 1] >= this.windowMs
      ) {
        this.windows.delete(key);
      }
    }
  }

  /** Visible for testing. */
  get size(): number {
    return this.windows.size;
  }
}

function isAuthMutationOperation(document: any): boolean {
  for (const definition of document.definitions) {
    if (definition.kind !== "OperationDefinition") continue;
    if (definition.operation !== "mutation") continue;
    for (const sel of definition.selectionSet.selections) {
      if (sel.kind === "Field" && AUTH_MUTATIONS.has(sel.name.value)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Apollo Server plugin that enforces per-IP rate limiting.
 * Auth mutations get stricter limits than general queries.
 *
 * Reads configuration from environment variables:
 * - RATE_LIMIT_AUTH_MAX: max auth mutation requests per window (default 10)
 * - RATE_LIMIT_GENERAL_MAX: max general requests per window (default 100)
 * - RATE_LIMIT_WINDOW_MS: window duration in ms (default 60000)
 */
export function rateLimitPlugin(
  configOverride?: Partial<RateLimitConfig>,
  storeOverride?: RateLimitStore,
): ApolloServerPlugin<AuthenticatedContext> {
  const config = { ...loadConfig(), ...configOverride };
  const store = storeOverride ?? new RateLimitStore(config.windowMs);
  store.startPurgeSchedule();

  return {
    async requestDidStart(requestContext) {
      return {
        async didResolveOperation(opContext) {
          const clientIp = opContext.contextValue.clientIp ?? "unknown";
          const now = Date.now();
          const isAuth = isAuthMutationOperation(opContext.document);
          const maxRequests = isAuth
            ? config.authMaxRequests
            : config.generalMaxRequests;
          const key = isAuth ? `auth:${clientIp}` : `general:${clientIp}`;

          const allowed = store.hit(key, now, config.windowMs, maxRequests);

          if (!allowed) {
            const retryAfterSec = Math.ceil(
              store.retryAfterMs(key, now, config.windowMs) / 1000,
            );

            console.warn(
              `Rate limit exceeded: ip=${clientIp} bucket=${isAuth ? "auth" : "general"} limit=${maxRequests}/${config.windowMs}ms`,
            );

            throw new GraphQLError("Too many requests", {
              extensions: {
                code: "TOO_MANY_REQUESTS",
                retryAfter: retryAfterSec,
                http: {
                  status: 429,
                  headers: new Map([
                    ["retry-after", String(retryAfterSec)],
                  ]),
                },
              },
            });
          }
        },
      };
    },
  };
}
