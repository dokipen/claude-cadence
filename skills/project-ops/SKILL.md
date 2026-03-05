---
name: project-ops
description: Shared project operations including git worktree management and agent discovery. Use when creating worktrees, cleaning up branches, checking for orphaned worktrees, or listing available agents.
user-invokable: false
---

# Project Operations

Shared utilities for worktree management and agent discovery.

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

### list-agents.sh

List all available agents with their frontmatter metadata.

```bash
scripts/list-agents.sh
```

Scans in priority order:
1. `.claude/agents/` (project-local)
2. `~/.claude/agents/` (global user)
3. Plugin cache agents
4. Marketplace agents

Same-name agents at higher priority shadow lower ones.
