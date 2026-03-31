# Claude Cadence

An issue-driven, multi-agent development workflow plugin for Claude Code.

## What This Plugin Provides

### Commands (user-invoked slash commands)
- `/lead N` — Coordinate implementation through structured phases with specialist agents
- `/refine N` — Refine GitHub issues to quality standards
- `/create-ticket` — Create a ticket in the project's issue tracker and stop (no implementation)

### Skills (model-invoked)
- `new-work` — Create git worktrees for isolated feature development
- `create-pr` — Create pull requests with pre-flight verification
- `create-skill` — Bootstrap new Claude Code skills
- `ticket-provider` — Ticket provider abstraction (dispatches to GitHub Issues or issues microservice)
- `issues-api` — CLI commands for the issues microservice backend
- `agent-service` — Interacting with the agentd service via agent-hub WebSocket API
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
- **Milestones**: Group related tickets with `milestone:[N]-[slug]` labels (e.g., `milestone:392-agentd-session-fixes`). `N` is the anchor ticket number; `slug` is a short lowercase-hyphenated descriptor. For plan-generated ticket trees, `/lead` applies these automatically in Phase 3a. For ad-hoc fix clusters (multiple tickets addressing the same underlying problem), create and apply the label manually as soon as the relationship is recognized — don't wait until after the sprint.
- **No PR without a ticket**: Every PR must link to an issue in the PR body. Use a closing keyword (`Closes #N`, `Fixes #N`, or `Resolves #N`) when the PR fully resolves the issue; use `Ref #N` for partial work or non-closing references. Lightweight issues are acceptable — a one-liner with a brief description or repro steps is enough. This ensures traceability and enables mid-sprint communication.

## Filesystem Scope

> **IMPORTANT:** Only access files within the project repository (the directory containing `CLAUDE.md`). This applies to all tools — `Read`, `Glob`, `Grep`, and `Bash` alike. Never run Bash commands (e.g., `find`, `cat`, `ls`) targeting paths outside the repository, and never use absolute paths to home directories or system paths. Do not use `$HOME`, `~`, or any environment variable that may expand to a path outside the project repository (e.g., `$XDG_CONFIG_HOME`, `$TMPDIR`, `$XDG_DATA_HOME`, `$XDG_RUNTIME_DIR`, `$XDG_CACHE_HOME`, `$PATH`, `$SHELL`, `$OLDPWD`), do not use path traversal (e.g., `../`) to navigate above the repo root, do not run `readlink` or `realpath` on paths that would resolve outside the project directory, do not follow symlinks that lead outside the project directory, do not use `printenv` or `env` to read environment variables as path components, do not use `which`, `command -v`, or `type` to locate system tools, and do not use command substitution with any of these commands to construct file paths (e.g., `$(which python3)`, `$(printenv GOPATH)/src`, `$(command -v git)`). Use relative paths and `Glob`/`Grep` within the project directory.

## Workflow Rules

These rules reduce ambiguity for contributors and agents working in this repo and in projects integrating Claude Cadence.

### Command Intent

Each command has a specific intent — do not conflate them:

- `/lead N` — **Implement** issue N end-to-end through all workflow phases
- `/refine N` — **Refine** issue N to quality standards; do not start implementation
- `/create-ticket` — **Create the ticket only**; do not start implementation unless explicitly asked

### Target Project Confirmation

When a prompt is ambiguous about which project to target (no `project_id` configured in `CLAUDE.md` and no project specified in the prompt), **ask the user which project to use** before creating tickets or starting work. The default project for this repo is `claude-cadence`. For `/create-ticket`, project collection happens in the information-gathering step (step 1) — once the project is known, no additional confirmation prompt is needed.

### Recommended Conventions for Consuming Projects

Projects integrating Claude Cadence can adopt similar rules in their own `CLAUDE.md` to reduce agent friction:
- Map command names to intent (implement vs. create-only vs. analyze)
- Specify the default ticket project so agents don't need to infer it

## Verification
shellcheck commands/**/*.sh skills/**/*.sh

## Ticket Provider
provider: issues-api
api_url: https://cadence.whatisbackdoor.com
project_id: claude-cadence
