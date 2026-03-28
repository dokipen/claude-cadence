#!/usr/bin/env bash
# Tests for the awk state-machine in detect-provider.sh
# Run from any directory: bash skills/ticket-provider/scripts/tests/test-detect-provider.sh

set -uo pipefail

PASS=0
FAIL=0

ok()   { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$actual" = "$expected" ]]; then
        ok "$desc"
    else
        fail "$desc — expected '$expected', got '$actual'"
    fi
}

CLEANUP_DIRS=()
cleanup() { for d in "${CLEANUP_DIRS[@]+"${CLEANUP_DIRS[@]}"}"; do rm -rf "$d"; done; }
trap cleanup EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECT="$SCRIPT_DIR/../detect-provider.sh"

if [[ ! -f "$DETECT" ]]; then
    echo "ERROR: detect-provider.sh not found at $DETECT"
    exit 2
fi

# Run detect-provider.sh from the directory containing a CLAUDE.md file
run_script() {
    local claude_dir
    claude_dir="$(dirname "$1")"
    (cd "$claude_dir" && bash "$DETECT")
}

# ---------------------------------------------------------------------------
# Test 1 — Standard layout (control case): all fields present
# ---------------------------------------------------------------------------
echo "--- Test 1: Standard layout (control case) ---"

TMPDIR_T1="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T1")

cat > "$TMPDIR_T1/CLAUDE.md" << 'EOF'
# Project

## Ticket Provider
provider: issues-api
api_url: https://example.com
project_id: my-project
EOF

result="$(run_script "$TMPDIR_T1/CLAUDE.md")"
assert_eq "Test1: provider"  "issues-api"           "$(echo "$result" | jq -r '.provider')"
assert_eq "Test1: project"   "my-project"           "$(echo "$result" | jq -r '.project')"
assert_eq "Test1: api_url"   "https://example.com"  "$(echo "$result" | jq -r '.api_url')"

# ---------------------------------------------------------------------------
# Test 2 — Different field order: project_id before provider
# ---------------------------------------------------------------------------
echo "--- Test 2: Different field order ---"

TMPDIR_T2="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T2")

cat > "$TMPDIR_T2/CLAUDE.md" << 'EOF'
# Project

## Ticket Provider
project_id: other-project
api_url: https://other.example.com
provider: issues-api
EOF

result="$(run_script "$TMPDIR_T2/CLAUDE.md")"
assert_eq "Test2: provider"  "issues-api"     "$(echo "$result" | jq -r '.provider')"
assert_eq "Test2: project"   "other-project"  "$(echo "$result" | jq -r '.project')"

# ---------------------------------------------------------------------------
# Test 3 — Blank lines between fields
# ---------------------------------------------------------------------------
echo "--- Test 3: Blank lines between fields ---"

TMPDIR_T3="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T3")

cat > "$TMPDIR_T3/CLAUDE.md" << 'EOF'
# Project

## Ticket Provider

provider: github

project_id: spaced-project

EOF

result="$(run_script "$TMPDIR_T3/CLAUDE.md")"
assert_eq "Test3: provider"  "github"           "$(echo "$result" | jq -r '.provider')"
assert_eq "Test3: project"   "spaced-project"   "$(echo "$result" | jq -r '.project')"

# ---------------------------------------------------------------------------
# Test 4 — Extra fields in the section are ignored
# ---------------------------------------------------------------------------
echo "--- Test 4: Extra fields in the section are ignored ---"

TMPDIR_T4="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T4")

cat > "$TMPDIR_T4/CLAUDE.md" << 'EOF'
# Project

## Ticket Provider
provider: github
extra_field: should-be-ignored
project_id: real-project
another_extra: also-ignored
EOF

result="$(run_script "$TMPDIR_T4/CLAUDE.md")"
assert_eq "Test4: provider"  "github"        "$(echo "$result" | jq -r '.provider')"
assert_eq "Test4: project"   "real-project"  "$(echo "$result" | jq -r '.project')"

# ---------------------------------------------------------------------------
# Test 5 — Fields after the next ## heading are excluded
# ---------------------------------------------------------------------------
echo "--- Test 5: Fields after next ## heading are excluded ---"

TMPDIR_T5="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T5")

cat > "$TMPDIR_T5/CLAUDE.md" << 'EOF'
# Project

## Ticket Provider
provider: github
project_id: correct-project

## Verification
shellcheck scripts/**/*.sh

## Another Section
provider: issues-api
project_id: wrong-project
EOF

result="$(run_script "$TMPDIR_T5/CLAUDE.md")"
assert_eq "Test5: provider"  "github"            "$(echo "$result" | jq -r '.provider')"
assert_eq "Test5: project"   "correct-project"   "$(echo "$result" | jq -r '.project')"

# ---------------------------------------------------------------------------
# Test 6 — Code fence exclusion: template example block not matched
# ---------------------------------------------------------------------------
echo "--- Test 6: Code fence exclusion ---"

TMPDIR_T6="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T6")

cat > "$TMPDIR_T6/CLAUDE.md" << 'EOF'
# Project

Some instructions:

```markdown
## Ticket Provider
provider: issues-api
api_url: http://localhost:4000
project_id: fake-project
```

## Ticket Provider
provider: github
project_id: real-project
EOF

result="$(run_script "$TMPDIR_T6/CLAUDE.md")"
assert_eq "Test6: provider"  "github"        "$(echo "$result" | jq -r '.provider')"
assert_eq "Test6: project"   "real-project"  "$(echo "$result" | jq -r '.project')"

# ---------------------------------------------------------------------------
# Test 7 — CRLF line endings handled without error
# ---------------------------------------------------------------------------
echo "--- Test 7: CRLF line endings ---"

TMPDIR_T7="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T7")

printf '# Project\r\n\r\n## Ticket Provider\r\nprovider: issues-api\r\nproject_id: crlf-project\r\napi_url: https://crlf.example.com\r\n' \
    > "$TMPDIR_T7/CLAUDE.md"

result="$(run_script "$TMPDIR_T7/CLAUDE.md")"
assert_eq "Test7: provider"  "issues-api"                "$(echo "$result" | jq -r '.provider')"
assert_eq "Test7: project"   "crlf-project"              "$(echo "$result" | jq -r '.project')"
assert_eq "Test7: api_url"   "https://crlf.example.com"  "$(echo "$result" | jq -r '.api_url')"

# ---------------------------------------------------------------------------
# Test 8 — Missing section: defaults provider to "github"
# ---------------------------------------------------------------------------
echo "--- Test 8: Missing Ticket Provider section ---"

TMPDIR_T8="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T8")

cat > "$TMPDIR_T8/CLAUDE.md" << 'EOF'
# Project

## Verification
shellcheck scripts/**/*.sh
EOF

result="$(run_script "$TMPDIR_T8/CLAUDE.md")"
assert_eq "Test8: provider"  "github"  "$(echo "$result" | jq -r '.provider')"
assert_eq "Test8: project"   ""        "$(echo "$result" | jq -r '.project')"
assert_eq "Test8: api_url"   ""        "$(echo "$result" | jq -r '.api_url')"

# ---------------------------------------------------------------------------
# Test 9 — No CLAUDE.md: defaults provider to "github"
# ---------------------------------------------------------------------------
echo "--- Test 9: No CLAUDE.md present ---"

TMPDIR_T9="$(mktemp -d)"
CLEANUP_DIRS+=("$TMPDIR_T9")

result="$(cd "$TMPDIR_T9" && bash "$DETECT")"
assert_eq "Test9: provider"  "github"  "$(echo "$result" | jq -r '.provider')"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
