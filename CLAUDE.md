# Claude Cadence

An issue-driven, multi-agent development workflow plugin for Claude Code.

## What This Plugin Provides

### Commands (user-invoked slash commands)
- `/lead` — Coordinate implementation through structured phases with specialist agents
- `/refine` — Refine GitHub issues to quality standards

### Skills (model-invoked)
- `new-work` — Create git worktrees for isolated feature development
- `create-pr` — Create pull requests with pre-flight verification
- `create-skill` — Bootstrap new Claude Code skills
- `ticket-provider` — Ticket provider abstraction (dispatches to GitHub Issues or issues microservice)
- `github-issues` — Background knowledge for `gh` CLI patterns
- `issues-api` — CLI commands for the issues microservice backend
- `agent-service` — Interacting with the agentd gRPC API
- `project-ops` — Shared worktree management scripts

### Agents (6 core specialists)
- `code-reviewer` — PR reviews, code quality, best practices
- `tester` — Test execution, bug reproduction, coverage analysis
- `security-engineer` — Security audits, dependency checks, vulnerability assessment
- `performance-engineer` — Performance profiling, optimization recommendations
- `claude-specialist` — Claude Code configuration, agent/skill design
- `ticket-refiner` — Issue quality assurance, refinement

## Project Integration

Consuming projects provide their own `CLAUDE.md` with:

```markdown
## Verification
<your verify command here, e.g.: flutter analyze && flutter test>

## Build
<your build command here, if needed>

## Ticket Provider
provider: github          # or "issues-api"
api_url: http://localhost:4000  # required for issues-api
project_id: <project-name-or-id> # required for issues-api (accepts name or CUID)
```

The `Ticket Provider` section is optional. When omitted, the default provider is `github` (GitHub Issues via `gh` CLI), maintaining full backward compatibility.

Agents read the project's `CLAUDE.md` to discover stack-specific commands and the ticket provider.

## Plugin Structure

```
commands/           # User-invoked slash commands
  <name>/SKILL.md
  <name>/scripts/   # Command-specific scripts

skills/             # Model-invoked skills
  <name>/SKILL.md
  <name>/scripts/   # Skill-specific scripts

agents/             # Specialist agent definitions
  <name>.md
```

Scripts are co-located with the command or skill that owns them. Shared scripts live in `skills/project-ops/scripts/`.

## Versioning

Bump the `version` field in `.claude-plugin/plugin.json` only when preparing a release, not on every PR merge. Use semver: patch for fixes, minor for new features/scripts/agents, major for breaking changes.

## Conventions

- **Git workflow**: All work in worktrees, never on default branch
- **Branch naming**: `<issue-number>-<description>` (e.g., `42-add-sound-effects`)
- **Issue titles**: Descriptive titles, categorized via labels
- **Estimation**: Fibonacci scale (1, 2, 3, 5, 8, 13)
- **Communication**: Issue comments pre-PR, PR comments post-PR
- **GitHub access**: Always use `gh` CLI, never WebFetch for GitHub URLs
- **Shell syntax**: Always use `$()` for command substitution, never backticks — enforced by shellcheck (SC2006)

## Workflow Rules

These rules reduce ambiguity for contributors and agents working on this plugin.

### Command Intent

Each command has a specific intent — do not conflate them:

- `/lead N` — **Implement** issue N end-to-end through all workflow phases
- `/refine N` — **Refine** issue N to quality standards; do not start implementation
- Requests like "create a ticket for X" or "open an issue for X" — **create the ticket only**; do not start implementation unless explicitly asked

### Target Project Confirmation

When a prompt is ambiguous about which project to target (e.g., "create a ticket for X" without specifying where), **always confirm the target project** before creating tickets or starting work. The default project for this repo is `claude-cadence`. If context suggests a different consuming project, ask before acting.

### Recommended Conventions for Consuming Projects

Projects integrating Claude Cadence can adopt similar rules in their own `CLAUDE.md` to reduce agent friction:
- Map command names to intent (implement vs. create-only vs. analyze)
- Specify the default ticket project so agents don't need to infer it

## Verification
shellcheck commands/**/*.sh skills/**/*.sh

## Ticket Provider
provider: issues-api
api_url: https://cadence.bootsy.internal
project_id: claude-cadence
