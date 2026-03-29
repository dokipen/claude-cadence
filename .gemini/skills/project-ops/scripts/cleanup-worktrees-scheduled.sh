#!/usr/bin/env bash
# Scheduled cleanup of merged worktrees and branches across all agentd-managed repos.
#
# Designed to run as a systemd timer or launchd periodic job.
# Scans all repos under REPOS_DIR and removes worktrees whose PRs are merged.
#
# Usage:
#   cleanup-worktrees-scheduled.sh [--repos-dir DIR]
#
# Options:
#   --repos-dir DIR   Base directory containing owner/repo subdirs
#                     (default: /var/lib/agentd/repos, or $AGENTD_ROOT_DIR/repos)
#
set -euo pipefail

DEFAULT_ROOT_DIR="/var/lib/agentd"

usage() {
    echo "Usage: $(basename "$0") [--repos-dir DIR]" >&2
    exit 1
}

# --- Argument parsing ---

REPOS_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --repos-dir)
            [[ $# -ge 2 ]] || usage
            REPOS_DIR="$2"
            shift 2
            ;;
        *) usage ;;
    esac
done

if [[ -z "$REPOS_DIR" ]]; then
    REPOS_DIR="${AGENTD_ROOT_DIR:-$DEFAULT_ROOT_DIR}/repos"
fi

# --- Cleanup function for a single repo ---
#
# Runs inside a subshell so the caller's working directory is unaffected.
# Mirrors the logic in cleanup-merged-worktrees.sh with repo-agnostic git commands.

cleanup_repo() {
    local repo_dir="$1"
    (
        cd "$repo_dir" || return 0

        local worktrees_dir="$repo_dir/.worktrees"
        [[ -d "$worktrees_dir" ]] || return 0

        echo "==> Scanning $repo_dir"

        # Collect all branches currently checked out in any worktree.
        # This protects against removing worktrees in active use by concurrent sessions.
        # The `|| true` prevents pipefail from aborting when no feature branches are active.
        local active_branches
        active_branches=$(git worktree list --porcelain 2>/dev/null | grep '^branch ' | sed 's|^branch refs/heads/||' || true)

        local cleaned=0
        for dir in "$worktrees_dir"/*/; do
            [[ -d "$dir" ]] || continue
            local branch_name
            branch_name=$(basename "$dir")

            # Validate branch name format (issue-number prefix required)
            if [[ ! "$branch_name" =~ ^[0-9]+-[a-zA-Z0-9_-]+$ ]]; then
                continue
            fi

            # Skip worktrees in active use
            if echo "$active_branches" | grep -qx "$branch_name"; then
                echo "  Skipping '$branch_name' — currently checked out in an active worktree"
                continue
            fi

            # Extract issue number from branch name (e.g., "42-add-feature" -> "42")
            local issue_number
            issue_number=$(echo "$branch_name" | grep -oE '^[0-9]+')

            # Check if a merged PR exists for this branch
            local merged_pr
            merged_pr=$(gh pr list --head "$branch_name" --state merged --json number --jq '.[0].number' 2>/dev/null || echo "")
            if [[ ! "$merged_pr" =~ ^[0-9]+$ ]]; then
                continue
            fi

            echo "  Cleaning '$branch_name' (PR #$merged_pr merged)..."

            # Re-check active worktrees immediately before destructive steps (TOCTOU protection)
            if git worktree list --porcelain 2>/dev/null | grep -q "^branch refs/heads/$branch_name$"; then
                echo "  Skipping '$branch_name' — became active since scan started"
                continue
            fi

            # Delete remote branch (may already be deleted by the PR merge)
            git push origin --delete "$branch_name" 2>/dev/null || true

            # Remove worktree directory.
            # The branch_name regex above already excludes '/' but we guard again here
            # for defence-in-depth before the rm -rf fallback.
            if [[ -d "$worktrees_dir/$branch_name" ]]; then
                if [[ "$branch_name" == *"/"* ]]; then
                    echo "  Warning: skipping '$branch_name' — unexpected '/' in branch name"
                else
                    git worktree remove "$worktrees_dir/$branch_name" 2>/dev/null \
                        || git worktree remove --force "$worktrees_dir/$branch_name" 2>/dev/null \
                        || rm -rf "${worktrees_dir:?}/${branch_name:?}" \
                        || echo "  Warning: failed to remove worktree directory for '$branch_name'"
                fi
            fi

            # Delete local branch
            git branch -D "$branch_name" 2>/dev/null || true

            # Remove in-progress label from the GitHub issue
            gh issue edit "$issue_number" --remove-label "in-progress" 2>/dev/null || true

            echo "  Done: worktree, branch, and label cleaned for issue #$issue_number"
            cleaned=$((cleaned + 1))
        done

        # Prune any remaining orphaned worktree references (idempotent)
        git worktree prune 2>/dev/null || true

        if [[ $cleaned -gt 0 ]]; then
            echo "  Cleaned $cleaned merged worktree(s) in $(basename "$repo_dir")"
        fi
    )
}

# --- Main ---

if [[ ! -d "$REPOS_DIR" ]]; then
    echo "Repos directory not found: $REPOS_DIR — nothing to clean"
    exit 0
fi

echo "Starting scheduled worktree cleanup (repos dir: $REPOS_DIR)"

# Scan owner/repo (two levels deep) under REPOS_DIR
for owner_dir in "$REPOS_DIR"/*/; do
    [[ -d "$owner_dir" ]] || continue
    for repo_dir in "$owner_dir"*/; do
        [[ -d "$repo_dir" ]] || continue
        # Must be a git repo (standard .git dir or worktree .git file)
        [[ -d "$repo_dir/.git" ]] || [[ -f "$repo_dir/.git" ]] || continue
        cleanup_repo "$repo_dir"
    done
done

echo "Scheduled cleanup complete."
