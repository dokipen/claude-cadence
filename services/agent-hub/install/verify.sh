#!/usr/bin/env bash
set -euo pipefail

# Verify agent-hub deployment by checking all agents are online and
# optionally running a smoke test session.
#
# Usage: bash install/verify.sh [--host <hostname>] [--smoke-test]
#   --host        SSH hostname (default: bootsy)
#   --smoke-test  Launch a test session to verify end-to-end

HOST="bootsy"
HUB_URL="https://cadence.whatisbackdoor.com"
SMOKE_TEST=false

# --- Helpers ---

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33mWarning:\033[0m %s\n" "$1"; }
error() { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

# --- Argument parsing ---

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host) HOST="$2"; shift 2 ;;
        --smoke-test) SMOKE_TEST=true; shift ;;
        -h|--help)
            echo "Usage: $(basename "$0") [--host <hostname>] [--smoke-test]"
            echo "  --host        SSH hostname (default: bootsy)"
            echo "  --smoke-test  Launch a test session to verify end-to-end"
            exit 0
            ;;
        *) error "Unknown argument: $1" ;;
    esac
done

# --- Read API token from remote env file ---

info "Reading API token from $HOST..."
HUB_API_TOKEN="$(ssh "$HOST" "set -o pipefail; grep '^HUB_API_TOKEN=' /etc/agent-hub/env | cut -d= -f2-")" || \
    error "SSH to $HOST failed or env file not found"
if [[ -z "$HUB_API_TOKEN" ]]; then
    error "Could not read HUB_API_TOKEN from $HOST:/etc/agent-hub/env"
fi

# --- Check service status ---

info "Checking agent-hub service status on $HOST..."
if ssh "$HOST" "systemctl is-active agent-hub >/dev/null 2>&1"; then
    info "agent-hub service is active."
else
    error "agent-hub service is not running on $HOST."
fi

# --- List agents ---

info "Listing registered agents..."
AGENTS_JSON="$(ssh "$HOST" "curl -sf -H 'Authorization: Bearer $HUB_API_TOKEN' http://127.0.0.1:4200/api/v1/agents" 2>&1)" || {
    error "Failed to reach agent-hub API at $HUB_URL/api/v1/agents"
}

AGENT_COUNT="$(echo "$AGENTS_JSON" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data.get('agents', data) if isinstance(data, dict) else data))" 2>/dev/null || echo "0")"
info "Found $AGENT_COUNT registered agent(s)."

if [[ "$AGENT_COUNT" -eq 0 ]]; then
    warn "No agents registered. Are agentd instances running and configured with the correct HUB_AGENT_TOKEN?"
else
    echo "$AGENTS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
agents = data.get('agents', data) if isinstance(data, dict) else data
for a in agents:
    status = a.get('status', 'unknown')
    name = a.get('name', 'unnamed')
    profiles = a.get('profiles', {})
    for pname, pinfo in profiles.items():
        repo = pinfo.get('repo', '')
        repo_str = f' repo={repo}' if repo else ' repo=MISSING'
        print(f'  {name}: {status} (profile: {pname}{repo_str})')
" 2>/dev/null || echo "$AGENTS_JSON"
fi

# --- Smoke test (optional) ---

if [[ "$SMOKE_TEST" == "true" ]]; then
    info "Running smoke test — launching a test session..."

    # Pick the first online agent
    AGENT_NAME="$(echo "$AGENTS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
agents = data.get('agents', data) if isinstance(data, dict) else data
online = [a for a in agents if a.get('status') == 'online']
if online:
    print(online[0]['name'])
" 2>/dev/null)"

    if [[ -z "$AGENT_NAME" ]]; then
        warn "No online agents available for smoke test."
    else
        info "Creating test session on agent '$AGENT_NAME'..."
        RESPONSE="$(ssh "$HOST" "curl -sf -X POST \
            -H 'Authorization: Bearer $HUB_API_TOKEN' \
            -H 'Content-Type: application/json' \
            -d '{\"agent_profile\":\"claude-cadence\",\"session_name\":\"deploy-verify-test\",\"extra_args\":[\"-p\",\"Say \\\"deployment verification successful\\\" and exit.\"]}' \
            http://127.0.0.1:4200/api/v1/agents/$AGENT_NAME/sessions" 2>&1)" || {
            warn "Failed to create test session. Response: $RESPONSE"
        }

        if [[ -n "$RESPONSE" ]]; then
            info "Smoke test session created successfully."
            echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
        fi
    fi
fi

info "Verification complete."
