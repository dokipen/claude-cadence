# Claude Cadence

An issue-driven, multi-agent development workflow plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Claude Cadence provides a structured development workflow with git worktrees, phased implementation, specialist agent delegation, and GitHub issue tracking — all stack-agnostic and customizable per project.

## Installation

### Git clone (simplest)

```bash
git clone https://github.com/dokipen/claude-cadence.git
claude --plugin-dir ./claude-cadence
```

To always load the plugin, add `--plugin-dir` to your shell alias or config:

```bash
alias claude='claude --plugin-dir /path/to/claude-cadence'
```

### Plugin marketplace

```bash
# Add the marketplace (once)
/plugin marketplace add dokipen/claude-cadence

# Install the plugin
/plugin install claude-cadence
```

## Updating

### Git clone

```bash
cd /path/to/claude-cadence && git pull
```

### Plugin marketplace

Run `claude plugin update cadence@claude-cadence` to update, then restart Claude Code.

## What You Get

### Commands (user-invoked)

| Command | Purpose |
|---------|---------|
| `/lead` | Coordinate implementation through 8 structured phases (0–7) |
| `/refine` or `/refine 123` | Refine issues to quality standards |

### Skills (model-invoked)

| Skill | Purpose |
|-------|---------|
| `new-work` | Create a git worktree for isolated development |
| `create-pr` | Create a PR with pre-flight verification |
| `create-skill` | Bootstrap new Claude Code skills |
| `github-issues` | GitHub issue management patterns |
| `project-ops` | Shared worktree management utilities |

### Agents (specialist delegation)

| Agent | Role |
|-------|------|
| `code-reviewer` | PR reviews, code quality, best practices |
| `tester` | Test execution, bug reproduction, coverage |
| `security-engineer` | Security audits, dependency checks |
| `performance-engineer` | Performance profiling, optimization |
| `claude-specialist` | Claude Code configuration, agent/skill design |
| `ticket-refiner` | Issue quality assurance |

## Project Integration

Claude Cadence agents read your project's `CLAUDE.md` to discover stack-specific commands. Add a `## Verification` section:

```markdown
## Verification
flutter analyze && flutter test
```

or:

```markdown
## Verification
go vet ./... && go test ./...
```

The agents and scripts will use this command automatically.

## Adding Project-Specific Agents

Add domain-specific agents to your project's `.claude/agents/` directory. They layer on top of the plugin's core agents:

```
your-project/.claude/
├── agents/
│   ├── designer.md              # Your custom agent
│   ├── game-mechanics-engineer.md  # Your custom agent
│   └── tester.md                # Overrides plugin's generic tester
```

Same-name agents in your project override the plugin version.

## Workflow Overview

The `/lead` command orchestrates structured phases:

1. **Phase 0**: Worktree setup (isolated branch)
2. **Phase 1**: Planning (research, task breakdown, design review)
3. **Phase 2**: Implementation (specialist delegation)
4. **Phase 3**: Pre-PR verification (tests, lint)
5. **Phase 4-5**: PR creation and code review gate
6. **Phase 6-7**: Manual QA, merge, and cleanup

Issues must be refined (`/refine`) before implementation — this covers estimation, acceptance criteria, and labeling.

## Conventions

- **Git**: All work in worktrees, never on default branch
- **Branches**: `<issue-number>-<description>` (e.g., `42-add-auth`)
- **Issues**: Descriptive titles, categorized via labels
- **Estimation**: Fibonacci scale (1, 2, 3, 5, 8, 13) — applied by `/refine`
- **Communication**: Issue comments pre-PR, PR comments post-PR
- **GitHub**: Always use `gh` CLI

## Services

### Issue Microservice

A GraphQL-based ticket tracking service with CLI client. See the [Issue Microservice Documentation](services/issues/docs/INDEX.md) for setup, deployment, and usage.

## License

MIT
