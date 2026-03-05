# Claude Cadence

An issue-driven, multi-agent development workflow plugin for Claude Code.

## What This Plugin Provides

### Skills (6 workflow automations)
- `/new-work` — Create git worktrees for isolated feature development
- `/lead` — Coordinate implementation through structured phases with specialist agents
- `/create-pr` — Create pull requests with pre-flight verification
- `/refine` — Refine GitHub issues to quality standards
- `/create-skill` — Bootstrap new Claude Code skills
- `github-issues` — Background knowledge for `gh` CLI patterns

### Agents (6 core specialists)
- `code-reviewer` — PR reviews, code quality, best practices
- `tester` — Test execution, bug reproduction, coverage analysis
- `security-engineer` — Security audits, dependency checks, vulnerability assessment
- `performance-engineer` — Performance profiling, optimization recommendations
- `claude-specialist` — Claude Code configuration, agent/skill design
- `ticket-refiner` — Issue quality assurance, refinement

### Scripts (shared utilities)
- `create-worktree.sh` — Create worktrees with issue-number validation
- `cleanup-worktree.sh` — Remove worktrees and branches after merge
- `check-orphaned-worktrees.sh` — Pre-flight orphan detection
- `pr-preflight.sh` — Run verification before PR creation
- `list-agents.sh` — List all available agents with frontmatter metadata
- `update-blocked-labels.sh` — Sync `blocked` labels based on issue dependencies

## Project Integration

Consuming projects provide their own `CLAUDE.md` with:

```markdown
## Verification
<your verify command here, e.g.: flutter analyze && flutter test>

## Build
<your build command here, if needed>
```

Agents read the project's `CLAUDE.md` to discover stack-specific commands.

## Script Resolution

Scripts are referenced as `cadence <script-name>` in skills. To resolve a script, check these locations in order and use the first match:

1. `./scripts/<script-name>` (project-local override)
2. `~/.claude/plugins/marketplaces/claude-cadence/scripts/<script-name>` (plugin default)

## Conventions

- **Git workflow**: All work in worktrees, never on default branch
- **Branch naming**: `<issue-number>-<description>` (e.g., `42-add-sound-effects`)
- **Issue titles**: No type prefixes — use labels for categorization
- **Estimation**: Fibonacci scale (1, 2, 3, 5, 8, 13)
- **Communication**: Issue comments pre-PR, PR comments post-PR
- **GitHub access**: Always use `gh` CLI, never WebFetch for GitHub URLs
