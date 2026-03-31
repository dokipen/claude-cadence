---
name: new-work
description: Create a new worktree and branch for feature development. Use when starting work on a new issue or feature.
user-invokable: false
---

# New Work Setup

Creates an isolated worktree for feature development, keeping the default branch clean.

## Filesystem Scope

> **IMPORTANT:** Only access files within the project repository (the directory containing `CLAUDE.md`). This applies to all tools — `Read`, `Glob`, `Grep`, and `Bash` alike. Never run Bash commands (e.g., `find`, `cat`, `ls`) targeting paths outside the repository, and never use absolute paths to home directories or system paths. Do not use `$HOME`, `~`, or any environment variable that may expand to a path outside the project repository (e.g., `$XDG_CONFIG_HOME`, `$TMPDIR`, `$XDG_DATA_HOME`, `$XDG_RUNTIME_DIR`, `$XDG_CACHE_HOME`, `$PATH`, `$SHELL`, `$OLDPWD`), do not use path traversal (e.g., `../`) to navigate above the repo root, do not run `readlink` or `realpath` on paths that would resolve outside the project directory, do not follow symlinks that lead outside the project directory, do not use `printenv` or `env` to read environment variables as path components, do not use `which`, `command -v`, or `type` to locate system tools, and do not use command substitution with any of these commands to construct file paths (e.g., `$(which python3)`, `$(printenv GOPATH)/src`, `$(command -v git)`). Use relative paths and `Glob`/`Grep` within the project directory.

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

**Shell safety:** The `--title` argument is inline — avoid backticks in the title. Use the `github-issues` or `issues-api` skill for guidance on safe patterns.

## What It Does

1. **Runs pre-flight check**: Checks for orphaned worktree directories
2. **Validates branch name**: Ensures it starts with an issue number
3. **Creates worktree**: `.worktrees/<branch-name>` (subdirectory of main repo)
4. **Creates branch**: `<branch-name>` tracking the default remote branch

## Command

First resolve the cadence plugin root, then run the `create-worktree.sh` script:

```bash
# Resolve cadence plugin root. Checks (in order):
# 1. CADENCE_ROOT env var (explicit override, e.g. for --plugin-dir installs)
# 2. Current directory (running directly from the cadence repo)
# 3. .claude/plugins/cadence/ (locally installed plugin)
CADENCE_ROOT="${CADENCE_ROOT:-}"
if [ -z "$CADENCE_ROOT" ] && [ -f ".claude-plugin/plugin.json" ]; then
  CADENCE_ROOT="$(pwd)"
fi
if [ -z "$CADENCE_ROOT" ] && [ -d ".claude/plugins/cadence" ]; then
  CADENCE_ROOT="$(pwd)/.claude/plugins/cadence"
fi
if [ -z "$CADENCE_ROOT" ]; then
  echo "ERROR: cadence plugin root not found. Set CADENCE_ROOT env var to the plugin directory." >&2
  exit 1
fi
bash "$CADENCE_ROOT/skills/project-ops/scripts/create-worktree.sh" "${BRANCH_NAME}"
```

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
