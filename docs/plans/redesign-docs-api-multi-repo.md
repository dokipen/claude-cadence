# Plan: Redesign Docs API to Support Multi-Repo Documentation

Ticket: #261

## Goal

Restore the `/api/v1/docs` endpoint to agent-hub in a way that works correctly when agent-hub runs as a systemd service (CWD is `/`), and extend it to serve documentation from multiple registered repos. The issues-ui kanban application should be able to browse and render docs from any configured project.

## Background

### Problem

The original `GET /api/v1/docs` and `GET /api/v1/docs/{path}` endpoints hardcoded `const docsDir = "docs"` — a path relative to the process CWD. This works when running agent-hub from the repo root in development, but breaks in production: the systemd unit file sets no `WorkingDirectory`, so systemd defaults CWD to `/`, making `docs/` resolve to `/docs` (which does not exist). The feature was removed in PR #259 pending a proper redesign tracked in issue #261.

### Root Cause

Docs live inside *specific cloned repositories* on the deployment host, not in a single well-known location. There is one repo producing agent-hub itself (`claude-cadence`) and potentially other repos with their own `docs/` subdirectories. A single static relative path cannot serve docs from multiple repos.

### Current State

- **agent-hub** (`services/agent-hub/`): Go service with a YAML config (`/etc/agent-hub/config.yaml`). Config only covers auth, rate-limiting, heartbeat, log level, and agent TTL. No repo or docs configuration exists.
- **Removed code**: `handleListDocs()` and `handleGetDoc()` handlers (~115 lines removed from PR #259). The path traversal protection using `filepath.Abs` + prefix containment was sound. Only the CWD-relative `docsDir` constant needs to change.
- **issues-ui** (`services/issues-ui/`): React/TypeScript SPA. `docsClient.ts` and `useDocs.ts` stubs exist on disk but are orphaned. `DocsPage`, its nav link, route, and e2e spec were fully removed in PR #259.
- **Deployment**: agent-hub is deployed as a systemd service. The systemd unit uses `ProtectSystem=strict` and `ProtectHome=true`, meaning docs directories must not be under `/home` or other protected paths.

### Constraints

1. agent-hub runs as a systemd service; CWD is unreliable — all paths must be absolute.
2. `ProtectHome=true` blocks `/home`, `/root`, and `/run/user` — docs must live outside these.
3. Multiple projects should each be able to contribute their own docs.
4. agent-hub should not execute `git pull` (credentials, network dependencies, failure modes).

## Architecture

**Recommended approach: Config-driven absolute paths**

Agent-hub's config file lists explicit named repos with their absolute `docs_path` on disk. Agent-hub reads `.md` files from those paths at request time. Repos manage keeping their own checkouts current via external means (deploy scripts, CI).

```yaml
# /etc/agent-hub/config.yaml additions
repos:
  - name: "claude-cadence"
    docs_path: "/srv/claude-cadence/docs"
  - name: "my-other-project"
    docs_path: "/srv/my-other-project/docs"
```

**API shape:**
- `GET /api/v1/docs` — returns `{ "repos": [{ "name": "claude-cadence", "files": [...] }] }`
- `GET /api/v1/docs/{repo}/{path...}` — returns content of a single `.md` file from the named repo

**Rationale over alternatives:**

| Approach | Assessment |
|---|---|
| Config-driven paths (recommended) | Absolute paths eliminate the CWD issue; fits the existing YAML config pattern; no additional processes needed |
| Sidecar watcher | Adds operational complexity; CWD problem still exists for sidecar unless it also reads config |
| Push API | Requires all repos to know agent-hub URL and token; docs become stale if push is missed |
| Git-pull approach | Requires credentials, network, git installed; adds failure modes |

## Implementation Phases

### Phase 1 — Config: Add repos block to agent-hub config

**Description:** Extend the agent-hub YAML config to support a `repos` list, where each entry maps a project name to an absolute docs path on disk.

**Tasks:**
1. Add a `RepoConfig` struct (`Name string`, `DocsPath string`) to `internal/config/config.go`
2. Add a `Repos []RepoConfig` field to the top-level `Config` struct with `yaml:"repos"` tag
3. Add validation: each repo must have a non-empty `name` and an absolute `docs_path`; names must be unique; warn (not error) if `docs_path` does not exist at startup
4. Update `config.example.yaml` with a commented-out `repos:` example block using `/srv/` paths
5. Add round-trip and validation tests for the new field in `internal/config/config_test.go`

**Deliverable:** Config parses repos and validates them; no behaviour change to existing endpoints.

---

### Phase 2 — Backend: Restore and extend docs handlers

**Description:** Re-implement the removed docs API handlers with multi-repo support and project-scoped routing.

**Tasks:**
1. Re-add `handleListDocs(repos []config.RepoConfig)` to `handlers.go` — returns all repos with their `.md` file listings; route `GET /api/v1/docs`
2. Re-add `handleGetDoc(repos []config.RepoConfig)` to `handlers.go` — route `GET /api/v1/docs/{repo}/{path...}`
3. Replicate path-traversal protection: absolute path resolution + prefix-containment check; restrict to `.md` files only
4. Register both routes in `server.go` inside `apiMux`, passing `cfg.Repos`
5. Return `404` with JSON error body when repo name is unknown or file does not exist
6. Return `200 { "repos": [] }` (not an error) when no repos are configured
7. Add unit tests covering: no repos configured, file listing, file content, unknown repo 404, path traversal rejection, non-`.md` rejection

**Deliverable:** `GET /api/v1/docs` and `GET /api/v1/docs/{repo}/{path...}` live with multi-repo support.

---

### Phase 3 — Deployment: Systemd config update and directory setup

**Description:** Update deployment artifacts and documentation to ensure agent-hub works correctly in the systemd environment.

**Tasks:**
1. Add explicit `WorkingDirectory=/` to `agent-hub.service.tmpl` to document the intentional CWD
2. Update `deploy.sh` to ensure docs directories exist on the host after deploy (or document required pre-setup steps)
3. Update `config.example.yaml` with realistic example using `/srv/` paths and `ProtectHome` guidance
4. Update `install/verify.sh` to probe `GET /api/v1/docs` and verify a 200 response

**Deliverable:** Deployed agent-hub serves docs from configured absolute paths.

---

### Phase 4 — Frontend: Restore DocsPage and wire to multi-repo API

**Description:** Restore the docs browsing UI in issues-ui, updated for the new project-scoped API.

**Tasks:**
1. Restore `DocsPage.tsx` with a two-panel layout (file tree sidebar + rendered markdown preview), with collapsible repo groups in the sidebar
2. Update `docsClient.ts` to match new API shape: `fetchDocFiles()` returns `{ repos: [...] }`; `fetchDocContent(repo, path)` calls `/api/v1/docs/{repo}/{path}`
3. Re-add `Docs` nav link to `App.tsx`, `/docs` and `/docs/:repo/:path` routes
4. Update `useDocs.ts` hooks to accept and thread the `repo` parameter
5. Sync selected doc and repo to URL (`/docs/{repo}/{path}`) for deep-linking

**Deliverable:** Working two-panel docs UI accessible from the nav bar.

---

### Phase 5 — Tests: E2e and unit test coverage

**Description:** Restore and extend tests for the docs feature. Implement alongside Phase 4 in the same PR.

**Tasks:**
1. Restore `docs.spec.ts` e2e tests updated for multi-repo API (mock `GET /api/v1/docs` returns `{ repos: [...] }`; mock content endpoint)
2. Add test cases: repo selector renders repo names; selecting files across repos; deep-link to `/docs/{repo}/{path}` loads correctly; error state when API unavailable
3. Restore `DocsPage.test.tsx` unit tests for the component in isolation
4. Verify all existing e2e tests still pass (no regressions from nav/routing changes)

**Deliverable:** Full test coverage for the docs feature.

---

### Phase 6 — Documentation and cleanup (optional polish)

**Description:** Remove orphaned stubs and add operator documentation.

**Tasks:**
1. Remove orphaned `docsClient.ts` and `useDocs.ts` stubs (replaced by Phase 4 implementations)
2. Add a `docs/` operator guide explaining how to configure repos in agent-hub
3. Update `README.md` if it references the docs feature

**Deliverable:** Clean codebase with operator documentation.

## Sequencing

```
Phase 1 (Config) ──────────────────► Phase 2 (Backend)
                                            │
                          ┌─────────────────┴──────────────────┐
                          ▼                                     ▼
                   Phase 3 (Deploy)                    Phase 4+5 (Frontend+Tests)
                          │                                     │
                          └─────────────────┬──────────────────┘
                                            ▼
                                    Phase 6 (Cleanup)
```

**Practical PR breakdown:**
- **PR A**: Phases 1 + 2 (config + backend, no UI changes)
- **PR B**: Phase 3 (deployment update, can land independently after PR A)
- **PR C**: Phases 4 + 5 (frontend + tests together)
- **PR D**: Phase 6 (cleanup, optional)

## Open Questions

1. **`ProtectHome=strict` path constraints**: Do docs repos need to live under `/srv/` specifically, or is `/home/doki_pen/repos/` also acceptable? (`ProtectHome=true` blocks `/home`, `/root`, and `/run/user`.) This affects documented example paths and may require operator action before deploy.

2. **API query parameter for single-repo callers**: Should the new `GET /api/v1/docs` support `?repo=<name>` for callers that only want one repo's files? Since no production consumers currently exist, this is a clean break — worth deciding before Phase 2 implementation.

3. **Stale docs**: Config-driven paths mean agent-hub reads whatever markdown is on disk. If repos are not kept up-to-date, docs may lag. Is there an existing `git pull` cron or deploy mechanism for keeping repos current?

4. **Authentication on docs endpoints**: Docs endpoints are inside `apiMux`, requiring `HUB_API_TOKEN` when `auth.mode = "token"`. Confirm no docs should be publicly readable.

5. **Empty `docs_path`**: Should a configured repo with a `docs_path` that does not exist return an empty file list at runtime (recommended, with a startup warning), or should it be a hard validation error?
