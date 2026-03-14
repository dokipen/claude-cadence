# US-01: Session Lifecycle

## Summary

Users can create, list, inspect, and destroy agent sessions through the gRPC API. Each session launches an agent process in a dedicated tmux session.

## Stories

### Create Session
- As a user, I can create a session by specifying an agent profile name
- As a user, I can provide a human-readable session name that becomes the tmux session name
- As a user, if I don't provide a session name, one is auto-generated (`{profile}-{timestamp}`)
- As a user, I receive an error if the session name is already in use (ALREADY_EXISTS)
- As a user, I receive an error if the profile name doesn't exist in the config (NOT_FOUND)
- As a user, session names are validated for tmux-safe characters (`[a-zA-Z0-9_-]`, max 200 chars)
- As a user, I can pass optional environment variables to inject into the session
- As a user, I can pass optional extra arguments appended to the command template

### List Sessions
- As a user, I can list all active sessions
- As a user, I can filter sessions by agent profile name
- As a user, I can filter sessions by state (RUNNING, STOPPED, etc.)
- As a user, each session in the list includes its current state, profile, name, and timestamps

### Get Session
- As a user, I can get details about a specific session by its UUID
- As a user, the session state reflects reality (reconciled with tmux)
- As a user, if the agent process has exited, the state shows STOPPED
- As a user, I receive NOT_FOUND for unknown session IDs

### Destroy Session
- As a user, I can destroy a session, which kills the tmux session
- As a user, I can force-destroy a running session with `force=true`
- As a user, attempting to destroy a running session without `force=true` returns FAILED_PRECONDITION
- As a user, I receive NOT_FOUND for unknown session IDs
- As a user, the destroyed session is removed from tracking

### Configuration
- As a user, I can define agent profiles in a YAML configuration file
- As a user, each profile specifies a command template and a target repository
- As a user, the command template supports Go template variables (WorktreePath, ExtraArgs, etc.)
- As a user, profiles are generic -- they can launch any CLI agent (claude, gemini, custom tools)

## E2E Test Cases

| Test | Description |
|------|-------------|
| `TestCreateSession_Success` | Create session, verify tmux session exists |
| `TestCreateSession_DuplicateName` | Reject duplicate session name |
| `TestCreateSession_InvalidProfile` | Reject unknown profile name |
| `TestCreateSession_AutoName` | Empty name auto-generates |
| `TestGetSession_Running` | Verify RUNNING state for active process |
| `TestGetSession_Stopped` | Fast-exit process shows STOPPED |
| `TestGetSession_NotFound` | Unknown ID returns NOT_FOUND |
| `TestListSessions_Empty` | No sessions returns empty list |
| `TestListSessions_Multiple` | Multiple sessions appear in list |
| `TestListSessions_FilterByProfile` | Profile filter works |
| `TestDestroySession_Force` | force=true kills running session |
| `TestDestroySession_NotFound` | Unknown ID returns NOT_FOUND |

## Implementation Phase

**Phase 1** (Steel Thread) -- 5 story points
