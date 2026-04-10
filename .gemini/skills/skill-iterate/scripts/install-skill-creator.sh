#!/usr/bin/env bash
# Install Anthropic's skill-creator into the consuming project.
#
# Usage:
#   bash skills/skill-iterate/scripts/install-skill-creator.sh [DEST_DIR]
#
# DEST_DIR defaults to .claude/skills/skill-creator
# Pinned upstream ref: 12ab35c2eb5668c95810e6a6066f40f4218adc39
#
# The script is idempotent: if DEST_DIR already exists it prints a message
# and exits 0 without modifying anything.

set -euo pipefail

UPSTREAM_REPO="https://github.com/anthropics/skills.git"
PINNED_REF="12ab35c2eb5668c95810e6a6066f40f4218adc39"
SKILL_SUBPATH="skills/skill-creator"

DEST_DIR="${1:-.claude/skills/skill-creator}"

# Safety: reject path traversal
case "$DEST_DIR" in
  *..*)
    echo "ERROR: DEST_DIR must not contain path traversal (..): $DEST_DIR" >&2
    exit 1
    ;;
esac

if [ -d "$DEST_DIR" ]; then
  echo "skill-creator already installed at $DEST_DIR — skipping."
  exit 0
fi

echo "Installing skill-creator from anthropics/skills @ ${PINNED_REF} -> $DEST_DIR"

TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

# Sparse-checkout only the skill-creator subdirectory
git -C "$TMPDIR_WORK" init -q
git -C "$TMPDIR_WORK" remote add origin "$UPSTREAM_REPO"
git -C "$TMPDIR_WORK" config core.sparseCheckout true
printf '%s/\n' "$SKILL_SUBPATH" > "$TMPDIR_WORK/.git/info/sparse-checkout"
git -C "$TMPDIR_WORK" fetch --depth=1 origin "$PINNED_REF"
git -C "$TMPDIR_WORK" checkout FETCH_HEAD

mkdir -p "$(dirname "$DEST_DIR")"
cp -r "$TMPDIR_WORK/$SKILL_SUBPATH" "$DEST_DIR"

echo "Installed: $DEST_DIR"
echo "Pinned ref: $PINNED_REF"
echo ""
echo "To update in the future, re-run this script after bumping PINNED_REF to a new commit."
