---
name: create-skill
description: Create a new Claude Code skill or command for the project. Use when bootstrapping new skills, commands, or plugin components.
user-invokable: false
---

# Create a Skill

Skills live in `skills/<name>/SKILL.md` (model-invoked) or `commands/<name>/SKILL.md` (user-invoked).

## Frontmatter quick reference

```yaml
name: kebab-case-name          # must match directory name
description: "This skill should be used when..."  # triggers auto-invocation
```

## Choosing commands/ vs skills/

| Type | Directory | Invocation |
|------|-----------|------------|
| User-invoked slash command (side effects) | `commands/` | `/plugin:name` only |
| Model-invoked background knowledge | `skills/` | Claude auto-invokes based on context |
| Both user and model | `skills/` | Either can invoke |

## Writing the content

- Use imperative/verb-first language ("Create the file" not "You should create")
- Keep SKILL.md under ~100 lines; move large references to separate files in the same directory
- Include concrete values (constants, commands) — save Claude a file lookup
- No prose padding; every line should earn its place in context
- Co-locate scripts in a `scripts/` subdirectory within the skill/command

## After creating

Commit the new skill and push to its open PR.
