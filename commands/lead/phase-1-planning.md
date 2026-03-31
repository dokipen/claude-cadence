### Phase 1: Planning

1. **Clarify requirements**: Review the acceptance criteria
2. **Research** (parallel): Delegate simultaneous research tasks to build a complete picture faster. Scope research to files and modules referenced in the issue and acceptance criteria.
   - **Architecture**: Delegate to `code-reviewer` to read existing code in the affected area and summarize the current architecture, key abstractions, and dependencies
   - **Test coverage**: Delegate to `tester` to check what's tested, what's missing, and what test patterns are used in the affected area (analysis only — do not write or run new tests at this stage)

   Launch these as parallel Agent tool calls. Collect all results before proceeding to step 3.
3. **Classify work type**:
   - Feature with UI → Phase 1a (Design, if designer agent available)
   - Bug fix → Phase 1b (Reproduction)
   - Other → Delegate to appropriate specialist
4. **Task breakdown**: Create 3-6 discrete units with clear owners
5. **Post plan to issue**:

   **GitHub (default):**
   ```bash
   gh issue comment [N] --body "## Plan

   [Task breakdown summary with approach and key decisions]"
   ```

   **Issues API (MCP preferred):**
   ```
   mcp__issues__comment_add
     ticketId: "<TICKET_CUID>"
     body: "## Plan\n\n[Task breakdown summary with approach and key decisions]"
   ```

   **Issues API (CLI fallback):**
   ```bash
   issues comment add TICKET_ID --body "$(cat <<'EOF'
## Plan

[Task breakdown summary with approach and key decisions]
EOF
)" --json
   ```

### Phase 1a: Design Review (for visual changes, if designer agent available)

1. Delegate to `designer` for an HTML mockup
2. Open mockup for user review
3. Delegate to `ux-engineer` if available for usability review
4. **Wait for user approval** before implementation (user intervention required)

### Phase 1b: Bug Reproduction (required for bug fixes)

**Before any fix is attempted**, delegate to `tester`:
1. Write a failing test that reproduces the reported bug
2. Verify the test fails for the right reason (the bug, not test setup issues)
3. If reproduction fails, report back — the lead must clarify the bug or adjust scope, then re-run Phase 1b from step 1

**Do NOT proceed to Phase 2 until a failing reproduction test exists.**
