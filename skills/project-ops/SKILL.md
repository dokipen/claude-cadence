---
name: project-ops
description: Shared worktree management operations. Use when creating worktrees, cleaning up branches, or checking for orphaned worktrees.
user-invokable: false
---

# Project Operations

Shared utilities for worktree management.

## Filesystem Scope

> **IMPORTANT:** Only access files within the project repository (the directory containing `CLAUDE.md`). This applies to all tools — `Read`, `Glob`, `Grep`, and `Bash` alike. Never run Bash commands (e.g., `find`, `cat`, `ls`) targeting paths outside the repository, and never use absolute paths to home directories or system paths. Do not use `$HOME`, `~`, or any environment variable that may expand to a path outside the project repository (e.g., `$XDG_CONFIG_HOME`, `$TMPDIR`, `$XDG_DATA_HOME`, `$XDG_RUNTIME_DIR`, `$XDG_CACHE_HOME`, `$PATH`, `$SHELL`, `$OLDPWD`), do not use path traversal (e.g., `../`) to navigate above the repo root, do not run `readlink` or `realpath` on paths that would resolve outside the project directory, do not follow symlinks that lead outside the project directory, do not use `printenv` or `env` to read environment variables as path components, do not use `which`, `command -v`, or `type` to locate system tools, and do not use command substitution with any of these commands to construct file paths (e.g., `$(which python3)`, `$(printenv GOPATH)/src`, `$(command -v git)`). Use relative paths and `Glob`/`Grep` within the project directory.

## Scripts

All scripts live in this skill's `scripts/` directory.

### create-worktree.sh

Create a new worktree and branch for feature development.

```bash
scripts/create-worktree.sh <branch-name>
```

- Branch names MUST start with an issue number (e.g., `42-add-feature`)
- Creates `.worktrees/<branch-name>` directory
- Runs `cleanup-merged-worktrees.sh` as pre-flight to auto-clean stale worktrees
- Falls back to orphan check for untracked directories
- Validates branch doesn't already exist locally or remotely

### cleanup-merged-worktrees.sh

Automatically clean up worktrees whose associated PRs have been merged.

```bash
scripts/cleanup-merged-worktrees.sh
```

- Scans `.worktrees/` for branches with merged PRs
- Removes worktree directory, local/remote branches, and `in-progress` label
- Skips the current worktree
- Called automatically by `create-worktree.sh` pre-flight

### cleanup-worktree.sh

Clean up a worktree and its remote branch after PR merge.

```bash
scripts/cleanup-worktree.sh <branch-name>
```

- Deletes remote branch (if it still exists)
- Removes local worktree directory
- Prunes orphaned worktree references

### detect-worktree.sh

Detect if the current directory is inside a git worktree.

```bash
scripts/detect-worktree.sh
```

- Outputs JSON: `{"in_worktree": true|false, "branch": "<name>"}`
- Safe to run outside a git repo (returns `in_worktree: false`)
- Used by `/lead` Phase 0 for worktree detection

### check-orphaned-worktrees.sh

Check for orphaned worktree directories not tracked by git.

```bash
scripts/check-orphaned-worktrees.sh
```

