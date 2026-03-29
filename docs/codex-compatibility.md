# Codex Compatibility

This repository now includes a thin Codex compatibility layer.

## Goal

Make Claude Cadence usable in Codex without changing the existing Claude setup and without creating a second copy of the workflow prompts.

## Source of Truth

The canonical workflow content remains in the existing Claude-oriented files:

- `CLAUDE.md`
- `commands/*/SKILL.md`
- `skills/*/SKILL.md`
- `agents/*.md`
- shared scripts under `commands/**/scripts/` and `skills/**/scripts/`

The Codex layer does not translate or fork those prompts. It packages them for Codex discovery.

## Codex Packaging

- `.codex-plugin/plugin.json` points Codex at `./codex/skills`
- `codex/skills/*/SKILL.md` contains thin wrappers that tell Codex which Claude Cadence file to read
- `scripts/sync-codex.py` regenerates those wrappers from the Claude source files

## Editing Rules

- Update the Claude source files first
- Re-run `python3 scripts/sync-codex.py`
- Do not hand-edit generated files under `codex/skills/`

## Runtime Translation

The wrappers only translate packaging/runtime concepts:

- Claude slash commands become Codex skills
- Claude agent delegation becomes Codex sub-agent delegation or local execution
- `CLAUDE.md` remains the project context file for verification, build, and ticket provider settings

This keeps the workflow DRY while preserving the current Claude plugin layout unchanged.
