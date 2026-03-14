# US-03: Vault Secrets

## Summary

The service integrates with HashiCorp Vault to retrieve credentials for private repository access and to inject secrets as environment variables into agent sessions.

## Stories

### Vault Authentication
- As a user, I can configure Vault connection details in the service config (address, auth method)
- As a user, the service supports token-based Vault authentication
- As a user, the service supports AppRole-based Vault authentication
- As a user, the Vault token can be provided via `VAULT_TOKEN` environment variable

### Credential Retrieval
- As a user, profiles with `vault_secret` configured automatically get credentials fetched from Vault
- As a user, Vault credentials are used for git clone/fetch operations on private repos
- As a user, HTTPS repos use the token as a git credential helper
- As a user, SSH repos use the key via `GIT_SSH_COMMAND`

### Environment Variable Injection
- As a user, Vault secrets can be injected as environment variables into tmux sessions
- As a user, injected secrets are available to the agent process running in the session
- As a user, profiles without `vault_secret` work without any Vault configuration (public repos)

## E2E Test Cases

| Test | Description |
|------|-------------|
| `TestVault_TokenAuth` | Connect to Vault dev server with token auth |
| `TestVault_SecretRetrieval` | Fetch and use secrets for git operations |
| `TestVault_EnvInjection` | Secrets appear as env vars in tmux session |
| `TestVault_NoSecret_PublicRepo` | Profiles without vault_secret work fine |

## Implementation Phase

**Phase 3** (Vault Integration) -- 3 story points

Blocked by: Phase 2
