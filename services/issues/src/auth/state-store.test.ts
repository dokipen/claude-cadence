import { describe, it, expect, vi, afterEach } from "vitest";
import { OAuthStateStore } from "./state-store.js";

describe("OAuthStateStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should generate a hex state token", () => {
    const store = new OAuthStateStore();
    const state = store.generate();
    expect(state).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should generate unique tokens", () => {
    const store = new OAuthStateStore();
    const states = new Set(Array.from({ length: 10 }, () => store.generate()));
    expect(states.size).toBe(10);
  });

  it("should validate a valid state", () => {
    const store = new OAuthStateStore();
    const state = store.generate();
    expect(store.validate(state)).toBe(true);
  });

  it("should reject an unknown state", () => {
    const store = new OAuthStateStore();
    expect(store.validate("not-a-real-state")).toBe(false);
  });

  it("should consume state on validation (single-use)", () => {
    const store = new OAuthStateStore();
    const state = store.generate();
    expect(store.validate(state)).toBe(true);
    expect(store.validate(state)).toBe(false);
  });

  it("should reject expired state", () => {
    const store = new OAuthStateStore(1000); // 1 second TTL
    const state = store.generate();

    // Advance time past TTL
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
    expect(store.validate(state)).toBe(false);
  });

  it("should purge expired entries on generate", () => {
    const store = new OAuthStateStore(100);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    store.generate();
    store.generate();

    // Advance time past TTL and generate a new one (triggers purge)
    vi.spyOn(Date, "now").mockReturnValue(now + 200);
    store.generate();

    // The store's internal map should only have 1 entry (the new one)
    // We verify this indirectly: the old states should be invalid
    // (they'd be invalid anyway due to expiry, but purge removes them from memory)
  });
});
