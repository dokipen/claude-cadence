---
name: create-skill
description: Create a new Claude Code skill or command for the project. Use when bootstrapping new skills, commands, or plugin components.
user-invokable: false
---

# Create a Skill

Skills live in `skills/<name>/SKILL.md` (model-invoked) or `commands/<name>/SKILL.md` (user-invoked).

## Filesystem Scope

> **IMPORTANT:** Only access files within the project repository (the directory containing `CLAUDE.md`). This applies to all tools — `Read`, `Glob`, `Grep`, and `Bash` alike. Never run Bash commands (e.g., `find`, `cat`, `ls`) targeting paths outside the repository, and never use absolute paths to home directories or system paths. Do not use `$HOME`, `~`, or any environment variable that may expand to a path outside the project repository (e.g., `$XDG_CONFIG_HOME`, `$TMPDIR`, `$XDG_DATA_HOME`, `$XDG_RUNTIME_DIR`, `$XDG_CACHE_HOME`, `$PATH`, `$SHELL`, `$OLDPWD`), do not use path traversal (e.g., `../`) to navigate above the repo root, do not run `readlink` or `realpath` on paths that would resolve outside the project directory, do not follow symlinks that lead outside the project directory, do not use `printenv` or `env` to read environment variables as path components, do not use `which`, `command -v`, or `type` to locate system tools, and do not use command substitution with any of these commands to construct file paths (e.g., `$(which python3)`, `$(printenv GOPATH)/src`, `$(command -v git)`). Use relative paths and `Glob`/`Grep` within the project directory.

## Frontmatter quick reference

All supported frontmatter fields:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Kebab-case name — must match the directory name |
| `description` | Yes | When/why to invoke this skill; drives auto-invocation matching |
| `user-invokable` | No | `true` to allow `/plugin:name` slash command invocation (default: `false`) |
| `tools` | No | Comma-separated tool allowlist for agent definitions (omit to inherit defaults) |
| `model` | No | Model override: `opus`, `sonnet`, or `haiku` (omit to inherit from parent) |
| `disable-model-invocation` | No | `true` to prevent Claude from auto-invoking; use for user-only commands with side effects |

**Notes:**
- `tools` and `model` are primarily used in agent files (`agents/*.md`), not skill files
- `disable-model-invocation: true` is appropriate for commands like `/lead` and `/create-ticket` that should only run when explicitly invoked
- Skills in `skills/` that are also user-invokable should set `user-invokable: true`; commands in `commands/` are always user-invokable and do not need this field

## Choosing commands/ vs skills/

| Type | Directory | Invocation |
|------|-----------|------------|
| User-invoked slash command (side effects) | `commands/` | `/plugin:name` only |
| Model-invoked background knowledge | `skills/` | Claude auto-invokes based on context |
| Both user and model | `skills/` | Either can invoke |

## Example SKILL.md

A realistic mini-skill showing all frontmatter fields:

```markdown
---
name: run-checks
description: Run linting and tests for the project. Use before committing or creating a PR.
user-invokable: true
disable-model-invocation: false
tools: Read, Bash, Glob, Grep
model: sonnet
---

# Run Checks

Runs the project's verification suite. Always run before opening a PR.

## Commands

Run from the project root:

- Lint: `shellcheck scripts/**/*.sh`
- Test: `npm test`

## What to check

- All shellcheck warnings are errors — fix them before proceeding
- Test failures block the PR; flaky tests should be marked or fixed, not ignored

## Scripts

Helper scripts live in `skills/run-checks/scripts/`:
- `scripts/check-and-report.sh` — runs checks and formats output for issue comments
```

## Writing the content

- Use imperative/verb-first language ("Create the file" not "You should create")
- Keep SKILL.md under ~100 lines; move large references to separate files in the same directory
- Include concrete values (constants, commands) — save Claude a file lookup
- No prose padding; every line should earn its place in context
- Co-locate scripts in a `scripts/` subdirectory **within** the skill/command directory (e.g., `skills/my-skill/scripts/`), not at the project root

## After creating

Commit the new skill and push to its open PR.
