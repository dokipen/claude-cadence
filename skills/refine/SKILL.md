---
name: refine
description: Refine GitHub issues to ensure quality standards before work begins
disable-model-invocation: true
---

# Ticket Refinement

Refine GitHub issues to meet quality standards before implementation begins.

## Usage

```
/refine           # Refine all unrefined open issues
/refine 123       # Refine specific issue #123
```

## Workflow

### Single Issue (`/refine 123`)

1. **Delegate to ticket-refiner agent:**
   ```
   Review and refine issue #123.

   Check all refinement criteria and report findings.
   For any missing items, suggest fixes.
   Ask me before making subjective decisions (estimates, title rewrites).
   ```

2. **Apply fixes** based on agent recommendations (with user approval for subjective items)

3. **Mark refined** when all criteria pass:
   ```bash
   gh issue edit 123 --add-label "refined"
   ```

### Batch Refinement (`/refine`)

1. **Get unrefined open issues:**
   ```bash
   gh issue list --state open --json number,title,labels \
     --jq '.[] | select(.labels | map(.name) | contains(["refined"]) | not) | "\(.number): \(.title)"'
   ```

2. **For each issue**, delegate to ticket-refiner agent

3. **Present summary** of all issues reviewed and changes made

## Refinement Criteria

An issue is refined when it has ALL of:

| Criterion | Description |
|-----------|-------------|
| Clear title | Descriptive, NO type prefixes (use labels) |
| Acceptance criteria | Checkboxes defining "done" |
| Estimate label | estimate:1 through estimate:13 |
| Type label | bug, enhancement, documentation, testing, or performance |
| Assigned | Assigned to a developer |
| Blockers linked | Via GitHub dependencies API (not just markdown) |
| Blocked label | `blocked` label if open blockers exist, removed if not |
| Refined label | Added after all criteria met |

## Quick Reference

### Estimate Scale

| Label | Description |
|-------|-------------|
| estimate:1 | Trivial, <1 hour |
| estimate:2 | Simple, few hours |
| estimate:3 | Straightforward, half day |
| estimate:5 | Moderate, 1 day |
| estimate:8 | Significant, 2-3 days |
| estimate:13 | Very large, consider breaking down |

### Title Conventions

**Wrong:** `feat: Add achievements` | **Right:** `Add achievements` + `enhancement` label
