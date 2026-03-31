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
4. **Create a PR and merge** using `/create-pr`. The plan document must land on the default branch before sub-tickets are created, so implementers can link to it at a stable path. Wait for the PR to merge before proceeding to Plan Phase 3.

### Plan Phase 3: Implementation Ticket Creation

For each phase in the plan document, create an implementation ticket:

**Shell safety:** The `--title` argument is inline — avoid backticks in phase titles. Write titles as plain text without backtick code formatting.

**GitHub (default):**
```bash
gh issue create \
  --title "[Phase title from plan]" \
  --label "enhancement" \
  --body "$(cat <<'EOF'
## Description
[Phase description from plan]

## Plan Reference
Derived from the plan document: `docs/plans/<slug>.md` (plan ticket: #[NUMBER])

## Acceptance Criteria
[Tasks and completion criteria from this phase]
EOF
)"
```

**Issues API (MCP preferred):**
Use `mcp__issues__label_list` to resolve label names to IDs first, then:
```
mcp__issues__ticket_create
  title: "[Phase title from plan]"
  projectName: "$PROJECT"
  description: "## Description\n[Phase description from plan]\n\n## Plan Reference\nDerived from the plan document: `docs/plans/<slug>.md` (plan ticket: #[NUMBER])"
  acceptanceCriteria: "- [ ] [Criterion 1 from this phase]\n- [ ] [Criterion 2 from this phase]"
  labelIds: ["<ENHANCEMENT_LABEL_CUID>"]
```

**Issues API (CLI fallback):**
```bash
issues ticket create \
  --project $PROJECT \
  --title "[Phase title from plan]" \
  --labels "ENHANCEMENT_LABEL_ID" \
  --description "$(cat <<'EOF'
## Description
[Phase description from plan]

## Plan Reference
Derived from the plan document: `docs/plans/<slug>.md` (plan ticket: #[NUMBER])
EOF
)" \
  --acceptance-criteria "$(cat <<'EOF'
- [ ] [Criterion 1 from this phase]
- [ ] [Criterion 2 from this phase]
EOF
)" \
  --json
```

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

# Apply to plan ticket
gh issue edit [NUMBER] --add-label "milestone:[N]-[slug]"

# Apply to each child ticket
gh issue edit [CHILD-NUMBER-1] --add-label "milestone:[N]-[slug]"
gh issue edit [CHILD-NUMBER-2] --add-label "milestone:[N]-[slug]"
# ... repeat for all child tickets
```

**Issues API — Label Creation (CLI only — MCP tools cannot create labels):**
```bash
MILESTONE_LABEL_NAME="milestone:[N]-[slug]"
bash "$CADENCE_ROOT/commands/lead/scripts/ensure-milestone-label.sh" "$MILESTONE_LABEL_NAME"
```

Then apply the label using MCP (preferred) or CLI fallback. Use `mcp__issues__label_list` to resolve `$MILESTONE_LABEL_NAME` to a CUID first.

**Issues API (MCP preferred):**
```
mcp__issues__label_add  ticketId: "<PLAN-TICKET-CUID>"      labelId: "<MILESTONE_LABEL_CUID>"
mcp__issues__label_add  ticketId: "<CHILD-TICKET-CUID-1>"   labelId: "<MILESTONE_LABEL_CUID>"
mcp__issues__label_add  ticketId: "<CHILD-TICKET-CUID-2>"   labelId: "<MILESTONE_LABEL_CUID>"
# ... repeat for all child tickets
```

**Issues API (CLI fallback):**
```bash
# Apply to plan ticket
issues label add [PLAN-TICKET-ID] --label "$MILESTONE_LABEL_NAME" --json

# Apply to each child ticket
issues label add [CHILD-TICKET-ID-1] --label "$MILESTONE_LABEL_NAME" --json
issues label add [CHILD-TICKET-ID-2] --label "$MILESTONE_LABEL_NAME" --json
# ... repeat for all child tickets
```

### Plan Phase 4: Blocker Wiring

If the plan document identifies no sequencing dependencies, skip this phase entirely.

Otherwise, wire up blockers between the newly created tickets for each dependency identified in the plan:

**GitHub (default):**
GitHub does not have a native blocker API via `gh`. Add a **Dependencies** section to each ticket that has prerequisites. Fetch the existing body first to avoid double-expansion:
```bash
CURRENT_BODY=$(gh issue view [BLOCKED-NUMBER] --json body --jq '.body')
gh issue edit [BLOCKED-NUMBER] --body "$CURRENT_BODY

## Dependencies
Blocked by: #[BLOCKER-NUMBER]"
```

**Issues API (CLI only — no MCP tool for block relationships):**
```bash
issues block add --blocker [BLOCKER-NUMBER] --blocked [BLOCKED-NUMBER] --project $PROJECT --json
```

### Plan Phase 5: Close the Plan Ticket

After all sub-tickets are created and the plan doc is committed:

**GitHub (default):**
```bash
gh issue comment [NUMBER] --body "$(cat <<'EOF'
## Planning complete: [TITLE]

Plan document: `docs/plans/<slug>.md`

Implementation tickets created:
- #[SUB-NUMBER-1]: [title]
- #[SUB-NUMBER-2]: [title]

Closing plan ticket.
EOF
)"
gh issue close [NUMBER]
```

**Issues API (MCP preferred):**
```
mcp__issues__comment_add
  ticketId: "<TICKET_CUID>"
  body: "## Planning complete: [TITLE]\n\nPlan document: `docs/plans/<slug>.md`\n\nImplementation tickets created:\n- #[SUB-NUMBER-1]: [title]\n- #[SUB-NUMBER-2]: [title]\n\nClosing plan ticket."
mcp__issues__ticket_transition  id: "<TICKET_CUID>"  to: "CLOSED"
```

**Issues API (CLI fallback):**
```bash
issues comment add TICKET_ID --body "$(cat <<'EOF'
## Planning complete: [TITLE]

Plan document: `docs/plans/<slug>.md`

Implementation tickets created:
- #[SUB-NUMBER-1]: [title]
- #[SUB-NUMBER-2]: [title]

Closing plan ticket.
EOF
)" --json
issues ticket transition TICKET_ID --to CLOSED --json
```

### Plan Phase 6: Cleanup

1. Return to default branch and pull latest (skip if `WORKTREE_PREEXISTING`)
2. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script (skip if `WORKTREE_PREEXISTING`)
3. Report completion to the user, including the ticket number, title, and plan doc path
