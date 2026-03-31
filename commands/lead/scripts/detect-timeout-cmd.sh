#!/usr/bin/env bash
# detect-timeout-cmd.sh — detect cross-platform timeout command
#
# Usage (execute): TIMEOUT_CMD=$(bash "$CADENCE_ROOT/commands/lead/scripts/detect-timeout-cmd.sh")
#
# Outputs the full path to `gtimeout` if available (macOS with GNU coreutils),
# otherwise falls back to `timeout` (standard on Linux).
#
# On macOS without GNU coreutils, `timeout` is not available; install via:
#   brew install coreutils

set -euo pipefail

TIMEOUT_CMD=$(command -v gtimeout || command -v timeout)
echo "$TIMEOUT_CMD"
