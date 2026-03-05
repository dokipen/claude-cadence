---
name: github-issues
description: Managing GitHub issues with the gh CLI for tracking work, creating tasks, and coordinating agent activities. Use when working with GitHub issues, labels, estimates, dependencies, or commenting on issues.
user-invokable: false
---

## Overview

This skill covers GitHub issue management using the `gh` CLI. Issues track bugs, features, and tasks. Agents use these commands to pick up work, create issues for discovered problems, and update progress.

## Prerequisites

The `gh` CLI must be authenticated: `gh auth status`

## Listing Issues

```bash
gh issue list
gh issue list --label "bug"
gh issue list --assignee @me
gh issue list --search "keyword" --state open
gh issue list --json number,title,labels,assignees
```

## Reading Issue Details

```bash
gh issue view 42
gh issue view 42 --comments
gh issue view 42 --json title,body,labels,assignees,state
```

## Creating Issues

```bash
gh issue create \
  --title "Brief descriptive title" \
  --body "$(cat <<'EOF'
## Description
[Clear explanation of the work]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Notes
[Any additional context]
EOF
)"
```

**Title conventions:**
- Use clear, descriptive titles
- Categorize via labels, not title prefixes

## Updating Issues

```bash
gh issue edit 42 --title "New title"
gh issue edit 42 --add-label "enhancement"
gh issue edit 42 --remove-label "bug"
gh issue close 42 --comment "Fixed in PR #45"
gh issue reopen 42
```

## Estimation

### Available estimate labels
- `estimate:1` — Very small, trivial, <1 hour
- `estimate:2` — Small, simple, few hours
- `estimate:3` — Medium-small, straightforward, half day
- `estimate:5` — Medium, moderate complexity, 1 day
- `estimate:8` — Large, significant work, 2-3 days
- `estimate:13` — Very large, consider breaking down

### Check/set estimates
```bash
gh issue view 42 --json labels --jq '.labels[].name | select(startswith("estimate:"))'
gh issue edit 42 --add-label "estimate:5"
```

## Commenting

```bash
gh issue comment 42 --body "Comment text"
gh issue comment 42 --body "$(cat <<'EOF'
## Progress Update
- [x] Completed initial research
- [ ] Implementation in progress
EOF
)"
```

## Issue Dependencies

```bash
# Get issue ID (required for dependency API)
gh api repos/{owner}/{repo}/issues/42 --jq '.id'

# List blockers
gh api repos/{owner}/{repo}/issues/42/dependencies/blocked_by

# Add blocker
BLOCKER_ID=$(gh api repos/{owner}/{repo}/issues/317 --jq '.id')
gh api repos/{owner}/{repo}/issues/318/dependencies/blocked_by -X POST -F issue_id=$BLOCKER_ID
```

## Linking Issues to PRs

Use closing keywords in PR descriptions:
- `Fixes #42`
- `Closes #42`
- `Resolves #42`

## Agent Workflow

```bash
# Claim issue
gh issue edit 42 --add-label "in-progress"
gh issue comment 42 --body "Starting work on this issue."

# Progress update
gh issue comment 42 --body "## Progress Update
**Status:** In Progress
**Completed:** ...
**Blockers:** None"

# Mark complete
gh issue comment 42 --body "## Work Complete
**Summary:** ...
**PR:** #50"
```

## JSON Output & Filtering

```bash
gh issue list --json number,title,state,labels
gh issue list --json number,title,labels --jq '.[] | "\(.number): \(.title)"'
```

## GraphQL Rate Limit Fallback

The `gh` CLI uses GraphQL by default for commands like `gh issue list` and `gh issue view --json`. If you hit GraphQL rate limits (HTTP 403 or "API rate limit exceeded"), fall back to REST equivalents via `gh api`:

```bash
# List issues (REST)
gh api repos/{owner}/{repo}/issues --jq '.[] | "\(.number): \(.title)"'

# View issue details (REST)
gh api repos/{owner}/{repo}/issues/42

# List issue comments (REST)
gh api repos/{owner}/{repo}/issues/42/comments

# List issue labels (REST)
gh api repos/{owner}/{repo}/issues/42/labels --jq '.[].name'

# Add a label (REST)
gh api repos/{owner}/{repo}/issues/42/labels -X POST --input - <<< '{"labels":["enhancement"]}'

# Create an issue (REST)
gh api repos/{owner}/{repo}/issues -X POST -f title="Title" -f body="Body"

# Close an issue (REST)
gh api repos/{owner}/{repo}/issues/42 -X PATCH -f state="closed"
```

Get `{owner}/{repo}` dynamically with:
```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```
