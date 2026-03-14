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
- `github-issues` — Background knowledge for `gh` CLI patterns
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
```

Agents read the project's `CLAUDE.md` to discover stack-specific commands.

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
