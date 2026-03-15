#!/usr/bin/env bash
set -euo pipefail

# Sets up passwordless SSH from github-runner to doki_pen@localhost on Bootsy.
# This is required for the deploy-issues GitHub Actions workflow.
#
# Run this once on Bootsy as the github-runner user:
#   sudo -u github-runner bash infrastructure/setup-deploy-ssh.sh

DEPLOY_USER="doki_pen"
RUNNER_USER="github-runner"
RUNNER_HOME=$(eval echo "~${RUNNER_USER}")
KEY_FILE="${RUNNER_HOME}/.ssh/id_ed25519_deploy"

info() { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
err()  { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

if [ "$(whoami)" != "$RUNNER_USER" ]; then
  err "Must run as $RUNNER_USER (use: sudo -u $RUNNER_USER bash $0)"
fi

# Generate SSH key if it doesn't exist
if [ ! -f "$KEY_FILE" ]; then
  info "Generating SSH key at $KEY_FILE"
  mkdir -p "${RUNNER_HOME}/.ssh"
  chmod 700 "${RUNNER_HOME}/.ssh"
  ssh-keygen -t ed25519 -f "$KEY_FILE" -N "" -C "github-runner-deploy"
else
  info "SSH key already exists at $KEY_FILE"
fi

# Display public key for manual addition
info "Add this public key to ~${DEPLOY_USER}/.ssh/authorized_keys:"
echo ""
cat "${KEY_FILE}.pub"
echo ""
info "Run as ${DEPLOY_USER}:"
echo "  mkdir -p ~/.ssh && chmod 700 ~/.ssh"
echo "  echo '$(cat "${KEY_FILE}.pub")' >> ~/.ssh/authorized_keys"
echo "  chmod 600 ~/.ssh/authorized_keys"

# Configure SSH to use this key for localhost
SSH_CONFIG="${RUNNER_HOME}/.ssh/config"
if ! grep -q "Host localhost" "$SSH_CONFIG" 2>/dev/null; then
  info "Adding SSH config entry"
  cat >> "$SSH_CONFIG" <<EOF

Host localhost
  User ${DEPLOY_USER}
  IdentityFile ${KEY_FILE}
  StrictHostKeyChecking accept-new
EOF
  chmod 600 "$SSH_CONFIG"
else
  info "SSH config entry for localhost already exists"
fi

info "Test with: ssh ${DEPLOY_USER}@localhost whoami"
