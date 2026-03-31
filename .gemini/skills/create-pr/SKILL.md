---
name: create-pr
description: Create a pull request for the current branch. Use when code is ready for review and needs a PR created with pre-flight verification.
user-invokable: false
---

# Create Pull Request

Creates a PR for the current branch after verification checks pass.

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

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

**If `.github/PULL_REQUEST_TEMPLATE.md` exists:** Read it first to understand the expected PR body structure, then create the PR using that template's sections filled in.

**If no project PR template exists (use the following fallback ONLY in this case):**

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
- Apply a type label: `bug`, `enhancement`, `documentation`, `testing`, or `performance`.
- Copy relevant labels from the linked issue. For GitHub Issues, this includes estimate labels. For issues-api, estimates are native story points on the ticket and do not need to be copied.

## After PR Creation

1. Report the PR URL to the user
2. Note any CI checks that need to pass
3. Mention if reviewers should be assigned