---
name: skill-iterate
description: Evaluate, benchmark, and iteratively improve an existing Claude Code skill using Anthropic's skill-creator tooling. Use when a skill draft already exists and the user wants to measure trigger accuracy, run quantitative evals, review output quality, or optimize the skill description. Do NOT use this for creating a skill from scratch — use create-skill for that.
user-invokable: false
---

# Skill Iterate

Drives the eval → review → rewrite loop for an existing skill using [Anthropic's open-source skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator).

This skill is the second phase of skill development. `create-skill` handles the cadence-specific bootstrap (directory layout, frontmatter, required sections). This skill handles everything after the first draft exists.

## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.

## Prerequisites

The skill being iterated must already have:
- A `SKILL.md` with valid frontmatter (`name`, `description`)
- A `## Filesystem Scope` section (cadence requirement — must survive each iteration)

## Step 1: Detect skill-creator install

Check for an existing install in this order:

```bash
if [ -d ".claude/skills/skill-creator" ]; then
  SKILL_CREATOR_DIR=".claude/skills/skill-creator"
elif [ -d ".agents/skills/skill-creator" ]; then
  SKILL_CREATOR_DIR=".agents/skills/skill-creator"
else
  SKILL_CREATOR_DIR=""
fi
echo "${SKILL_CREATOR_DIR:-NOT_FOUND}"
```

If not found, offer to install it:

```bash
bash skills/skill-iterate/scripts/install-skill-creator.sh
```

The installer defaults to `.claude/skills/skill-creator/` and pins to a known-good upstream commit. After running, set `SKILL_CREATOR_DIR=".claude/skills/skill-creator"`.

## Step 2: Run the eval/iterate loop

The upstream skill-creator drives the loop. Point it at the skill under development:

**Entry point:** `$SKILL_CREATOR_DIR/SKILL.md`

The loop covers:
1. Create or review test prompts for the skill
2. Run Claude-with-skill on the test prompts (`scripts/run_eval.py`)
3. Review results qualitatively with `eval-viewer/generate_review.py`
4. Review quantitative metrics (variance analysis via `scripts/aggregate_benchmark.py`)
5. Rewrite the skill based on evaluation feedback
6. Repeat until quality bar is met
7. Run description improver (`scripts/improve_description.py`) to optimize trigger accuracy

Refer to `$SKILL_CREATOR_DIR/SKILL.md` for full workflow instructions.

## Step 3: Post-iterate validation (cadence invariants)

After each iteration of the skill being improved, verify cadence-required sections are intact:

```bash
# Check ## Filesystem Scope is present
grep -q "## Filesystem Scope" skills/<name>/SKILL.md && echo "OK" || echo "MISSING"

# Check frontmatter has name and description
grep -q "^name:" skills/<name>/SKILL.md && echo "name: OK" || echo "name: MISSING"
grep -q "^description:" skills/<name>/SKILL.md && echo "description: OK" || echo "description: MISSING"
```

If `## Filesystem Scope` was dropped by the rewrite, restore it immediately:

```markdown
## Filesystem Scope

> **IMPORTANT:** See the **Filesystem Scope** section in `CLAUDE.md`.
```

Place it as the first `##` section after the `#` title.

## Layout reference

```
skills/<name>/
├── SKILL.md            ← the skill being iterated
└── scripts/            ← co-located scripts (cadence convention)

.claude/skills/skill-creator/   ← upstream tooling (vendored by install script)
├── SKILL.md
├── agents/             ← analyzer.md, comparator.md, grader.md
├── eval-viewer/        ← generate_review.py
├── scripts/            ← run_eval.py, improve_description.py, aggregate_benchmark.py
└── references/
```
