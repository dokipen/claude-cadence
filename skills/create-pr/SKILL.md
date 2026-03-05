---
name: create-pr
description: Create a pull request for the current branch
---

# Create Pull Request

Creates a PR for the current branch after verification checks pass.

## Pre-flight Checks

Run the pre-flight script:

```bash
./scripts/pr-preflight.sh
```

This script:
1. Verifies you're not on the default branch
2. Runs the project's verification command (from CLAUDE.md)
3. Shows uncommitted changes
4. Checks if a PR already exists

## Commit and Push

```bash
# Stage all changes
git add -A

# Commit with conventional commit message
git commit -m "<type>: <description>

<optional body>

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push with upstream tracking
git push -u origin HEAD
```

### Commit Types
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or updating tests
- `docs`: Documentation changes
- `chore`: Maintenance tasks

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
)"
```

**Note:** The PR body should follow the structure in `.github/PULL_REQUEST_TEMPLATE.md` if it exists.

## After PR Creation

1. Report the PR URL to the user
2. Note any CI checks that need to pass
3. Mention if reviewers should be assigned
