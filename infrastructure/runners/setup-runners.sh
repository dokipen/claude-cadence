#!/usr/bin/env bash
set -euo pipefail

# Provision N self-hosted GitHub Actions runners as systemd (Linux) or launchd (macOS) services.
# Usage: setup-runners.sh --repo OWNER/REPO --count N [--user USER] [--base-dir DIR] [--labels LABELS] [--runner-version VERSION] [--dry-run]

# --- Defaults ---

DEFAULT_COUNT=3
DEFAULT_USER="github-runner"
DEFAULT_RUNNER_VERSION="latest"

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

# --- Platform detection ---

detect_platform() {
    case "$(uname -s)" in
        Linux)
            OS="linux"
            RUNNER_OS="linux"
            ;;
        Darwin)
            OS="darwin"
            RUNNER_OS="osx"
            ;;
        *)
            error "Unsupported operating system: $(uname -s)"
            ;;
    esac

    case "$(uname -m)" in
        x86_64)  RUNNER_ARCH="x64" ;;
        aarch64) RUNNER_ARCH="arm64" ;;
        arm64)   RUNNER_ARCH="arm64" ;;
        *)       error "Unsupported architecture: $(uname -m)" ;;
    esac
}

# --- Argument parsing ---

usage() {
    cat <<EOF
Usage: $(basename "$0") --repo OWNER/REPO [OPTIONS]

Options:
  --repo OWNER/REPO       GitHub repo to register runners against (required)
  --count N               Number of runner instances (default: $DEFAULT_COUNT)
  --user USER             System user to run under (default: $DEFAULT_USER, ignored on macOS)
  --base-dir DIR          Base directory for runner installs (default: platform-dependent)
  --labels LABELS         Extra runner labels (default: platform-dependent)
  --runner-version VER    Actions runner version (default: latest)
  --dry-run               Print commands instead of executing them
  -h, --help              Show this help

Platform defaults:
  Linux:  --base-dir /home/<user>  --labels Linux,X64
  macOS:  --base-dir ~/actions-runner  --labels macOS,<arch>
EOF
    exit 0
}

REPO=""
COUNT="$DEFAULT_COUNT"
RUNNER_USER="$DEFAULT_USER"
BASE_DIR=""
LABELS=""
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

# --- Input validation ---

if [[ -z "$REPO" ]]; then error "Missing required option: --repo OWNER/REPO"; fi
if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then error "Invalid repo format: '$REPO'. Expected OWNER/REPO."; fi
if [[ ! "$COUNT" =~ ^[1-9][0-9]*$ ]]; then error "Invalid count: '$COUNT'. Must be a positive integer."; fi
if [[ ! "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then error "Invalid user name: '$RUNNER_USER'. Must match [a-z_][a-z0-9_-]{0,31}."; fi
if [[ -n "$LABELS" ]]; then
    if [[ ! "$LABELS" =~ ^[A-Za-z0-9_.,:-]+$ ]]; then error "Invalid labels: '$LABELS'. Only alphanumeric, comma, period, colon, hyphen, and underscore allowed."; fi
fi
if [[ "$RUNNER_VERSION" != "latest" ]]; then
    if [[ ! "$RUNNER_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then error "Invalid runner version: '$RUNNER_VERSION'. Expected semver (e.g., 2.321.0)."; fi
fi

# Detect platform and set defaults
detect_platform

REPO_NAME="${REPO#*/}"

# Set platform-dependent defaults
if [[ -z "$BASE_DIR" ]]; then
    if [[ "$OS" == "darwin" ]]; then
        BASE_DIR="$HOME/actions-runner"
    else
        BASE_DIR="/home/$RUNNER_USER"
    fi
fi

if [[ -z "$LABELS" ]]; then
    if [[ "$OS" == "darwin" ]]; then
        if [[ "$RUNNER_ARCH" == "arm64" ]]; then
            LABELS="macOS,ARM64"
        else
            LABELS="macOS,X64"
        fi
    else
        if [[ "$RUNNER_ARCH" == "arm64" ]]; then
            LABELS="Linux,ARM64"
        else
            LABELS="Linux,X64"
        fi
    fi
fi

# Canonicalize and reject path traversal
case "$BASE_DIR" in
    *..*)  error "Invalid base-dir: '$BASE_DIR'. Path traversal not allowed." ;;
esac
if [[ "$BASE_DIR" != /* ]]; then error "Invalid base-dir: '$BASE_DIR'. Must be an absolute path."; fi

HOSTNAME_PREFIX="$(hostname -s)"
if [[ ! "$HOSTNAME_PREFIX" =~ ^[A-Za-z0-9-]+$ ]]; then error "Unexpected hostname format: '$HOSTNAME_PREFIX'. Only alphanumeric and hyphen allowed."; fi

# --- Prerequisites ---

check_prerequisites() {
    info "Checking prerequisites..."
    local missing=()

    command -v gh >/dev/null 2>&1 || missing+=("gh")
    command -v curl >/dev/null 2>&1 || missing+=("curl")
    command -v tar >/dev/null 2>&1 || missing+=("tar")

    # SHA256 verification tool
    if [[ "$OS" == "darwin" ]]; then
        command -v shasum >/dev/null 2>&1 || missing+=("shasum")
    else
        command -v sha256sum >/dev/null 2>&1 || missing+=("sha256sum")
    fi

    # Verify gh is authenticated (GH_TOKEN env var or gh auth status)
    if [[ -z "${GH_TOKEN:-}" ]]; then
        if ! gh auth status >/dev/null 2>&1; then
            error "GitHub CLI is not authenticated. Run 'gh auth login' or set GH_TOKEN."
        fi
    fi

    if [[ "$OS" == "linux" ]]; then
        command -v systemctl >/dev/null 2>&1 || missing+=("systemctl")
    elif [[ "$OS" == "darwin" ]]; then
        command -v launchctl >/dev/null 2>&1 || missing+=("launchctl")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Required tools not found: ${missing[*]}. Please install them and re-run."
    fi

    info "Prerequisites satisfied."
}

# --- User management ---

ensure_user() {
    if [[ "$OS" == "darwin" ]]; then
        # On macOS, runners run as the current user — no system user needed
        if [[ "$RUNNER_USER" != "$(whoami)" ]] && [[ "$RUNNER_USER" != "$DEFAULT_USER" ]]; then
            warn "Ignoring --user '$RUNNER_USER' on macOS — runners run as current user."
        fi
        RUNNER_USER="$(whoami)"
        info "macOS: runners will run as current user '$RUNNER_USER'."
        return 0
    fi

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
            if [[ ! "$RUNNER_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then error "Unexpected runner version format from API: '$RUNNER_VERSION'"; fi
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
        if [[ -z "$REG_TOKEN" ]]; then error "Failed to fetch registration token. Is 'gh' authenticated with admin access?"; fi
    fi
}

# --- Removal token ---

fetch_removal_token() {
    info "Fetching removal token for $REPO..."
    if [[ "$DRY_RUN" == "true" ]]; then
        REMOVE_TOKEN="DRY_RUN_TOKEN_PLACEHOLDER"
        info "Using placeholder token for dry-run."
    else
        REMOVE_TOKEN=$(gh api "repos/$REPO/actions/runners/remove-token" --method POST --jq '.token')
        if [[ -z "$REMOVE_TOKEN" ]]; then error "Failed to fetch removal token. Is 'gh' authenticated with admin access?"; fi
    fi
}

# --- Runner teardown ---

teardown_runner() {
    local runner_dir="$1"
    local dir_name
    dir_name="$(basename "$runner_dir")"

    info "Tearing down runner at $runner_dir..."

    # Stop and uninstall service (svc.sh handles both systemd and launchd)
    if [[ -f "$runner_dir/svc.sh" ]]; then
        info "  Stopping service..."
        if [[ "$OS" == "darwin" ]]; then
            (cd "$runner_dir" && ./svc.sh stop) || true
        else
            (cd "$runner_dir" && sudo ./svc.sh stop) || true
        fi

        info "  Uninstalling service..."
        if [[ "$OS" == "darwin" ]]; then
            (cd "$runner_dir" && ./svc.sh uninstall) || true
        else
            (cd "$runner_dir" && sudo ./svc.sh uninstall) || true
        fi
    elif [[ "$DRY_RUN" == "true" ]]; then
        info "  Stopping service..."
        if [[ "$OS" == "darwin" ]]; then
            dry_run_print "" sh -c "cd $runner_dir && ./svc.sh stop"
        else
            dry_run_print "sudo" sh -c "cd $runner_dir && ./svc.sh stop"
        fi
        info "  Uninstalling service..."
        if [[ "$OS" == "darwin" ]]; then
            dry_run_print "" sh -c "cd $runner_dir && ./svc.sh uninstall"
        else
            dry_run_print "sudo" sh -c "cd $runner_dir && ./svc.sh uninstall"
        fi
    fi

    # Unconfigure runner — pass token via environment variable
    if [[ -f "$runner_dir/config.sh" ]] || [[ "$DRY_RUN" == "true" ]]; then
        info "  Removing runner registration..."
        if [[ "$DRY_RUN" == "true" ]]; then
            dry_run_print "ACTIONS_RUNNER_INPUT_TOKEN=<token>" \
                "$runner_dir/config.sh" remove
        elif [[ "$OS" == "darwin" ]]; then
            ACTIONS_RUNNER_INPUT_TOKEN="$REMOVE_TOKEN" "$runner_dir/config.sh" remove || {
                warn "  Could not unconfigure runner (may already be removed from GitHub)."
            }
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
    if [[ "$OS" == "darwin" ]]; then
        run_cmd rm -rf "$runner_dir"
    else
        sudo_cmd rm -rf "$runner_dir"
    fi

    info "  Runner at $dir_name removed."
}

# --- Excess runner teardown ---

teardown_excess_runners() {
    local excess_dirs=()

    if [[ -d "$BASE_DIR" ]]; then
        while IFS= read -r dir; do
            local index="${dir##*actions-runner-${REPO_NAME}-}"
            if [[ "$index" =~ ^[0-9]+$ ]] && [[ "$index" -gt "$COUNT" ]]; then
                excess_dirs+=("$dir")
            fi
        done < <(find "$BASE_DIR" -maxdepth 1 -type d -name "actions-runner-${REPO_NAME}-*" | sort)
    fi

    if [[ ${#excess_dirs[@]} -eq 0 ]]; then
        return 0
    fi

    info "Found ${#excess_dirs[@]} excess runner(s) to tear down."
    fetch_removal_token

    # Tear down in reverse order (highest index first)
    for (( i=${#excess_dirs[@]}-1; i>=0; i-- )); do
        teardown_runner "${excess_dirs[$i]}"
        TORN_DOWN_COUNT=$((TORN_DOWN_COUNT + 1))
    done

    info "Excess runner teardown complete."
}

# --- Service status check ---

is_service_running() {
    local runner_dir="$1"
    if [[ "$OS" == "linux" ]]; then
        if [[ -f "$runner_dir/.service" ]]; then
            local svc_name
            svc_name=$(cat "$runner_dir/.service")
            if [[ "$svc_name" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
                systemctl is-active "$svc_name" >/dev/null 2>&1
                return $?
            fi
        fi
    elif [[ "$OS" == "darwin" ]]; then
        if [[ -f "$runner_dir/.service" ]]; then
            local svc_name
            svc_name=$(cat "$runner_dir/.service")
            if [[ "$svc_name" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
                launchctl list "$svc_name" >/dev/null 2>&1
                return $?
            fi
        fi
    fi
    return 1
}

# --- Checksum verification ---

verify_checksum() {
    local tarball_path="$1"
    local sha_tag="${RUNNER_OS}-${RUNNER_ARCH}"

    info "  Fetching SHA256 checksum from release v${RUNNER_VERSION}..."
    local release_body
    release_body=$(gh release view "v${RUNNER_VERSION}" --repo actions/runner --json body --jq '.body') \
        || error "Failed to fetch release notes for v${RUNNER_VERSION}. Cannot verify checksum."

    local expected_hash
    expected_hash=$(printf '%s' "$release_body" | sed -n "s/.*<!-- BEGIN SHA ${sha_tag} -->\([a-f0-9]\{64\}\)<!-- END SHA ${sha_tag} -->.*/\1/p")

    if [[ -z "$expected_hash" ]]; then
        error "No SHA256 checksum found for ${sha_tag} in release v${RUNNER_VERSION}."
    fi

    info "  Verifying SHA256 checksum..."
    local actual_hash
    if [[ "$OS" == "darwin" ]]; then
        actual_hash=$(shasum -a 256 "$tarball_path" | awk '{print $1}')
    else
        actual_hash=$(sha256sum "$tarball_path" | awk '{print $1}')
    fi

    if [[ "$actual_hash" != "$expected_hash" ]]; then
        error "SHA256 checksum mismatch for $(basename "$tarball_path").
  Expected: $expected_hash
  Actual:   $actual_hash
Aborting — the downloaded file may be corrupted or tampered with."
    fi

    info "  Checksum verified: $actual_hash"
}

# --- Runner deregistration (without directory removal) ---

deregister_runner() {
    local runner_dir="$1"

    info "  Deregistering runner at $runner_dir..."

    # Stop and uninstall service (svc.sh handles both systemd and launchd)
    if [[ -f "$runner_dir/svc.sh" ]] && [[ -f "$runner_dir/.service" ]]; then
        info "  Stopping service..."
        if [[ "$OS" == "darwin" ]]; then
            (cd "$runner_dir" && ./svc.sh stop) || true
        else
            (cd "$runner_dir" && sudo ./svc.sh stop) || true
        fi

        info "  Uninstalling service..."
        if [[ "$OS" == "darwin" ]]; then
            (cd "$runner_dir" && ./svc.sh uninstall) || true
        else
            (cd "$runner_dir" && sudo ./svc.sh uninstall) || true
        fi
    elif [[ "$DRY_RUN" == "true" ]]; then
        info "  Stopping service..."
        if [[ "$OS" == "darwin" ]]; then
            dry_run_print "" sh -c "cd $runner_dir && ./svc.sh stop"
        else
            dry_run_print "sudo" sh -c "cd $runner_dir && ./svc.sh stop"
        fi
        info "  Uninstalling service..."
        if [[ "$OS" == "darwin" ]]; then
            dry_run_print "" sh -c "cd $runner_dir && ./svc.sh uninstall"
        else
            dry_run_print "sudo" sh -c "cd $runner_dir && ./svc.sh uninstall"
        fi
    fi

    # Remove runner registration — pass token via environment variable
    if [[ -f "$runner_dir/config.sh" ]] || [[ "$DRY_RUN" == "true" ]]; then
        info "  Removing runner registration..."
        if [[ "$DRY_RUN" == "true" ]]; then
            dry_run_print "ACTIONS_RUNNER_INPUT_TOKEN=<token>" \
                "$runner_dir/config.sh" remove
        elif [[ "$OS" == "darwin" ]]; then
            ACTIONS_RUNNER_INPUT_TOKEN="$REMOVE_TOKEN" "$runner_dir/config.sh" remove || true
        else
            export ACTIONS_RUNNER_INPUT_TOKEN="$REMOVE_TOKEN"
            sudo -u "$RUNNER_USER" --preserve-env=ACTIONS_RUNNER_INPUT_TOKEN \
                "$runner_dir/config.sh" remove || true
            unset ACTIONS_RUNNER_INPUT_TOKEN
        fi
    fi
}

# --- Tarball cache download ---

download_runner_tarball() {
    local tarball_url="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-${RUNNER_OS}-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
    local cache_dir="${BASE_DIR}/actions-runner-cache"
    RUNNER_TARBALL_CACHE="${cache_dir}/actions-runner-${RUNNER_OS}-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"

    info "Preparing runner tarball cache..."

    # Create cache directory
    if [[ "$OS" == "darwin" ]]; then
        run_cmd mkdir -p "$cache_dir"
    else
        sudo_cmd mkdir -p "$cache_dir"
    fi

    # If cache file already exists, skip download
    if [[ -f "$RUNNER_TARBALL_CACHE" ]]; then
        info "  Using cached tarball: $RUNNER_TARBALL_CACHE"
        return 0
    fi

    info "  Downloading actions-runner v${RUNNER_VERSION} (${RUNNER_OS}/${RUNNER_ARCH})..."
    if [[ "$DRY_RUN" == "true" ]]; then
        run_cmd curl -sL "$tarball_url" -o "$RUNNER_TARBALL_CACHE"
        dry_run_print "" "verify_checksum" "$RUNNER_TARBALL_CACHE"
    elif [[ "$OS" == "darwin" ]]; then
        curl -sfL "$tarball_url" -o "$RUNNER_TARBALL_CACHE" \
            || error "Failed to download actions-runner tarball from $tarball_url"
        verify_checksum "$RUNNER_TARBALL_CACHE"
    else
        curl -sfL "$tarball_url" -o "$RUNNER_TARBALL_CACHE" \
            || error "Failed to download actions-runner tarball from $tarball_url"
        verify_checksum "$RUNNER_TARBALL_CACHE"
        sudo_cmd chmod a+r "$RUNNER_TARBALL_CACHE"
    fi

    info "  Tarball cached at $RUNNER_TARBALL_CACHE"
}

# --- Runner setup ---

setup_runner() {
    local index="$1"
    local runner_name="${HOSTNAME_PREFIX}-${REPO_NAME}-${index}"
    local runner_dir="${BASE_DIR}/actions-runner-${REPO_NAME}-${index}"

    info "Setting up runner $index: $runner_name"

    # Idempotency: skip if runner directory exists, is configured, and service is running
    if [[ -f "$runner_dir/.runner" ]] && [[ "$DRY_RUN" != "true" ]]; then
        if is_service_running "$runner_dir"; then
            warn "Runner '$runner_name' already configured and running at $runner_dir — skipping."
            return 0
        fi
        warn "Runner '$runner_name' configured but service not running — deregistering and re-installing."
        fetch_removal_token
        deregister_runner "$runner_dir"
    fi

    # Create and extract
    info "  Creating directory $runner_dir..."
    if [[ "$OS" == "darwin" ]]; then
        run_cmd mkdir -p "$runner_dir"
    else
        sudo_cmd mkdir -p "$runner_dir"
        sudo_cmd chown "$RUNNER_USER:$(id -gn "$RUNNER_USER" 2>/dev/null || echo "$RUNNER_USER")" "$runner_dir"
    fi

    info "  Extracting from cached tarball..."
    if [[ "$DRY_RUN" == "true" ]]; then
        run_cmd tar -xzf "$RUNNER_TARBALL_CACHE" -C "$runner_dir"
    elif [[ "$OS" == "darwin" ]]; then
        tar -xzf "$RUNNER_TARBALL_CACHE" -C "$runner_dir"
    else
        sudo -u "$RUNNER_USER" -- sh -c 'tar -xzf "$1" -C "$2"' _ "$RUNNER_TARBALL_CACHE" "$runner_dir"
    fi

    # Configure — pass token via environment variable to avoid process list exposure
    info "  Configuring runner '$runner_name'..."
    if [[ "$DRY_RUN" == "true" ]]; then
        dry_run_print "ACTIONS_RUNNER_INPUT_TOKEN=<token>" \
            "$runner_dir/config.sh" --unattended \
            --url "https://github.com/$REPO" \
            --name "$runner_name" --labels "$LABELS"
    elif [[ "$OS" == "darwin" ]]; then
        ACTIONS_RUNNER_INPUT_TOKEN="$REG_TOKEN" "$runner_dir/config.sh" \
            --unattended \
            --url "https://github.com/$REPO" \
            --name "$runner_name" \
            --labels "$LABELS"
    else
        export ACTIONS_RUNNER_INPUT_TOKEN="$REG_TOKEN"
        sudo -u "$RUNNER_USER" --preserve-env=ACTIONS_RUNNER_INPUT_TOKEN \
            "$runner_dir/config.sh" \
            --unattended \
            --url "https://github.com/$REPO" \
            --name "$runner_name" \
            --labels "$LABELS"
        unset ACTIONS_RUNNER_INPUT_TOKEN
    fi

    # Install and start service (svc.sh handles both systemd and launchd)
    if [[ "$OS" == "darwin" ]]; then
        info "  Installing launchd service..."
        if [[ "$DRY_RUN" == "true" ]]; then
            dry_run_print "" sh -c "cd $runner_dir && ./svc.sh install"
        else
            (cd "$runner_dir" && ./svc.sh install)
        fi

        info "  Starting service..."
        if [[ "$DRY_RUN" == "true" ]]; then
            dry_run_print "" sh -c "cd $runner_dir && ./svc.sh start"
        else
            (cd "$runner_dir" && ./svc.sh start)
        fi
    else
        info "  Installing systemd service..."
        if [[ "$DRY_RUN" == "true" ]]; then
            dry_run_print "sudo" sh -c "cd $runner_dir && ./svc.sh install $RUNNER_USER"
        else
            (cd "$runner_dir" && sudo ./svc.sh install "$RUNNER_USER")
        fi

        info "  Starting service..."
        if [[ "$DRY_RUN" == "true" ]]; then
            dry_run_print "sudo" sh -c "cd $runner_dir && ./svc.sh start"
        else
            (cd "$runner_dir" && sudo ./svc.sh start)
        fi
    fi

    info "  Runner '$runner_name' is ready."
}

# --- Main ---

main() {
    check_prerequisites
    ensure_user

    info "GitHub Actions Runner Setup"
    info "  Repo:      $REPO"
    info "  Count:     $COUNT"
    info "  User:      $RUNNER_USER"
    info "  Base:      $BASE_DIR"
    info "  Labels:    $LABELS"
    info "  Platform:  $OS/$RUNNER_ARCH"
    if [[ "$DRY_RUN" == "true" ]]; then info "  Mode:      DRY RUN"; fi
    echo
    resolve_runner_version
    fetch_registration_token
    download_runner_tarball

    TORN_DOWN_COUNT=0
    teardown_excess_runners

    for i in $(seq 1 "$COUNT"); do
        setup_runner "$i"
    done

    echo
    info "Setup complete! $COUNT runner(s) registered for $REPO."
    if [[ "$TORN_DOWN_COUNT" -gt 0 ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            info "Would tear down $TORN_DOWN_COUNT excess runner(s)."
        else
            info "Torn down $TORN_DOWN_COUNT excess runner(s)."
        fi
    fi
    info ""
    info "Summary:"
    for i in $(seq 1 "$COUNT"); do
        info "  - ${HOSTNAME_PREFIX}-${REPO_NAME}-${i}"
    done
    echo
    info "View runners: gh api repos/$REPO/actions/runners --jq '.runners[] | .name'"
    info "List services: ./list-runners.sh"
}

main "$@"
