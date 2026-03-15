import { randomBytes } from "node:crypto";

interface StateEntry {
  createdAt: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * In-memory store for OAuth state parameters.
 * Each state is single-use and expires after a configurable TTL.
 */
export class OAuthStateStore {
  private states = new Map<string, StateEntry>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Generate a cryptographically random state token and store it. */
  generate(): string {
    this.purgeExpired();
    const state = randomBytes(32).toString("hex");
    this.states.set(state, { createdAt: Date.now() });
    return state;
  }

  /** Validate and consume a state token (single-use). Returns true if valid. */
  validate(state: string): boolean {
    this.purgeExpired();
    const entry = this.states.get(state);
    if (!entry) return false;
    this.states.delete(state);
    if (Date.now() - entry.createdAt > this.ttlMs) return false;
    return true;
  }

  /** Remove expired entries. */
  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.states) {
      if (now - entry.createdAt > this.ttlMs) {
        this.states.delete(key);
      }
    }
  }
}

/** Singleton instance used by the auth resolvers. */
export const oauthStateStore = new OAuthStateStore();
