---
name: create-pr
description: Create a pull request for the current branch. Use when code is ready for review and needs a PR created with pre-flight verification.
user-invokable: false
---

# Create Pull Request

Creates a PR for the current branch after verification checks pass.

## Filesystem Scope

> **IMPORTANT:** Only access files within the project repository (the directory containing `CLAUDE.md`). This applies to all tools — `Read`, `Glob`, `Grep`, and `Bash` alike. Never run Bash commands (e.g., `find`, `cat`, `ls`) targeting paths outside the repository, and never use absolute paths to home directories or system paths. Do not use `$HOME`, `~`, or any environment variable that may expand to a path outside the project repository (e.g., `$XDG_CONFIG_HOME`, `$TMPDIR`, `$XDG_DATA_HOME`, `$XDG_RUNTIME_DIR`, `$XDG_CACHE_HOME`, `$PATH`, `$SHELL`, `$OLDPWD`), do not use path traversal (e.g., `../`) to navigate above the repo root, do not run `readlink` or `realpath` on paths that would resolve outside the project directory, do not follow symlinks that lead outside the project directory, do not use `printenv` or `env` to read environment variables as path components, do not use `which`, `command -v`, or `type` to locate system tools, and do not use command substitution with any of these commands to construct file paths (e.g., `$(which python3)`, `$(printenv GOPATH)/src`, `$(command -v git)`). Use relative paths and `Glob`/`Grep` within the project directory.

## Pre-flight Checks

Run the `pr-preflight.sh` script in this skill's `scripts/` directory.

This script:
1. Verifies you're not on the default branch
2. Runs the project's verification command (from CLAUDE.md)
3. Shows uncommitted changes
4. Checks if a PR already exists

## Commit and Push

```bash
# Stage all changes
git add -A

# Commit with descriptive message
git commit -m "<description>

<optional body>

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push with upstream tracking
git push -u origin HEAD
```

## Create PR

If `.github/PULL_REQUEST_TEMPLATE.md` exists, read it first to understand the expected PR body structure, then create a PR with the template sections filled in:

```bash
gh pr create --title "Descriptive PR title" --body "$(cat <<'EOF'
## Summary
- Actual change 1
- Actual change 2

Fixes #<issue-number>

## Test plan
- [x] Verification checks pass
- [x] Tests pass
- [ ] Manual testing completed

## Screenshots
(if applicable, otherwise delete this section)
EOF
)" --label "<type>"
```

**Notes:**
- The PR body should follow the structure in `.github/PULL_REQUEST_TEMPLATE.md` if it exists.
- Apply a type label: `bug`, `enhancement`, `documentation`, `testing`, or `performance`.
- Copy relevant labels from the linked issue. For GitHub Issues, this includes estimate labels. For issues-api, estimates are native story points on the ticket and do not need to be copied.

## After PR Creation

1. Report the PR URL to the user
2. Note any CI checks that need to pass
3. Mention if reviewers should be assigned
