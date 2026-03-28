# issues-mcp

An MCP (Model Context Protocol) server that exposes the issues microservice API as tools for Claude Code and other MCP-compatible agents.

## Overview

`issues-mcp` lets agents interact with the issues tracker directly via MCP tools, without needing the `issues` CLI binary in PATH. This is especially useful in sandboxed or containerized environments where installing the CLI is inconvenient, or when you want agents to have structured, typed access to ticket operations.

The server communicates over stdio and is registered in `.mcp.json` so Claude Code loads it automatically.

## Prerequisites

- Node.js 20 or later
- npm

## Installation & Build

```bash
cd services/issues-mcp
npm install
npm run build
```

The compiled output lands in `dist/index.js`.

## Configuration

All configuration is via environment variables passed through `.mcp.json`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ISSUES_AUTH_TOKEN` | yes | — | Bearer token for authenticating with the issues API |
| `ISSUES_API_URL` | no | `http://localhost:4000/graphql` | GraphQL API endpoint |
| `ISSUES_PROJECT_ID` | no | — | Default project CUID; used when tools are called without an explicit `projectId` |
| `ISSUES_PROJECT_NAME` | no | — | Default project name; resolved to a CUID at startup (alternative to `ISSUES_PROJECT_ID`) |

If both `ISSUES_PROJECT_NAME` and `ISSUES_PROJECT_ID` are set, the ID takes precedence and the name is ignored.

## Claude Code Integration

Add the server to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "issues": {
      "command": "node",
      "args": ["/path/to/services/issues-mcp/dist/index.js"],
      "env": {
        "ISSUES_AUTH_TOKEN": "your-token",
        "ISSUES_API_URL": "https://your-api-url/graphql",
        "ISSUES_PROJECT_NAME": "your-project"
      }
    }
  }
}
```

Replace `/path/to/services/issues-mcp` with the absolute path on your machine.

## Available Tools

| Tool | Description |
|---|---|
| `ticket_create` | Create a new ticket (title required; optional description, acceptance criteria, labels, priority, story points, projectId) |
| `ticket_get` | Get a ticket by CUID or by ticket number (number lookup requires projectId) |
| `ticket_list` | List and filter tickets by state, label names, priority, blocked status, or projectId |
| `ticket_update` | Update ticket fields (title, description, acceptance criteria, priority, story points) |
| `ticket_transition` | Transition a ticket to a new state (`BACKLOG`, `REFINED`, `IN_PROGRESS`, `CLOSED`) |
| `label_list` | List all available labels |
| `label_add` | Add a label to a ticket by CUID |
| `label_remove` | Remove a label from a ticket by CUID |
| `comment_add` | Add a comment to a ticket |

## Getting a Token

**Production:** Use `issues-cli` (in `services/issues-cli`) to authenticate:

```bash
issues auth login --pat <your-personal-access-token>
```

The token is stored in `~/.issues-cli/auth.json`. Copy the `token` field value into `ISSUES_AUTH_TOKEN`.

**Development:** Set `AUTH_BYPASS=1` on the issues server to skip authentication entirely.
