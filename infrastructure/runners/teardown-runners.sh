#!/usr/bin/env bash
set -euo pipefail

# Remove self-hosted GitHub Actions runners for a given repo.
# Usage: teardown-runners.sh --repo OWNER/REPO [--user USER] [--base-dir DIR] [--dry-run]

# --- Defaults ---

DEFAULT_USER="github-runner"

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

dry_run_print() {
    local prefix="$1"; shift
    printf "\033[0;36m[dry-run]\033[0m %s" "$prefix"
    printf " %q" "$@"
    printf "\n"
}

run_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        dry_run_print "" "$@"
    else
        "$@"
    fi
}

sudo_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        dry_run_print "sudo" "$@"
    else
        sudo "$@"
    fi
}

# --- Argument parsing ---

usage() {
    cat <<EOF
Usage: $(basename "$0") --repo OWNER/REPO [OPTIONS]

Options:
  --repo OWNER/REPO       GitHub repo to remove runners for (required)
  --user USER             System user runners run under (default: $DEFAULT_USER)
  --base-dir DIR          Base directory for runner installs (default: /home/<user>)
  --dry-run               Print commands instead of executing them
  -h, --help              Show this help
EOF
    exit 0
}

REPO=""
RUNNER_USER="$DEFAULT_USER"
BASE_DIR=""
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo)     REPO="$2"; shift 2 ;;
        --user)     RUNNER_USER="$2"; shift 2 ;;
        --base-dir) BASE_DIR="$2"; shift 2 ;;
        --dry-run)  DRY_RUN="true"; shift ;;
        -h|--help)  usage ;;
        *)          error "Unknown option: $1" ;;
    esac
done

# --- Input validation ---

[[ -z "$REPO" ]] && error "Missing required option: --repo OWNER/REPO"
[[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && error "Invalid repo format: '$REPO'. Expected OWNER/REPO."
[[ ! "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] && error "Invalid user name: '$RUNNER_USER'. Must match [a-z_][a-z0-9_-]{0,31}."

REPO_NAME="${REPO#*/}"
[[ -z "$BASE_DIR" ]] && BASE_DIR="/home/$RUNNER_USER"

case "$BASE_DIR" in
    *..*)  error "Invalid base-dir: '$BASE_DIR'. Path traversal not allowed." ;;
esac
[[ "$BASE_DIR" != /* ]] && error "Invalid base-dir: '$BASE_DIR'. Must be an absolute path."

# --- Fetch removal token ---

fetch_removal_token() {
    info "Fetching removal token for $REPO..."
    if [[ "$DRY_RUN" == "true" ]]; then
        REMOVE_TOKEN="DRY_RUN_TOKEN_PLACEHOLDER"
        info "Using placeholder token for dry-run."
    else
        REMOVE_TOKEN=$(gh api "repos/$REPO/actions/runners/remove-token" --method POST --jq '.token')
        [[ -z "$REMOVE_TOKEN" ]] && error "Failed to fetch removal token. Is 'gh' authenticated with admin access?"
    fi
}

# --- Runner teardown ---

teardown_runner() {
    local runner_dir="$1"
    local dir_name
    dir_name="$(basename "$runner_dir")"

    info "Tearing down runner at $runner_dir..."

    # Stop and uninstall systemd service
    if [[ -f "$runner_dir/svc.sh" ]]; then
        info "  Stopping service..."
        (cd "$runner_dir" && sudo ./svc.sh stop) || true

        info "  Uninstalling service..."
        (cd "$runner_dir" && sudo ./svc.sh uninstall) || true
    elif [[ "$DRY_RUN" == "true" ]]; then
        info "  Stopping service..."
        dry_run_print "sudo" sh -c "cd $runner_dir && ./svc.sh stop"
        info "  Uninstalling service..."
        dry_run_print "sudo" sh -c "cd $runner_dir && ./svc.sh uninstall"
    fi

    # Unconfigure runner — pass token via environment variable
    if [[ -f "$runner_dir/config.sh" ]] || [[ "$DRY_RUN" == "true" ]]; then
        info "  Removing runner registration..."
        if [[ "$DRY_RUN" == "true" ]]; then
            dry_run_print "ACTIONS_RUNNER_INPUT_TOKEN=<token> sudo -u $RUNNER_USER" \
                "$runner_dir/config.sh" remove
        else
            export ACTIONS_RUNNER_INPUT_TOKEN="$REMOVE_TOKEN"
            sudo -u "$RUNNER_USER" --preserve-env=ACTIONS_RUNNER_INPUT_TOKEN \
                "$runner_dir/config.sh" remove || {
                warn "  Could not unconfigure runner (may already be removed from GitHub)."
            }
            unset ACTIONS_RUNNER_INPUT_TOKEN
        fi
    fi

    # Remove directory
    info "  Removing directory $runner_dir..."
    sudo_cmd rm -rf "$runner_dir"

    info "  Runner at $dir_name removed."
}

# --- Main ---

main() {
    info "GitHub Actions Runner Teardown"
    info "  Repo: $REPO"
    info "  User: $RUNNER_USER"
    info "  Base: $BASE_DIR"
    [[ "$DRY_RUN" == "true" ]] && info "  Mode: DRY RUN"
    echo

    # Find runner directories for this repo using find to avoid glob word-splitting
    local runner_dirs=()

    if [[ -d "$BASE_DIR" ]]; then
        while IFS= read -r dir; do
            runner_dirs+=("$dir")
        done < <(find "$BASE_DIR" -maxdepth 1 -type d -name "actions-runner-${REPO_NAME}-*" | sort)
    fi

    if [[ "$DRY_RUN" == "true" ]] && [[ ${#runner_dirs[@]} -eq 0 ]]; then
        info "No directories found (expected in dry-run). Showing example teardown for 3 runners."
        fetch_removal_token
        for i in 1 2 3; do
            local example_dir="${BASE_DIR}/actions-runner-${REPO_NAME}-${i}"
            info "Would tear down: $example_dir"
            teardown_runner "$example_dir"
        done
        echo
        info "Teardown complete (dry-run)."
        return 0
    fi

    if [[ ${#runner_dirs[@]} -eq 0 ]]; then
        warn "No runner directories found in $BASE_DIR matching actions-runner-${REPO_NAME}-*"
        info "Nothing to tear down."
        return 0
    fi

    info "Found ${#runner_dirs[@]} runner(s) to remove."
    fetch_removal_token

    for runner_dir in "${runner_dirs[@]}"; do
        teardown_runner "$runner_dir"
    done

    echo
    info "Teardown complete! ${#runner_dirs[@]} runner(s) removed for $REPO."
}

main "$@"
