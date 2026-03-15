import { randomBytes } from "node:crypto";

interface StateEntry {
  createdAt: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_SIZE = 10_000;

/**
 * In-memory store for OAuth state parameters.
 * Each state is single-use and expires after a configurable TTL.
 */
export class OAuthStateStore {
  private states = new Map<string, StateEntry>();
  private ttlMs: number;
  private maxSize: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxSize = DEFAULT_MAX_SIZE) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  /** Generate a cryptographically random state token and store it. */
  generate(): string {
    this.purgeExpired();
    if (this.states.size >= this.maxSize) {
      throw new Error("Too many pending OAuth state tokens");
    }
    const state = randomBytes(32).toString("hex");
    this.states.set(state, { createdAt: Date.now() });
    return state;
  }

  /** Validate and consume a state token (single-use). Returns true if valid. */
  validate(state: string): boolean {
    const entry = this.states.get(state);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.states.delete(state);
      return false;
    }
    this.states.delete(state);
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
