---
name: new-work
description: Create a new worktree and branch for feature development. Use when starting work on a new issue or feature.
user-invokable: false
---

# New Work Setup

Creates an isolated worktree for feature development, keeping the default branch clean.

## Usage

```
/new-work <issue-number>-<branch-name>
```

**Branch names MUST be prefixed with the GitHub issue number.** This ensures traceability between worktrees and their associated issues.

Example: `/new-work 42-add-sound-effects`

If you don't have an issue number yet, create one first:
```bash
gh issue create --title "Description of the work" --label "enhancement" --body "..."
```

## What It Does

1. **Runs pre-flight check**: Checks for orphaned worktree directories
2. **Validates branch name**: Ensures it starts with an issue number
3. **Creates worktree**: `.worktrees/<branch-name>` (subdirectory of main repo)
4. **Creates branch**: `<branch-name>` tracking the default remote branch

## Command

Run the `create-worktree.sh` script from the `project-ops` skill.

The script handles:
- Pre-flight orphan check
- Branch name validation (must start with issue number)
- Creating `.worktrees/` directory if needed
- Creating the worktree and branch
- Error handling for existing branches/directories

**Important:** The `cd` command won't persist across tool calls. After creating the worktree, each subsequent command should `cd` to the worktree first.

```bash
# Verify setup
cd .worktrees/${BRANCH_NAME} && git branch --show-current
```

## After Setup

1. Confirm the worktree was created: `ls .worktrees/<branch-name>`
2. Confirm branch: `cd .worktrees/<branch-name> && git branch --show-current`
3. Begin work using the `/lead` workflow or direct implementation

## Cleanup (after PR merged)

Run the `cleanup-worktree.sh` script from the `project-ops` skill.

## Notes

- Never work directly on the default branch — always use worktrees
- Worktrees are stored in `.worktrees/` subdirectory (gitignored)
- Branch names MUST start with the issue number, followed by a hyphen and descriptive name
- Branch names should be lowercase and hyphenated
- Examples: `123-fix-scoring-bug`, `45-add-haptic-feedback`
