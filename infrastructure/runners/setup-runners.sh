#!/usr/bin/env bash
set -euo pipefail

# Provision N self-hosted GitHub Actions runners as systemd services.
# Usage: setup-runners.sh --repo OWNER/REPO --count N [--user USER] [--base-dir DIR] [--labels LABELS] [--runner-version VERSION] [--dry-run]

# --- Defaults ---

DEFAULT_COUNT=3
DEFAULT_USER="github-runner"
DEFAULT_LABELS="Linux,X64"
DEFAULT_RUNNER_VERSION="latest"
RUNNER_ARCH="x64"

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

run_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        printf "\033[0;36m[dry-run]\033[0m %s\n" "$*"
    else
        "$@"
    fi
}

sudo_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        printf "\033[0;36m[dry-run]\033[0m sudo %s\n" "$*"
    else
        sudo "$@"
    fi
}

# --- Argument parsing ---

usage() {
    cat <<EOF
Usage: $(basename "$0") --repo OWNER/REPO [OPTIONS]

Options:
  --repo OWNER/REPO       GitHub repo to register runners against (required)
  --count N               Number of runner instances (default: $DEFAULT_COUNT)
  --user USER             System user to run under (default: $DEFAULT_USER)
  --base-dir DIR          Base directory for runner installs (default: /home/<user>)
  --labels LABELS         Extra runner labels (default: $DEFAULT_LABELS)
  --runner-version VER    Actions runner version (default: latest)
  --dry-run               Print commands instead of executing them
  -h, --help              Show this help
EOF
    exit 0
}

REPO=""
COUNT="$DEFAULT_COUNT"
RUNNER_USER="$DEFAULT_USER"
BASE_DIR=""
LABELS="$DEFAULT_LABELS"
RUNNER_VERSION="$DEFAULT_RUNNER_VERSION"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo)         REPO="$2"; shift 2 ;;
        --count)        COUNT="$2"; shift 2 ;;
        --user)         RUNNER_USER="$2"; shift 2 ;;
        --base-dir)     BASE_DIR="$2"; shift 2 ;;
        --labels)       LABELS="$2"; shift 2 ;;
        --runner-version) RUNNER_VERSION="$2"; shift 2 ;;
        --dry-run)      DRY_RUN="true"; shift ;;
        -h|--help)      usage ;;
        *)              error "Unknown option: $1" ;;
    esac
done

[[ -z "$REPO" ]] && error "Missing required option: --repo OWNER/REPO"
[[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && error "Invalid repo format: '$REPO'. Expected OWNER/REPO."
[[ ! "$COUNT" =~ ^[1-9][0-9]*$ ]] && error "Invalid count: '$COUNT'. Must be a positive integer."

REPO_NAME="${REPO#*/}"
[[ -z "$BASE_DIR" ]] && BASE_DIR="/home/$RUNNER_USER"
HOSTNAME_PREFIX="$(hostname -s)"

# --- Prerequisites ---

check_prerequisites() {
    info "Checking prerequisites..."
    local missing=()

    command -v gh >/dev/null 2>&1 || missing+=("gh")
    command -v curl >/dev/null 2>&1 || missing+=("curl")
    command -v tar >/dev/null 2>&1 || missing+=("tar")

    if [[ "$(uname -s)" != "Linux" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            warn "Not running on Linux — dry-run mode will show what would happen on a Linux host."
        else
            error "This script requires Linux with systemd."
        fi
    else
        command -v systemctl >/dev/null 2>&1 || missing+=("systemctl")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Required tools not found: ${missing[*]}. Please install them and re-run."
    fi

    info "Prerequisites satisfied."
}

# --- User management ---

ensure_user() {
    if id "$RUNNER_USER" >/dev/null 2>&1; then
        info "User '$RUNNER_USER' already exists."
    else
        info "Creating system user '$RUNNER_USER'..."
        sudo_cmd useradd --system --shell /usr/bin/false --create-home --home-dir "$BASE_DIR" "$RUNNER_USER"
    fi
}

# --- Runner version resolution ---

resolve_runner_version() {
    if [[ "$RUNNER_VERSION" == "latest" ]]; then
        info "Resolving latest runner version..."
        if [[ "$DRY_RUN" == "true" ]]; then
            RUNNER_VERSION="2.321.0"
            info "Using placeholder version $RUNNER_VERSION for dry-run."
        else
            RUNNER_VERSION=$(gh api repos/actions/runner/releases/latest --jq '.tag_name' | sed 's/^v//')
            info "Latest runner version: $RUNNER_VERSION"
        fi
    fi
}

# --- Registration token ---

fetch_registration_token() {
    info "Fetching registration token for $REPO..."
    if [[ "$DRY_RUN" == "true" ]]; then
        REG_TOKEN="DRY_RUN_TOKEN_PLACEHOLDER"
        info "Using placeholder token for dry-run."
    else
        REG_TOKEN=$(gh api "repos/$REPO/actions/runners/registration-token" --method POST --jq '.token')
        [[ -z "$REG_TOKEN" ]] && error "Failed to fetch registration token. Is 'gh' authenticated with admin access?"
    fi
}

# --- Runner setup ---

setup_runner() {
    local index="$1"
    local runner_name="${HOSTNAME_PREFIX}-${REPO_NAME}-${index}"
    local runner_dir="${BASE_DIR}/actions-runner-${REPO_NAME}-${index}"
    local tarball_url="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"

    info "Setting up runner $index: $runner_name"

    # Idempotency: skip if runner directory exists and is configured
    if [[ -f "$runner_dir/.runner" ]] && [[ "$DRY_RUN" != "true" ]]; then
        warn "Runner '$runner_name' already configured at $runner_dir — skipping."
        return 0
    fi

    # Create and extract
    info "  Creating directory $runner_dir..."
    sudo_cmd mkdir -p "$runner_dir"
    sudo_cmd chown "$RUNNER_USER:$(id -gn "$RUNNER_USER" 2>/dev/null || echo "$RUNNER_USER")" "$runner_dir"

    info "  Downloading actions-runner v${RUNNER_VERSION}..."
    if [[ "$DRY_RUN" == "true" ]]; then
        run_cmd curl -sL "$tarball_url" -o "$runner_dir/actions-runner.tar.gz"
        run_cmd tar -xzf "$runner_dir/actions-runner.tar.gz" -C "$runner_dir"
        run_cmd rm -f "$runner_dir/actions-runner.tar.gz"
    else
        sudo -u "$RUNNER_USER" bash -c "cd '$runner_dir' && curl -sL '$tarball_url' -o actions-runner.tar.gz && tar -xzf actions-runner.tar.gz && rm -f actions-runner.tar.gz"
    fi

    # Configure
    info "  Configuring runner '$runner_name'..."
    if [[ "$DRY_RUN" == "true" ]]; then
        run_cmd sudo -u "$RUNNER_USER" "$runner_dir/config.sh" \
            --unattended \
            --url "https://github.com/$REPO" \
            --token "$REG_TOKEN" \
            --name "$runner_name" \
            --labels "$LABELS" \
            --replace
    else
        sudo -u "$RUNNER_USER" "$runner_dir/config.sh" \
            --unattended \
            --url "https://github.com/$REPO" \
            --token "$REG_TOKEN" \
            --name "$runner_name" \
            --labels "$LABELS" \
            --replace
    fi

    # Install and start systemd service
    info "  Installing systemd service..."
    sudo_cmd bash -c "cd '$runner_dir' && ./svc.sh install '$RUNNER_USER'"

    info "  Starting service..."
    sudo_cmd bash -c "cd '$runner_dir' && ./svc.sh start"

    info "  Runner '$runner_name' is ready."
}

# --- Main ---

main() {
    info "GitHub Actions Runner Setup"
    info "  Repo:    $REPO"
    info "  Count:   $COUNT"
    info "  User:    $RUNNER_USER"
    info "  Base:    $BASE_DIR"
    info "  Labels:  $LABELS"
    [[ "$DRY_RUN" == "true" ]] && info "  Mode:    DRY RUN"
    echo

    check_prerequisites
    ensure_user
    resolve_runner_version
    fetch_registration_token

    for i in $(seq 1 "$COUNT"); do
        setup_runner "$i"
    done

    echo
    info "Setup complete! $COUNT runner(s) registered for $REPO."
    info ""
    info "Summary:"
    for i in $(seq 1 "$COUNT"); do
        local runner_name="${HOSTNAME_PREFIX}-${REPO_NAME}-${i}"
        info "  - $runner_name"
    done
    echo
    info "View runners: gh api repos/$REPO/actions/runners --jq '.runners[] | .name'"
    info "List services: ./list-runners.sh"
}

main "$@"
