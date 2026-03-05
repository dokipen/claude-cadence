---
name: project-ops
description: Shared worktree management operations. Use when creating worktrees, cleaning up branches, or checking for orphaned worktrees.
user-invokable: false
---

# Project Operations

Shared utilities for worktree management.

## Scripts

All scripts live in this skill's `scripts/` directory.

### create-worktree.sh

Create a new worktree and branch for feature development.

```bash
scripts/create-worktree.sh <branch-name>
```

- Branch names MUST start with an issue number (e.g., `42-add-feature`)
- Creates `.worktrees/<branch-name>` directory
- Runs orphan check as pre-flight
- Validates branch doesn't already exist locally or remotely

### cleanup-worktree.sh

Clean up a worktree and its remote branch after PR merge.

```bash
scripts/cleanup-worktree.sh <branch-name>
```

- Deletes remote branch (if it still exists)
- Removes local worktree directory
- Prunes orphaned worktree references

### check-orphaned-worktrees.sh

Check for orphaned worktree directories not tracked by git.

```bash
scripts/check-orphaned-worktrees.sh
```

