# issues-ui

React 19 frontend for the issues microservice. Stack: Vite, React 19, TypeScript, Vitest + @testing-library/react, Playwright (E2E).

## Test Bar

All new features in `services/issues-ui` require at least interaction-level tests before merge.

### What "interaction-level" means

**Components** — a Vitest + @testing-library/react test that renders the component and uses `fireEvent` to simulate user actions, asserting on resulting DOM state or mock calls.

```ts
fireEvent.click(button)
// assert a dialog appears, or a mock fn was called
```

> `@testing-library/user-event` is not currently installed. Use `fireEvent` — it covers click/change interactions adequately. If you need pointer or keyboard event chains, install `user-event` first.

**Hooks** — a `renderHook` test that invokes the hook, wraps state changes in `act()`, and asserts on return values.

**Pure display components** (no behavior, no state, no interactions) are exempt.

### Test file conventions

- Co-locate test files next to the source: `Foo.tsx` → `Foo.test.tsx`, `useBar.ts` → `useBar.test.ts`
- Add `// @vitest-environment jsdom` at the top of each test file
- Run unit tests: `npm run test`
- Run E2E tests: `npm run test:e2e`

### Retroactive coverage

Existing untested features are tracked in ticket #402. New features added since this policy was established are not exempt — they require tests before merge.

### Enforcement

The test bar is enforced at PR review time via the PR template checklist. Reviewers must verify that new `services/issues-ui/` features have co-located test files covering at least their primary interactions.

## Verification

```bash
npm run test
```
