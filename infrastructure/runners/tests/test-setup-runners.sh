#!/usr/bin/env bash
# Reproduction tests for three bugs in setup-runners.sh
# Run from any directory: bash infrastructure/runners/tests/test-setup-runners.sh

set -uo pipefail

PASS=0
FAIL=0

ok()   { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../setup-runners.sh"

if [[ ! -f "$SCRIPT" ]]; then
    echo "ERROR: setup-runners.sh not found at $SCRIPT"
    exit 2
fi

# ---------------------------------------------------------------------------
# Bug 1 — Expired registration: no `config.sh remove` before re-configure
#
# When a runner dir has a .runner file but its service is not running, the
# script should call `config.sh remove` to clean up the stale registration
# before re-configuring.
#
# Fix: a `deregister_runner` function exists and calls `config.sh remove`.
# The idempotency block in `setup_runner` calls `deregister_runner` when
# the service is not running.
#
# Test strategy: source-level grep.
#   - Assert `deregister_runner` function is defined in the script.
#   - Assert `config.sh remove` is called within `deregister_runner`.
# ---------------------------------------------------------------------------
echo "--- Bug 1: config.sh remove missing before re-configure ---"

# Check that deregister_runner function is defined
if grep -q "^deregister_runner()" "$SCRIPT"; then
    ok "Bug1: 'deregister_runner' function is defined in script"
else
    fail "Bug1: 'deregister_runner' function not found in script"
fi

# Check that config.sh remove is called inside deregister_runner
# Extract function body and look for the remove call
deregister_body=$(awk '/^deregister_runner\(\)/,/^\}/' "$SCRIPT")
if echo "$deregister_body" | grep -q "config\.sh.*remove\|config\.sh remove"; then
    ok "Bug1: 'config.sh remove' is called within deregister_runner"
else
    fail "Bug1: 'config.sh remove' not found within deregister_runner body"
fi

# ---------------------------------------------------------------------------
# Bug 2 — Tarball downloaded per-runner (not cached)
#
# setup_runner() downloads the tarball on every call, so --count 3 triggers
# three separate curl invocations.  After the fix, the tarball should be
# downloaded once and reused.
#
# Test strategy: dry-run with --count 3, count [dry-run] curl lines.
#   Expected after fix : exactly 1 curl invocation
#   Current (bug)      : 3 curl invocations  → this assertion FAILS
# ---------------------------------------------------------------------------
echo "--- Bug 2: tarball downloaded per-runner (not cached) ---"

TMPDIR_B2="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_B2"' EXIT

# Stubs directory — must be on PATH before real tools
STUB_DIR="$TMPDIR_B2/stubs"
mkdir -p "$STUB_DIR"

# gh stub: satisfy auth check and any gh calls during dry-run
cat > "$STUB_DIR/gh" << 'GHEOF'
#!/usr/bin/env bash
# Minimal gh stub for dry-run tests
exit 0
GHEOF
chmod +x "$STUB_DIR/gh"

# curl stub: just exit 0 (dry-run only prints, doesn't exec)
cat > "$STUB_DIR/curl" << 'CURLEOF'
#!/usr/bin/env bash
exit 0
CURLEOF
chmod +x "$STUB_DIR/curl"

# tar stub
cat > "$STUB_DIR/tar" << 'TAREOF'
#!/usr/bin/env bash
exit 0
TAREOF
chmod +x "$STUB_DIR/tar"

# sha256sum stub
cat > "$STUB_DIR/sha256sum" << 'SHAEOF'
#!/usr/bin/env bash
echo "aabbccdd0000000000000000000000000000000000000000000000000000000000  $1"
SHAEOF
chmod +x "$STUB_DIR/sha256sum"

# systemctl stub (Linux prerequisite check)
cat > "$STUB_DIR/systemctl" << 'SVCEOF'
#!/usr/bin/env bash
exit 0
SVCEOF
chmod +x "$STUB_DIR/systemctl"

# id stub — make the runner user appear to exist
cat > "$STUB_DIR/id" << 'IDEOF'
#!/usr/bin/env bash
# id <user> → exit 0 so ensure_user thinks the user exists
exit 0
IDEOF
chmod +x "$STUB_DIR/id"

BASE_DIR_B2="$TMPDIR_B2/runners"
mkdir -p "$BASE_DIR_B2"

# Run script in dry-run mode with --count 3; capture stdout+stderr
dry_run_output=$(PATH="$STUB_DIR:$PATH" GH_TOKEN=fake bash "$SCRIPT" \
    --repo testowner/testrepo \
    --count 3 \
    --base-dir "$BASE_DIR_B2" \
    --user github-runner \
    --dry-run 2>&1) || true

# Count lines that contain "[dry-run]" and "curl" (the run_cmd curl calls)
curl_call_count=$(echo "$dry_run_output" | grep -c '\[dry-run\].*curl' || true)

if [[ "$curl_call_count" -eq 1 ]]; then
    ok "Bug2: curl called exactly once (tarball cached) — bug is fixed"
else
    fail "Bug2: expected curl called 1 time, got $curl_call_count — tarball is downloaded once per runner (not cached)"
fi

# ---------------------------------------------------------------------------
# Bug 3 — chmod missing sudo_cmd (line ~470)
#
# After downloading the tarball as RUNNER_USER, the script called plain
# `chmod a+r` without `sudo_cmd`.  The fix removes the per-runner tarball
# download entirely (Fix 2) and, in the new cache download function, uses
# `sudo_cmd chmod a+r` to make the cached tarball readable.
#
# Test strategy: source-level grep.
#   - Assert bare `chmod a+r` (without sudo_cmd) does NOT exist in the script.
#   - Assert `sudo_cmd chmod a+r` is present in the cache download function.
# ---------------------------------------------------------------------------
echo "--- Bug 3: chmod missing sudo_cmd ---"

# Assert no bare chmod a+r remains
bare_chmod_line=$(grep -n "chmod a+r" "$SCRIPT" | grep -v "sudo_cmd" | head -1)

if [[ -z "$bare_chmod_line" ]]; then
    ok "Bug3: no bare 'chmod a+r' without sudo_cmd found in script"
else
    fail "Bug3: bare 'chmod a+r' still exists without sudo_cmd: $bare_chmod_line"
fi

# Assert sudo_cmd chmod a+r is present (in the cache download function)
if grep -q "sudo_cmd chmod a+r" "$SCRIPT"; then
    ok "Bug3: 'sudo_cmd chmod a+r' found in script (cache download function)"
else
    fail "Bug3: 'sudo_cmd chmod a+r' not found in script"
fi

# ---------------------------------------------------------------------------
# Feature: stale tarball pruning in download_runner_tarball()
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Stale tarball test 1 — dry-run prints removal intent for stale tarballs
#
# When --dry-run is used and a stale tarball (wrong version) exists in the
# cache dir, the script should print a [dry-run] rm line without deleting it.
# ---------------------------------------------------------------------------
echo "--- Stale tarball 1: dry-run prints rm for stale tarball ---"

TMPDIR_ST1="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ST1"' EXIT

STUB_DIR_ST1="$TMPDIR_ST1/stubs"
mkdir -p "$STUB_DIR_ST1"

cat > "$STUB_DIR_ST1/gh" << 'GHEOF'
#!/usr/bin/env bash
exit 0
GHEOF
chmod +x "$STUB_DIR_ST1/gh"

cat > "$STUB_DIR_ST1/curl" << 'CURLEOF'
#!/usr/bin/env bash
exit 0
CURLEOF
chmod +x "$STUB_DIR_ST1/curl"

cat > "$STUB_DIR_ST1/tar" << 'TAREOF'
#!/usr/bin/env bash
exit 0
TAREOF
chmod +x "$STUB_DIR_ST1/tar"

cat > "$STUB_DIR_ST1/sha256sum" << 'SHAEOF'
#!/usr/bin/env bash
echo "aabbccdd0000000000000000000000000000000000000000000000000000000000  $1"
SHAEOF
chmod +x "$STUB_DIR_ST1/sha256sum"

cat > "$STUB_DIR_ST1/systemctl" << 'SVCEOF'
#!/usr/bin/env bash
exit 0
SVCEOF
chmod +x "$STUB_DIR_ST1/systemctl"

cat > "$STUB_DIR_ST1/id" << 'IDEOF'
#!/usr/bin/env bash
exit 0
IDEOF
chmod +x "$STUB_DIR_ST1/id"

BASE_DIR_ST1="$TMPDIR_ST1/runners"
mkdir -p "$BASE_DIR_ST1"

# Detect the OS/arch the script will use so we can plant a matching stale tarball
# Mirror the script's own mapping: Darwin->osx, Linux->linux; x86_64->x64
_raw_os="$(uname -s)"
case "$_raw_os" in
    Darwin) runner_os="osx" ;;
    *)      runner_os="$(echo "$_raw_os" | tr '[:upper:]' '[:lower:]')" ;;
esac
runner_arch="$(uname -m)"
case "$runner_arch" in
    x86_64)  runner_arch="x64" ;;
    aarch64|arm64) runner_arch="arm64" ;;
esac

# Create the cache dir and plant a stale tarball (old version) — current is 2.321.0
cache_dir="$BASE_DIR_ST1/actions-runner-cache"
mkdir -p "$cache_dir"
touch "${cache_dir}/actions-runner-${runner_os}-${runner_arch}-2.300.0.tar.gz"

dry_run_output_st1=$(PATH="$STUB_DIR_ST1:$PATH" GH_TOKEN=fake bash "$SCRIPT" \
    --repo testowner/testrepo \
    --count 1 \
    --base-dir "$BASE_DIR_ST1" \
    --user github-runner \
    --dry-run 2>&1) || true

stale_rm_count=$(echo "$dry_run_output_st1" | grep -c '\[dry-run\].*rm.*2\.300\.0' || true)

if [[ "$stale_rm_count" -ge 1 ]]; then
    ok "Stale1: dry-run printed rm intent for stale tarball (2.300.0)"
else
    fail "Stale1: expected [dry-run] rm line for stale tarball, got none"
fi

# ---------------------------------------------------------------------------
# Stale tarball test 2 — stale rm calls use run_cmd / sudo_cmd (not bare rm)
#
# The stale removal loop must route through run_cmd or sudo_cmd so that
# dry-run mode is respected and Linux hosts use sudo.  No bare `rm -f` should
# appear in the stale removal block.
# ---------------------------------------------------------------------------
echo "--- Stale tarball 2: stale rm uses run_cmd/sudo_cmd (no bare rm) ---"

# Extract the stale removal loop from the script source and check each rm -f
# line is preceded by run_cmd or sudo_cmd on the same line.
stale_loop_body=$(awk '/# Remove stale tarballs/,/# If cache file already exists/' "$SCRIPT")

bare_rm=$(echo "$stale_loop_body" | grep "rm -f" | grep -v "run_cmd\|sudo_cmd" || true)

if [[ -z "$bare_rm" ]]; then
    ok "Stale2: all 'rm -f' calls in stale removal block go through run_cmd or sudo_cmd"
else
    fail "Stale2: bare 'rm -f' found in stale removal block (not via run_cmd/sudo_cmd): $bare_rm"
fi

# ---------------------------------------------------------------------------
# Stale tarball test 3 — stale removal loop guards against current-version tarball
#
# The loop must skip $RUNNER_TARBALL_CACHE so the current version is never
# deleted.  Assert the guard comparing $stale to $RUNNER_TARBALL_CACHE exists.
# ---------------------------------------------------------------------------
echo "--- Stale tarball 3: stale removal loop skips current-version tarball ---"

if grep -q 'RUNNER_TARBALL_CACHE' "$SCRIPT" && \
   awk '/for stale in.*actions-runner.*tar\.gz/,/done/' "$SCRIPT" | grep -q 'RUNNER_TARBALL_CACHE'; then
    ok "Stale3: stale removal loop contains a guard comparing to RUNNER_TARBALL_CACHE"
else
    fail "Stale3: stale removal loop does not guard against RUNNER_TARBALL_CACHE"
fi

# ---------------------------------------------------------------------------
# Stale tarball test 4 — dry-run does NOT remove the current-version tarball
#
# When the cache already holds the current-version tarball (2.321.0), a
# dry-run invocation must not emit any rm line targeting that file.
# ---------------------------------------------------------------------------
echo "--- Stale tarball 4: dry-run does not rm the current-version tarball ---"

TMPDIR_ST4="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ST4"' EXIT

STUB_DIR_ST4="$TMPDIR_ST4/stubs"
mkdir -p "$STUB_DIR_ST4"

cat > "$STUB_DIR_ST4/gh" << 'GHEOF'
#!/usr/bin/env bash
exit 0
GHEOF
chmod +x "$STUB_DIR_ST4/gh"

cat > "$STUB_DIR_ST4/curl" << 'CURLEOF'
#!/usr/bin/env bash
exit 0
CURLEOF
chmod +x "$STUB_DIR_ST4/curl"

cat > "$STUB_DIR_ST4/tar" << 'TAREOF'
#!/usr/bin/env bash
exit 0
TAREOF
chmod +x "$STUB_DIR_ST4/tar"

cat > "$STUB_DIR_ST4/sha256sum" << 'SHAEOF'
#!/usr/bin/env bash
echo "aabbccdd0000000000000000000000000000000000000000000000000000000000  $1"
SHAEOF
chmod +x "$STUB_DIR_ST4/sha256sum"

cat > "$STUB_DIR_ST4/systemctl" << 'SVCEOF'
#!/usr/bin/env bash
exit 0
SVCEOF
chmod +x "$STUB_DIR_ST4/systemctl"

cat > "$STUB_DIR_ST4/id" << 'IDEOF'
#!/usr/bin/env bash
exit 0
IDEOF
chmod +x "$STUB_DIR_ST4/id"

BASE_DIR_ST4="$TMPDIR_ST4/runners"
mkdir -p "$BASE_DIR_ST4"

# Plant the current-version tarball (the dry-run placeholder is 2.321.0)
cache_dir_st4="$BASE_DIR_ST4/actions-runner-cache"
mkdir -p "$cache_dir_st4"
current_tarball="actions-runner-${runner_os}-${runner_arch}-2.321.0.tar.gz"
touch "${cache_dir_st4}/${current_tarball}"

dry_run_output_st4=$(PATH="$STUB_DIR_ST4:$PATH" GH_TOKEN=fake bash "$SCRIPT" \
    --repo testowner/testrepo \
    --count 1 \
    --base-dir "$BASE_DIR_ST4" \
    --user github-runner \
    --dry-run 2>&1) || true

current_rm_count=$(echo "$dry_run_output_st4" | grep -c '\[dry-run\].*rm -f.*2\.321\.0' || true)

if [[ "$current_rm_count" -eq 0 ]]; then
    ok "Stale4: dry-run did not emit rm for the current-version tarball (2.321.0)"
else
    fail "Stale4: dry-run emitted $current_rm_count rm line(s) targeting the current-version tarball"
fi


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
exit 0
