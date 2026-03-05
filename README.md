# Claude Cadence

An issue-driven, multi-agent development workflow plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Claude Cadence provides a structured development workflow with git worktrees, phased implementation, specialist agent delegation, and GitHub issue tracking — all stack-agnostic and customizable per project.

## Installation

```bash
# Add the marketplace (once)
/plugin marketplace add dokipen/claude-cadence

# Install the plugin
/plugin install claude-cadence
```

## Updating

Run `/update-cadence` to pull the latest version. Restart Claude Code to apply changes.

## What You Get

### Skills (slash commands)

| Command | Purpose |
|---------|---------|
| `/new-work 42-feature-name` | Create a git worktree for isolated development |
| `/lead` | Coordinate implementation through 7 structured phases |
| `/create-pr` | Create a PR with pre-flight verification |
| `/refine` or `/refine 123` | Refine issues to quality standards |
| `/create-skill` | Bootstrap new Claude Code skills |
| `/update-cadence` | Update plugin to latest version |

### Agents (specialist delegation)

| Agent | Role |
|-------|------|
| `code-reviewer` | PR reviews, code quality, best practices |
| `tester` | Test execution, bug reproduction, coverage |
| `security-engineer` | Security audits, dependency checks |
| `performance-engineer` | Performance profiling, optimization |
| `claude-specialist` | Claude Code configuration, agent/skill design |
| `ticket-refiner` | Issue quality assurance |

### Scripts (shell utilities)

| Script | Purpose |
|--------|---------|
| `create-worktree.sh` | Create worktrees with validation |
| `cleanup-worktree.sh` | Remove worktrees after merge |
| `check-orphaned-worktrees.sh` | Pre-flight orphan detection |
| `pr-preflight.sh` | Run verification before PR creation |
| `list-agents.sh` | List all available agents with metadata |
| `update-blocked-labels.sh` | Sync `blocked` labels from issue dependencies |

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

The `/lead` skill orchestrates 7 phases:

1. **Phase 0**: Worktree setup (isolated branch)
2. **Phase 0.5**: Estimation (story points)
3. **Phase 1**: Planning (research, task breakdown, design review)
4. **Phase 2**: Implementation (specialist delegation)
5. **Phase 3**: Pre-PR verification (tests, lint)
6. **Phase 4-5**: PR creation and code review gate
7. **Phase 6-7**: Manual QA, merge, and cleanup

## Conventions

- **Git**: All work in worktrees, never on default branch
- **Branches**: `<issue-number>-<description>` (e.g., `42-add-auth`)
- **Issues**: Descriptive titles, categorized via labels
- **Estimation**: Fibonacci scale (1, 2, 3, 5, 8, 13)
- **Communication**: Issue comments pre-PR, PR comments post-PR
- **GitHub**: Always use `gh` CLI

## License

MIT
