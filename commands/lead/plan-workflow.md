## Plan Workflow

> This section applies **only** when the ticket has the `plan` label. The standard implementation phases (2–7) are skipped entirely. No source code is changed — the only output is a plan document and a set of implementation tickets.

**Use `/effort max` for all agent delegations in this workflow** — planning work benefits from maximum depth and thoroughness.

### Plan Phase 0: Worktree Setup

Same as the standard [Phase 0](phase-0-worktree.md). A worktree is required to commit the plan document.

### Plan Phase 1: Goal Analysis

Delegate to a `general-purpose` agent with `/effort max` to analyze the ticket goal:

- Read the full ticket description and acceptance criteria
- Survey the existing codebase for relevant context (architecture, conventions, existing patterns)
- Produce a structured outline: goals, constraints, proposed components/phases, sequencing dependencies

The agent should return a detailed outline — not a final document, but raw material for the plan doc.

### Plan Phase 2: Plan Document Creation

Using the outline from Plan Phase 1, delegate to a `general-purpose` agent to write and commit the plan document:

1. **Derive a slug** from the ticket title: lowercase, spaces replaced with hyphens, all non-alphanumeric-or-hyphen characters removed. Example: "Make a source code explorer" → `source-code-explorer`. The slug must contain only `[a-z0-9-]` — verify this before use. The output path must start with `docs/plans/` and contain no `..` components.
2. **Write the plan document** to `docs/plans/<slug>.md`. The document should include:
   - **Goal**: What this plan is trying to achieve
   - **Background**: Relevant context from the codebase
   - **Architecture**: Key components, abstractions, and how they fit together
   - **Implementation Phases**: Numbered phases, each with a title, description, and list of tasks. Phases should be independently implementable where possible.
   - **Sequencing**: Which phases must complete before others can begin (dependency graph)
   - **Open Questions**: Anything that needs user/stakeholder input before implementation
3. **Commit the document**. Use the slug (not the raw ticket title) in the commit message to avoid shell metacharacter issues:
   ```bash
   git add docs/plans/<slug>.md
   git commit -m "docs: add plan for <slug> (#[NUMBER])"
   ```
4. **Create a PR and merge** using `/create-pr`. The plan document must land on the default branch before sub-tickets are created, so implementers can link to it at a stable path. Use a 10-minute timeout to avoid hanging indefinitely:
   ```bash
   TIMEOUT_CMD=$(bash "$CADENCE_ROOT/commands/lead/scripts/detect-timeout-cmd.sh")
   "$TIMEOUT_CMD" 600 gh pr checks --watch --fail-fast && gh pr merge --squash --delete-branch
   ```
   The helper auto-selects `gtimeout` (macOS with GNU coreutils) or `timeout` (Linux). (`--watch` returns immediately if checks are already green.)

   - If checks pass: the merge proceeds automatically; continue to Plan Phase 3
   - If checks fail: report the specific failed check(s) to the user and **abort the workflow** — do not create sub-tickets against an unmerged plan doc
   - If timeout is exceeded: report the timeout and the still-pending check(s) to the user and **abort the workflow**

### Plan Phase 3: Implementation Ticket Creation

For each phase in the plan document, create an implementation ticket:

**Shell safety:** The `--title` argument is inline — avoid backticks in phase titles. Write titles as plain text without backtick code formatting.

Create a ticket for each phase (see ticket-provider skill — **Create Ticket** operation) using this body template:

```
## Description
[Phase description from plan]

## Plan Reference
Derived from the plan document: `docs/plans/<slug>.md` (plan ticket: #[NUMBER])

## Acceptance Criteria
- [ ] [Criterion 1 from this phase]
- [ ] [Criterion 2 from this phase]
```

Note for Issues API: supply `acceptanceCriteria` as a separate field rather than embedding it in `description`.

Record the created ticket number/ID for each phase — needed for blocker wiring and milestone labeling.

### Plan Phase 3a: Milestone Labeling

After all implementation tickets are created, create a milestone label and apply it to the plan ticket and every child ticket. This enables filtering and tracking all tickets belonging to the same plan without manual label work.

**Derive the label name** using the same slug from Plan Phase 2:
```
MILESTONE_LABEL="milestone:[N]-[slug]"
```
For example, issue #42 with slug `add-sound-effects` → `milestone:42-add-sound-effects`.

**GitHub (default):**
```bash
# Create or update the label (--force is idempotent: creates if missing, updates color/desc if present)
gh label create "milestone:[N]-[slug]" \
  --color "8B5CF6" \
  --description "Plan milestone #[N]" \
  --force
```
Then apply to the plan ticket and all child tickets (see ticket-provider skill — **Add Label** operation).

**Issues API — Label Creation (CLI only — MCP tools cannot create labels):**
```bash
MILESTONE_LABEL_NAME="milestone:[N]-[slug]"
bash "$CADENCE_ROOT/commands/lead/scripts/ensure-milestone-label.sh" "$MILESTONE_LABEL_NAME"
```
Then apply to the plan ticket and all child tickets (see ticket-provider skill — **Add Label** operation). Use `mcp__issues__label_list` to resolve `$MILESTONE_LABEL_NAME` to a CUID first.

### Plan Phase 4: Blocker Wiring

If the plan document identifies no sequencing dependencies, skip this phase entirely.

Otherwise, wire up blockers between the newly created tickets for each dependency identified in the plan (see ticket-provider skill — **Wire Blocker** operation).

### Plan Phase 5: Close the Plan Ticket

After all sub-tickets are created and the plan doc is committed:

1. Post a completion comment (see ticket-provider skill — **Comment** operation):
   ```
   ## Planning complete: [TITLE]

   Plan document: `docs/plans/<slug>.md`

   Implementation tickets created:
   - #[SUB-NUMBER-1]: [title]
   - #[SUB-NUMBER-2]: [title]

   Closing plan ticket.
   ```
2. Close the ticket (see ticket-provider skill — **Close Ticket** operation).

### Plan Phase 6: Cleanup

1. Return to default branch and pull latest (skip if `WORKTREE_PREEXISTING`)
2. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script (skip if `WORKTREE_PREEXISTING`)
3. Report completion to the user, including the ticket number, title, and plan doc path
