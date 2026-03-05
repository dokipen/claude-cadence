---
name: create-skill
description: Create a new Claude Code skill for the project
version: 1.0.0
disable-model-invocation: true
---

# Create a Skill

Skills live in `.claude/skills/<name>/SKILL.md`.

## Frontmatter quick reference

```yaml
name: kebab-case-name          # must match directory name
description: "This skill should be used when..."  # triggers auto-invocation
version: 1.0.0
# Pick ONE invocation mode (omit both = Claude + user can invoke):
user-invocable: false          # Claude-only (background knowledge)
disable-model-invocation: true # User-only (/slash-command with side effects)
```

## Invocation mode decision

| Skill type | Flag |
|---|---|
| Background knowledge / conventions | `user-invocable: false` |
| Side-effect workflow (creates files, runs git, etc.) | `disable-model-invocation: true` |
| Both Claude and user should invoke | _(omit both)_ |

## Writing the content

- Use imperative/verb-first language ("Create the file" not "You should create")
- Keep SKILL.md under ~100 lines; move large references to `references/` subdirectory
- Include concrete values (constants, commands) — save Claude a file lookup
- No prose padding; every line should earn its place in context

## After creating

Commit the new skill and push to its open PR.
