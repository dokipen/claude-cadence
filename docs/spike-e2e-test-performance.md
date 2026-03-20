# Spike: E2E Test Performance

**Issue:** #152
**Date:** 2026-03-19

## Baseline Measurements

### issues-ui (Playwright, Chromium)

| Mode | Wall Time | Tests |
|------|-----------|-------|
| CI (`workers: 1`) | **96s** | 112 (108 pass, 1 fail, 3 flaky) |
| Local (`workers: 4`) | **26s** | 112 (111 pass, 1 fail) |

Per-file timing (CI mode, `workers: 1`):

| File | Time | Tests | Avg |
|------|------|-------|-----|
| login.spec.ts | 34.9s | 14 | 2492ms |
| ticket-detail.spec.ts | 12.6s | 29 | 433ms |
| launch-agent.spec.ts | 8.0s | 15 | 535ms |
| board.spec.ts | 6.2s | 17 | 362ms |
| agent-manager.spec.ts | 5.7s | 14 | 404ms |
| branding.spec.ts | 2.7s | 9 | 295ms |
| oauth.spec.ts | 2.1s | 7 | 304ms |
| dark-mode.spec.ts | 1.7s | 5 | 334ms |
| auto-refresh.spec.ts | 1.7s | 4 | 416ms |
| agent-hub-proxy.spec.ts | 0.8s | 1 | 792ms |
| smoke.spec.ts | 0.5s | 2 | 266ms |
| **Total** | **76.7s** | **117** | |

> Note: `login.spec.ts` accounts for 45% of total test time due to flaky tests hitting 5.3s timeouts before retrying. Without retries, actual test execution is ~45s.

### issues-cli (Vitest)

| Metric | Value |
|--------|-------|
| Wall time | ~40s measured (partial, see note) |
| Test files | 11 (10 suites + 1 helpers) |
| Total tests | 121 |
| Concurrency | Fully serial (`sequence.concurrent: false`) |

> **Caveat:** CLI tests currently fail due to a Prisma 7 schema compatibility issue (the `datasource.url` property was removed in Prisma 7). The 40s figure is from a partial run where only 5 of 11 suites bootstrapped successfully. A healthy full run is estimated at **90-190s** based on 10 server bootstraps at 5-15s each plus test execution time. This Prisma 7 issue needs a separate fix.

**Combined E2E baseline: ~186-286s estimated (serial), ~136s measured (partial)**

## Time Breakdown

### Where time is spent (Playwright)

| Phase | Approx. Time |
|-------|-------------|
| Global setup (prisma migrate + seed) | ~3s |
| Web server startup (API + Vite) | ~5s |
| Test execution (112 tests serial) | ~77s |
| Flaky test retries (3 tests × ~5.3s) | ~16s |
| **Total** | **~96s** |

### Where time is spent (CLI)

| Phase | Approx. Time |
|-------|-------------|
| Server boot per suite (×10) | ~5-15s each = **50-150s** |
| Per-test CLI process spawning (×240-360 invocations) | ~0.1-0.3s each |
| Test assertions | negligible |

The dominant cost in the CLI suite is the **10 independent server bootstraps** (prisma migrate + seed + server start), each taking 5-15 seconds.

## Parallelisation Feasibility

### Playwright — Safe to parallelize

**Current state:** `fullyParallel: true` but `workers: 1` in CI, negating the parallel setting.

**Assessment: Safe to increase workers.**

- All tests navigate from scratch (no shared browser state)
- Auth fixture generates JWT locally (no shared sessions)
- Database is seeded once and tests are read-only
- No `waitForTimeout` or artificial sleeps found
- All waits are event-driven (`toBeVisible`, `waitForURL`, `waitForResponse`)
- `page.route` mocking in agent tests is per-context (isolated)

**Measured result:** Increasing from 1 to 4 workers reduced wall time from **96s → 26s** (3.6× speedup).

**Risk:** If future tests write to the shared database, parallel tests could conflict. Mitigation: parameterize DB per worker via `PLAYWRIGHT_WORKER_INDEX`.

### CLI (Vitest) — Safe to parallelize at file level

- Each describe block gets its own server on `PORT: "0"` (OS-assigned)
- Each gets its own temp SQLite database
- Tests within a file share state (ordered), but files are independent

**Risk:** None for file-level parallelism. Within-file ordering must be preserved.

## Improvement Opportunities

### 1. Increase Playwright CI workers (High impact, trivial effort)

**Change:** `workers: process.env.CI ? 1 : undefined` → `workers: process.env.CI ? 4 : undefined`

**Expected gain:** ~70s reduction (96s → ~26s), measured locally.

**Why it was set to 1:** Likely to avoid flakiness, but tests are well-isolated. The 1 remaining flaky test (`login.spec.ts:204`) fails regardless of worker count.

### 2. Fix flaky login tests (Medium impact, moderate effort)

**Problem:** `login.spec.ts` accounts for 45% of total test time, mostly from 4 tests that fail on first attempt (5.3s timeout) then pass on retry. One test fails all 3 attempts.

**Root cause:** Tests use `expect(page).not.toHaveURL(...)` and `expect(page).toHaveURL(...)` for redirect assertions, which appear to have a timing issue with the auth mock flow.

**Expected gain:** ~20s reduction by eliminating retry overhead.

### 3. Consolidate CLI server bootstraps (High impact, moderate effort)

**Problem:** 10 independent `prisma migrate deploy` + `prisma db seed` + server starts, each taking 5-15s.

**Options:**
- **Global setup fixture:** Single server + DB, shared across all suites (tests already use independent data within suites)
- **File-level parallelism:** Enable `concurrent: true` at file level in Vitest config while keeping within-file ordering

**Expected gain:** 45-135s reduction.

### 4. Reduce redundant navigation in ticket-detail.spec.ts (Low-medium impact, trivial effort)

**Problem:** 23 tests each navigate to `/projects/e2e-test-project` independently. 13 of these navigate to the same REFINED ticket. 8 markdown tests navigate to the same markdown ticket.

**Fix:** Add `beforeEach` hooks for common navigation.

**Expected gain:** ~4-5s in serial mode, less impactful with parallelism.

### 5. Lower defensive timeouts in agent-manager.spec.ts (Low impact, trivial effort)

**Problem:** 9 assertions use `{ timeout: 15000 }` against mock-backed responses.

**Fix:** Reduce to default 5000ms or less.

**Expected gain:** Reduces worst-case tail latency. No effect on happy path.

### 6. Move CSS/branding tests to lighter-weight approach (Low impact, moderate effort)

**Problem:** 14 tests (branding + dark-mode) verify static CSS values using full browser + server. They don't need the API server.

**Options:**
- Visual regression testing (Playwright screenshots)
- Component-level testing (Vitest + happy-dom)
- Keep as-is but note they're fast (~295ms avg)

**Expected gain:** Marginal (~4s total). Not worth the migration effort unless the suite grows.

## Recommendations Summary

| # | Improvement | Impact | Effort | Priority |
|---|------------|--------|--------|----------|
| 1 | Increase Playwright CI workers to 4 | ~70s saved | Trivial (1 line) | **High** |
| 2 | Fix flaky login tests | ~20s saved | Moderate | **High** |
| 3 | Consolidate CLI server bootstraps | ~50-135s saved | Moderate | **High** |
| 4 | Enable CLI file-level parallelism | ~50% of remaining time | Small | **Medium** |
| 5 | Consolidate ticket-detail navigation | ~4-5s saved | Trivial | **Low** |
| 6 | Lower agent-manager timeouts | Reduces tail latency | Trivial | **Low** |

**Projected total improvement (items 1-4):** From ~136s down to ~25-35s — a **4-5× speedup**.

## Follow-up Tickets

The following tickets should be filed to track implementation of the recommendations:

1. **Increase Playwright CI workers from 1 to 4** — Points: 1, Priority: Medium, Labels: performance
2. **Fix flaky login E2E tests** — Points: 3, Priority: Medium, Labels: bug, performance
3. **Consolidate CLI E2E server bootstraps into shared fixture** — Points: 5, Priority: Medium, Labels: performance
4. **Enable file-level parallelism for CLI E2E tests** — Points: 2, Priority: Low, Labels: performance
