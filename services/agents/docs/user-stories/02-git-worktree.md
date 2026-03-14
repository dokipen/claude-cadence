# US-02: Git Repository & Worktree Management

## Summary

The service manages git repository clones and creates isolated worktree environments for each agent session. Repositories are cloned once and kept up-to-date; worktrees provide session isolation.

## Stories

### Repository Cloning
- As a user, the service clones a repo to `{root_dir}/repos/{owner}/{repo}` on first session creation for that profile
- As a user, subsequent sessions for the same repo reuse the existing clone (no redundant cloning)
- As a user, the clone is a full clone (not bare) to support worktree creation
- As a user, private repos are cloned using credentials from Vault (see US-03)

### Default Branch Updates
- As a user, the service detects the default branch automatically (main, master, etc.)
- As a user, the default branch is fetched and pulled before creating each new worktree
- As a user, the main clone is never modified except to update the default branch

### Worktree Creation
- As a user, each session gets its own isolated git worktree at `{root_dir}/worktrees/{session-uuid}/`
- As a user, the worktree is based on the latest default branch (or a specified `base_ref`)
- As a user, changes in one worktree do not affect the main clone or other worktrees

### Worktree Cleanup
- As a user, when a session is destroyed, its worktree is removed via `git worktree remove`
- As a user, orphaned worktree references are pruned via `git worktree prune`
- As a user, the main clone is preserved even after all sessions are destroyed

## E2E Test Cases

| Test | Description |
|------|-------------|
| `TestClone_FirstSession` | First session triggers git clone |
| `TestClone_SecondSession_SameRepo` | Second session reuses existing clone |
| `TestWorktree_Isolation` | Changes in worktree don't affect main clone |
| `TestRepoUpdate_PullsLatest` | New session gets latest default branch commits |
| `TestWorktree_CleanupOnDestroy` | Worktree removed when session destroyed |

## Implementation Phase

**Phase 2** (Git Repository Management + Worktrees) -- 5 story points

Blocked by: Phase 1
