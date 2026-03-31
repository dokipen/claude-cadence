---
name: project-ops
description: Shared worktree management operations. Use when creating worktrees, cleaning up branches, or checking for orphaned worktrees.
user-invokable: false
---

# Project Operations

Shared utilities for worktree management.

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

## Scripts

All scripts live in this skill's `scripts/` directory. Invoke them using the full `$CADENCE_ROOT`-prefixed path:

### create-worktree.sh

Create a new worktree and branch for feature development.

```bash
bash "$CADENCE_ROOT/skills/project-ops/scripts/create-worktree.sh" <branch-name>
```

- Branch names MUST start with an issue number (e.g., `42-add-feature`)
- Creates `.worktrees/<branch-name>` directory
- Runs `cleanup-merged-worktrees.sh` as pre-flight to auto-clean stale worktrees
- Falls back to orphan check for untracked directories
- Validates branch doesn't already exist locally or remotely

### cleanup-merged-worktrees.sh

Automatically clean up worktrees whose associated PRs have been merged.

```bash
bash "$CADENCE_ROOT/skills/project-ops/scripts/cleanup-merged-worktrees.sh"
```

- Scans `.worktrees/` for branches with merged PRs
- Removes worktree directory, local/remote branches, and `in-progress` label
- Skips the current worktree
- Called automatically by `create-worktree.sh` pre-flight

### cleanup-worktree.sh

Clean up a worktree and its remote branch after PR merge.

```bash
bash "$CADENCE_ROOT/skills/project-ops/scripts/cleanup-worktree.sh" <branch-name>
```

- Deletes remote branch (if it still exists)
- Removes local worktree directory
- Prunes orphaned worktree references

### detect-worktree.sh

Detect if the current directory is inside a git worktree.

```bash
bash "$CADENCE_ROOT/skills/project-ops/scripts/detect-worktree.sh"
```

- Outputs JSON: `{"in_worktree": true|false, "branch": "<name>"}`
- Safe to run outside a git repo (returns `in_worktree: false`)
- Used by `/lead` Phase 0 for worktree detection

### check-orphaned-worktrees.sh

Check for orphaned worktree directories not tracked by git.

```bash
bash "$CADENCE_ROOT/skills/project-ops/scripts/check-orphaned-worktrees.sh"
```

