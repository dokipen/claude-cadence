#!/usr/bin/env bash
# start-qa-env.sh — Start the Claude Cadence dev stack for manual QA.
#
# Finds free host ports dynamically so multiple QA stacks can run concurrently
# without conflicting with each other or with production services.
#
# Usage:
#   bash commands/lead/scripts/start-qa-env.sh [WORKTREE_DIR]
#
# WORKTREE_DIR defaults to the repo root (the directory containing
# docker-compose.dev.yml).  Pass the worktree path when running QA for a
# branch that hasn't been merged yet so the stack is built from that code.
#
# Output:
#   QA environment ready: http://HOST_IP:PORT/
#   Restart agentd: docker compose -p cadence-qa-PORT restart agentd
#   Stop:           docker compose -p cadence-qa-PORT down
set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"

# ---- Port discovery ---------------------------------------------------------

is_port_free() {
    if command -v ss > /dev/null 2>&1; then
        if ss -tln 2>/dev/null | grep -q ":${1}[^0-9]"; then return 1; fi
    elif nc -z 127.0.0.1 "$1" 2>/dev/null; then
        return 1
    fi
    return 0
}

find_free_port() {
    local port=$1
    while ! is_port_free "$port"; do
        port=$((port + 1))
    done
    echo "$port"
}

QA_PORT=$(find_free_port 5173)
ISSUES_HOST_PORT=$(find_free_port $((QA_PORT + 1)))
ISSUES_UI_HOST_PORT=$(find_free_port $((ISSUES_HOST_PORT + 1)))

# ---- .env.dev setup ---------------------------------------------------------

ENV_FILE="$REPO_ROOT/.env.dev"
if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$REPO_ROOT/.env.dev.example" ]; then
        cp "$REPO_ROOT/.env.dev.example" "$ENV_FILE"
        echo "Created .env.dev from .env.dev.example — default values are sufficient for UI-only QA." >&2
    else
        echo "Error: .env.dev not found and no .env.dev.example to copy from." >&2
        exit 1
    fi
fi

# ---- Start stack ------------------------------------------------------------

PROJECT_NAME="cadence-qa-${QA_PORT}"

echo "Starting QA stack (project: ${PROJECT_NAME}, port: ${QA_PORT})..."

QA_HOST=0.0.0.0 \
QA_PORT="$QA_PORT" \
ISSUES_HOST_PORT="127.0.0.1:${ISSUES_HOST_PORT}" \
ISSUES_UI_HOST_PORT="127.0.0.1:${ISSUES_UI_HOST_PORT}" \
docker compose \
    -f "$REPO_ROOT/docker-compose.dev.yml" \
    --project-name "$PROJECT_NAME" \
    up --build -d

# ---- Surface URL ------------------------------------------------------------

HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
QA_URL="http://${HOST_IP}:${QA_PORT}/"

echo ""
echo "QA environment ready: ${QA_URL}"
echo ""
echo "Test restart: docker compose -p ${PROJECT_NAME} restart agentd"
echo "Stop:         docker compose -p ${PROJECT_NAME} down"

# Attempt to open in browser (best-effort)
if command -v xdg-open > /dev/null 2>&1; then
    xdg-open "$QA_URL" > /dev/null 2>&1 &
elif command -v open > /dev/null 2>&1; then
    open "$QA_URL" &
fi
