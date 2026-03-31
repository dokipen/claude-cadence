### Phase 2: Implementation

**The lead orchestrates — it does NOT write implementation code directly** (with one narrow exception, below).

> **Direct-edit exception:** The lead may use `Edit` directly for purely mechanical changes — value tweaks, wording fixes, config updates — that touch ≤ 3 lines in a single file. Logic changes (new conditions, functions, algorithms) must always be delegated, even if they touch only one line. Multi-file changes must always be delegated regardless of per-file line count.

For each task from the Phase 1 breakdown, delegate to an agent:

1. **Choose the right agent for each task:**
   - `general-purpose` agent (a built-in Agent tool type, not a custom agent definition) for implementation tasks (feature code, refactoring, configuration changes)
   - `tester` for writing or updating tests
   - Other specialists for domain-specific work matching their expertise
2. **Assign clear file-ownership boundaries** — no two agents modify the same file in the same phase. If overlap is needed, sequence the tasks.
3. **Parallelize independent tasks** — launch concurrent Agent tool calls for tasks with no dependencies between them. Limit to 3–4 concurrent agents to avoid write contention.
4. **Sequence dependent tasks** — wait for one agent to complete before starting the next when outputs feed into subsequent work
5. **Use the Delegation Template** (see [Coordination Protocol](coordination-protocol.md)) for every delegation — include worktree path, issue context, scope, constraints, expected output, and completion signal
6. **Verify incrementally** after each completed task using the project's verification command (from CLAUDE.md). This catches issues early; Phase 3 runs the full verification as the final gate before PR creation.
7. For bug fixes: the fix should make the reproduction test pass
8. **Post implementation summary to issue** (see ticket-provider skill — **Comment** operation):
   ```
   ## Implementation complete

   [Summary of changes made and files modified]

   Moving to verification.
   ```

### Phase 3: Pre-PR Verification

1. Run the project's full verification command (from CLAUDE.md)
2. For bug fixes: verify the reproduction test now passes
3. Fix failures, re-run until all pass

### Phase 4: PR Creation

1. Use `/create-pr` to create the pull request. Link to the issue with `Fixes #[NUMBER]`.
2. **Post PR link to issue** (see ticket-provider skill — **Comment** operation):
   > PR created: #[PR-NUMBER] ([PR-URL])

### Phase 5: Code Review Gate

**All review feedback goes to the PR, not the issue.**

> **Note:** Do NOT use GitHub's approval system. Post review status as comments.

1. Delegate ALL applicable reviews simultaneously using parallel Agent tool calls:
   - `code-reviewer` — always
   - `security-engineer` — always for PRs that add or modify code, scripts, agent definitions, or workflow instructions; skip for purely informational doc changes
   - `performance-engineer` — when the PR touches I/O, data structures, concurrency, or hot paths
   - `tester` — when the PR adds or modifies tests (validate test quality and coverage)
2. Collect all findings, then triage by severity (Critical/Warning block merge, Suggestions don't)
3. Fix-review loop: assign fixes, push, re-review (max 3 cycles before escalation)
4. Handle deferred findings using the convention below
5. Once all blocking findings are resolved, proceed directly to Phase 7 (skip Phase 6 unless the PR touches paths listed in the project's `## QA Triggers` CLAUDE.md section)

#### Deferred Findings Convention

Before deferring a finding, ask: **is this quick to fix right now?** If a finding is low priority and low effort (a few lines of code, based on context the reviewer already has), fix it in the current PR rather than creating a ticket. Creating and tracking an issue costs more than a simple in-place fix.

When a finding genuinely needs to be deferred (not blocking the current PR and not trivial to fix), decide where to track it:

- **Add to an existing issue** when the finding naturally fits within a planned phase's scope (e.g., a missing validation that belongs in the API hardening ticket). Add it as a new acceptance criterion on that issue.
- **Create a new issue** when the finding is independent work that doesn't fit any existing ticket. Label it `agent-discovered` and assign a priority using the project's ticket provider:
  - **GitHub:** Add a priority label (`priority:high`, `priority:medium`, or `priority:low`)
  - **Issues API:** Set the native priority field (`--priority HIGH`, `MEDIUM`, or `LOW`)

  Deferred findings default to low priority unless the reviewer indicates higher severity.

In both cases:
- Link back to the originating review: include "Discovered in #[PR-NUMBER] review" in the finding description
- Review agents should recommend a target (existing ticket or new issue) and a priority in their review output — the lead makes the final call

### Phase 6: Manual QA (visual changes or agent-service changes)

> **This phase applies only when the project's CLAUDE.md contains a `## QA Triggers` section AND the PR touches paths listed there.** If the section is absent, proceed directly from Phase 5 to Phase 7.

Before running the detection below, read the `## QA Triggers` section from the project's CLAUDE.md and extract:
- **Agent-service paths**: lines under `### Agent-service changes` (stop at next `###` or `##` heading). Each line is a single-line ERE path prefix.
- **Visual/UI paths**: lines under `### Visual/UI changes` (stop at next `###` or `##` heading). Each line is a single-line ERE path prefix.

If the `## QA Triggers` section is absent or empty, skip this phase entirely. If only one subsection is defined, treat the other trigger category as inactive and omit its grep call.

Detect the PR type using the extracted paths:
```bash
# Substitute the extracted path patterns from CLAUDE.md's ## QA Triggers section
# Example using cadence defaults — replace with actual paths from the project's CLAUDE.md:
AGENT_PATTERN='^services/(agents|agent-hub)/'   # from ### Agent-service changes
VISUAL_PATTERN='^services/issues-ui/'            # from ### Visual/UI changes

# Only run each check if the corresponding subsection is defined
[ -n "$AGENT_PATTERN" ] && git diff origin/main...HEAD --name-only | grep -qE "$AGENT_PATTERN" && echo "agent-service changes detected"
[ -n "$VISUAL_PATTERN" ] && git diff origin/main...HEAD --name-only | grep -qE "$VISUAL_PATTERN" && echo "visual changes detected"
```

Run **both** applicable sub-sections below. A PR that touches both agent-service and UI code requires both setup paths.

#### Visual/UI changes

1. **Run the QA environment setup script** from the worktree:
   ```bash
   bash "$CADENCE_ROOT/commands/lead/scripts/start-qa-env.sh" "$WORKTREE_DIR"
   ```
   The script handles `.env.dev` setup, port discovery, and compose stack startup. It prints the QA URL (`http://HOST_IP:PORT/`) and opens it in the browser. If `.env.dev` is missing, the script copies `.env.dev.example` and continues automatically — no manual secret editing needed for UI-only QA.

   **What requires a rebuild vs. what picks up automatically:**
   - Changes to `services/issues-ui/` (frontend) are reflected immediately via Vite HMR — no rebuild needed.
   - Changes to `services/issues/` (backend) require a container rebuild. Note the project name printed by the script (e.g. `cadence-qa-5173`) and substitute it below:
     ```bash
     docker compose -p <PROJECT_NAME> up --build issues
     ```
2. Wait for user feedback (user intervention required)
3. Address issues if reported, return to Phase 5 after fixes

#### Agent-service changes

These services have hard host dependencies (the `claude` CLI, OS service integration) that make them impractical to containerize. Run them on the host alongside the compose stack.

1. **Ensure `.env.dev` exists** with the agent-service secrets (`HUB_API_TOKEN`, `HUB_AGENT_TOKEN`, `AGENTD_TOKEN`):
   ```bash
   # If .env.dev doesn't exist yet, copy the example and fill in secrets first
   cp .env.dev.example .env.dev
   $EDITOR .env.dev
   ```

2. **Direct the user to build and install the host services:**
   ```bash
   # Build and install agentd
   cd services/agents && make build
   ./install/install.sh

   # Build agent-hub
   cd services/agent-hub && make build
   ./agent-hub --config <your-config.yaml>
   ```
   See [`docs/dev-environment.md`](docs/dev-environment.md) and [`services/agents/docs/INSTALL.md`](services/agents/docs/INSTALL.md) for full configuration details.

3. **Start the compose stack.** If the Visual/UI section above already ran the `start-qa-env.sh` script, that stack is already running — skip this step and use the URL it printed. Otherwise, run the script now:
   ```bash
   bash "$CADENCE_ROOT/commands/lead/scripts/start-qa-env.sh" "$WORKTREE_DIR"
   ```

4. Wait for user feedback (user intervention required)
5. Address issues if reported, return to Phase 5 after fixes

#### Teardown (after QA is confirmed)

Once the user confirms QA passes, stop the compose stack using the project name printed by `start-qa-env.sh`:

```bash
docker compose -p <PROJECT_NAME> down
```

### Phase 7: Merge and Cleanup

1. Wait for PR checks to pass, then merge. Use a 10-minute timeout to avoid blocking on stuck checks (`--watch` returns immediately if checks are already green):
   ```bash
   timeout 600 gh pr checks --watch --fail-fast && gh pr merge --squash --delete-branch
   ```
   > **Note:** On macOS without GNU coreutils, use `gtimeout` instead of `timeout`.

   - If checks pass: the merge proceeds automatically
   - If checks fail: report the specific failed check(s) to the user
   - If timeout is exceeded: report the timeout and the still-pending check(s) to the user
2. Close the ticket (see ticket-provider skill — **Close Ticket** operation):
   - **GitHub:** The PR's `Fixes #N` auto-closes it; remove the `in-progress` label: `gh issue edit [NUMBER] --remove-label "in-progress"`
3. Sync blocked labels using the `update-blocked-labels.sh` script in this command's `scripts/` directory
4. Return to default branch and pull latest (skip if `WORKTREE_PREEXISTING` — the worktree is not ours to clean up):
   ```bash
   _COMMON_DIR="$(git rev-parse --git-common-dir)"
   cd "${_COMMON_DIR}/.."
   DEFAULT_BRANCH="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')"
   git checkout "${DEFAULT_BRANCH:-main}" && git pull
   ```
5. Clean up worktree using the `project-ops` skill's `cleanup-worktree.sh` script (skip if `WORKTREE_PREEXISTING`):
   ```bash
   bash "$CADENCE_ROOT/skills/project-ops/scripts/cleanup-worktree.sh" "$BRANCH"
   ```
6. **Post completion to issue** (see ticket-provider skill — **Comment** operation):
   > Completed #[NUMBER]: [TITLE]. Merged via PR #[PR-NUMBER].
7. Report completion to the user, including the ticket number, title, and PR link (e.g., "Completed #42: Add user authentication. Merged via PR #[PR-NUMBER].")

> **Note:** If this phase is skipped (e.g., conversation ends early), cleanup happens automatically the next time `/new-work` creates a worktree — the `cleanup-merged-worktrees.sh` pre-flight detects merged PRs and cleans up their worktrees, branches, and labels.
