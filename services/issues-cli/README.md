# issues-cli

Command-line client for the [issues microservice](../issues/docs/INSTALL.md). Communicates with the GraphQL API to manage tickets, labels, assignments, blockers, and comments.

## Installation

The recommended way to install is via the service installer, which builds and links the CLI automatically:

```bash
cd services/issues
./install.sh
```

To install the CLI standalone:

```bash
cd services/issues-cli
npm install
npm run build
npm link
```

This makes the `issues` command available globally. To uninstall:

```bash
npm unlink -g @claude-cadence/issues-cli
```

For development without building:

```bash
cd services/issues-cli
npm install
npx tsx src/index.ts --help
```

## Configuration

### API Endpoint

The CLI needs to know where the issues GraphQL API is running. The URL is resolved in this order:

1. **Environment variable** `ISSUES_API_URL`
2. **Config file** `~/.issues-cli/config.json` (property `apiUrl`)
3. **Default** `http://localhost:4000`

To point at a remote instance:

```bash
# Option 1: environment variable
export ISSUES_API_URL=https://issues.example.com

# Option 2: config file
mkdir -p ~/.issues-cli
echo '{"apiUrl": "https://issues.example.com"}' > ~/.issues-cli/config.json
```

### Project Integration

To use the issues service as a ticket provider in a Cadence project, add to that project's `CLAUDE.md`:

```markdown
## Ticket Provider
provider: issues-api
api_url: http://localhost:4000
```

## Authentication

All commands except `auth login` require authentication. The CLI uses a two-token system (access token + refresh token) stored in `~/.issues-cli/auth.json` with `0600` permissions.

### Login

```bash
# Pass a GitHub Personal Access Token directly
issues auth login --pat ghp_abc123

# Read PAT from stdin (useful for piping secrets)
echo "$GITHUB_PAT" | issues auth login --pat -

# Interactive prompt (TTY only, input is hidden)
issues auth login

# GitHub OAuth code exchange
issues auth login --code <oauth-code>
```

### Verify Identity

```bash
issues auth whoami
```

Prints your login, display name, GitHub ID, avatar URL, and member-since date.

### Logout

```bash
issues auth logout
```

Revokes the refresh token server-side, then deletes `~/.issues-cli/auth.json`.

### Token Refresh

Access tokens expire after 7 days. When the CLI receives an `UNAUTHENTICATED` error, it automatically uses the refresh token to obtain a new access token and retries the request. New tokens are persisted transparently.

### Environment Variable Overrides

For CI or scripting, you can bypass file-based auth entirely:

| Variable | Overrides |
|----------|-----------|
| `ISSUES_AUTH_TOKEN` | Access token from `auth.json` |
| `ISSUES_REFRESH_TOKEN` | Refresh token from `auth.json` |

```bash
export ISSUES_AUTH_TOKEN=eyJhbG...
issues ticket list
```

## Commands

### Tickets

```bash
# Create
issues ticket create --title "Fix login bug" \
  --description "Users cannot log in with SSO" \
  --acceptance-criteria "SSO login works" \
  --labels <labelId1>,<labelId2> \
  --assignee <userId> \
  --points 3 \
  --priority MEDIUM

# View
issues ticket view <id>

# List (with optional filters)
issues ticket list \
  --state BACKLOG|REFINED|IN_PROGRESS|CLOSED \
  --label <name> \
  --assignee <login> \
  --blocked \
  --priority HIGHEST|HIGH|MEDIUM|LOW|LOWEST \
  --first <n> \
  --after <cursor>

# Update
issues ticket update <id> \
  --title "New title" \
  --description "Updated desc" \
  --acceptance-criteria "New AC" \
  --points 5 \
  --priority HIGH

# Transition state
issues ticket transition <id> --to BACKLOG|REFINED|IN_PROGRESS|CLOSED
```

**Ticket states** follow a finite state machine:

```
BACKLOG → REFINED → IN_PROGRESS → CLOSED
                  ← (demote)    ← (demote)
CLOSED → BACKLOG (reopen)
```

A ticket cannot transition to `IN_PROGRESS` if it has unresolved blockers.

**Note:** `--labels` on `ticket create` takes comma-separated label **IDs**. The `--label` filter on `ticket list` takes a label **name**.

### Labels

```bash
issues label list
issues label create --name "urgent" --color "#ff0000"
issues label add <ticketId> --label <labelId>
issues label remove <ticketId> --label <labelId>
```

### Assignment

```bash
issues assign <ticketId> --user <userId>
issues unassign <ticketId>
```

### Blockers

```bash
issues block add --blocker <ticketId> --blocked <ticketId>
issues block remove --blocker <ticketId> --blocked <ticketId>
```

### Comments

```bash
issues comment add <ticketId> --body "Looking into this"
issues comment edit <commentId> --body "Updated comment"
issues comment delete <commentId>
```

## Environment Variables Summary

| Variable | Purpose | Default |
|----------|---------|---------|
| `ISSUES_API_URL` | GraphQL API endpoint | `http://localhost:4000` |
| `ISSUES_AUTH_TOKEN` | Access token override | _(from auth.json)_ |
| `ISSUES_REFRESH_TOKEN` | Refresh token override | _(from auth.json)_ |

## File Locations

| Path | Purpose |
|------|---------|
| `~/.issues-cli/config.json` | Persisted API URL (`{"apiUrl": "..."}`) |
| `~/.issues-cli/auth.json` | JWT access + refresh tokens (mode `0600`) |
