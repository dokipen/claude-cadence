#!/usr/bin/env bash
# Tests for the awk verification-command parser in pr-preflight.sh
# Run from any directory: bash skills/create-pr/scripts/tests/test-pr-preflight-parsing.sh

set -uo pipefail

PASS=0
FAIL=0

ok()   { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

CLEANUP_DIRS=()
cleanup() { for d in "${CLEANUP_DIRS[@]+"${CLEANUP_DIRS[@]}"}"; do rm -rf "$d"; done; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Extract the awk command from pr-preflight.sh
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT="$SCRIPT_DIR/../pr-preflight.sh"

if [[ ! -f "$PREFLIGHT" ]]; then
    echo "ERROR: pr-preflight.sh not found at $PREFLIGHT"
    exit 2
fi

# Helper: run the live VERIFY_CMD extraction from pr-preflight.sh against a
# given CLAUDE.md directory.  Grep-extracts the actual VERIFY_CMD=... line
# from the script so that any future changes to the awk command are picked up
# automatically by these tests.
run_awk() {
    local claude_dir
    claude_dir="$(dirname "$1")"
    (
        cd "$claude_dir" || exit 1
        VERIFY_CMD=""
        # shellcheck disable=SC2094,SC2016
        eval "$(grep 'VERIFY_CMD=\$(awk' "$PREFLIGHT")"
        echo "$VERIFY_CMD"
    )
}

# ---------------------------------------------------------------------------
# Test 1 — Embedded code block: skips ## Verification inside fence
# ---------------------------------------------------------------------------
echo "--- Test 1: Embedded code block: skips ## Verification inside fence ---"

TMPDIR_T1="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T1")
CLAUDE_T1="$TMPDIR_T1/CLAUDE.md"

cat > "$CLAUDE_T1" << 'EOF'
# Project

```markdown
## Verification
<your verify command here>
```

## Verification
flutter analyze && flutter test
EOF

result_t1="$(run_awk "$CLAUDE_T1")"
if [[ "$result_t1" = "flutter analyze && flutter test" ]]; then
    ok "Test1: correctly skips fenced ## Verification and extracts real command"
else
    fail "Test1: expected 'flutter analyze && flutter test', got '$result_t1'"
fi

# ---------------------------------------------------------------------------
# Test 2 — Prefix match: does not match ## Verification in examples
# ---------------------------------------------------------------------------
echo "--- Test 2: Prefix match: does not match ## Verification in examples ---"

TMPDIR_T2="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T2")
CLAUDE_T2="$TMPDIR_T2/CLAUDE.md"

cat > "$CLAUDE_T2" << 'EOF'
# Project

## Verification in examples

This section shows verification examples.

## Verification
real-command
EOF

result_t2="$(run_awk "$CLAUDE_T2")"
if [[ "$result_t2" = "real-command" ]]; then
    ok "Test2: correctly skips '## Verification in examples' and matches exact heading"
else
    fail "Test2: expected 'real-command', got '$result_t2'"
fi

# ---------------------------------------------------------------------------
# Test 3 — Normal CLAUDE.md: extracts verification command
# ---------------------------------------------------------------------------
echo "--- Test 3: Normal CLAUDE.md: extracts verification command ---"

TMPDIR_T3="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T3")
CLAUDE_T3="$TMPDIR_T3/CLAUDE.md"

cat > "$CLAUDE_T3" << 'EOF'
# Project

## Verification
shellcheck scripts/**/*.sh
EOF

result_t3="$(run_awk "$CLAUDE_T3")"
if [[ "$result_t3" = "shellcheck scripts/**/*.sh" ]]; then
    ok "Test3: correctly extracts verification command from normal CLAUDE.md"
else
    fail "Test3: expected 'shellcheck scripts/**/*.sh', got '$result_t3'"
fi

# ---------------------------------------------------------------------------
# Test 4 — Blank line after heading: still extracts command
# ---------------------------------------------------------------------------
echo "--- Test 4: Blank line after heading: still extracts command ---"

TMPDIR_T4="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T4")
CLAUDE_T4="$TMPDIR_T4/CLAUDE.md"

cat > "$CLAUDE_T4" << 'EOF'
# Project

## Verification

shellcheck scripts/**/*.sh
EOF

result_t4="$(run_awk "$CLAUDE_T4")"
if [[ "$result_t4" = "shellcheck scripts/**/*.sh" ]]; then
    ok "Test4: correctly skips blank line after heading and extracts command"
else
    fail "Test4: expected 'shellcheck scripts/**/*.sh', got '$result_t4'"
fi

# ---------------------------------------------------------------------------
# Test 5 — Command inside fenced code block: extracts command not fence marker
# ---------------------------------------------------------------------------
echo "--- Test 5: Command inside fenced code block: extracts command not fence marker ---"

TMPDIR_T5="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T5")
CLAUDE_T5="$TMPDIR_T5/CLAUDE.md"

cat > "$CLAUDE_T5" << 'EOF'
# Project

## Verification
```bash
(cd subdir && make test)
```
EOF

result_t5="$(run_awk "$CLAUDE_T5")"
if [[ "$result_t5" = "(cd subdir && make test)" ]]; then
    ok "Test5: correctly extracts command from fenced code block under ## Verification"
else
    fail "Test5: expected '(cd subdir && make test)', got '$result_t5'"
fi

# ---------------------------------------------------------------------------
# Test 6 — Subshell command without fence: extracts subshell command directly
# ---------------------------------------------------------------------------
echo "--- Test 6: Subshell command without fence: extracts subshell command directly ---"

TMPDIR_T6="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T6")
CLAUDE_T6="$TMPDIR_T6/CLAUDE.md"

cat > "$CLAUDE_T6" << 'EOF'
# Project

## Verification
(cd subdir && make test)
EOF

result_t6="$(run_awk "$CLAUDE_T6")"
if [[ "$result_t6" = "(cd subdir && make test)" ]]; then
    ok "Test6: correctly extracts subshell command without fence"
else
    fail "Test6: expected '(cd subdir && make test)', got '$result_t6'"
fi

# ---------------------------------------------------------------------------
# Test 7 — Empty fenced block: returns empty VERIFY_CMD (not closing fence)
# ---------------------------------------------------------------------------
echo "--- Test 7: Empty fenced block: returns empty VERIFY_CMD ---"

TMPDIR_T7="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T7")
CLAUDE_T7="$TMPDIR_T7/CLAUDE.md"

cat > "$CLAUDE_T7" << 'EOF'
# Project

## Verification
```bash
```
EOF

result_t7="$(run_awk "$CLAUDE_T7")"
if [[ -z "$result_t7" ]]; then
    ok "Test7: empty fenced block returns empty VERIFY_CMD (not closing fence marker)"
else
    fail "Test7: expected empty string, got '$result_t7'"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
