## Coordination Protocol

### Delegation Template

When delegating to any agent, include all of the following:

1. **Working directory:** `cd [WORKING_DIR]` where `[WORKING_DIR]` is the actual working directory (`$PWD`) — do not assume `.worktrees/` paths (sub-agents do not inherit the lead's working directory)
2. **Issue context:** `Read issue #N for full context: gh issue view N`
3. **Scope:** Which files, directories, or areas to focus on
4. **Constraints:** What NOT to modify (other agents' files, out-of-scope areas)
5. **Expected output:** What the lead needs back (findings list, code changes, test results)
6. **Completion signal:** End with one of:
   - **TASK COMPLETE**: Summary of what was done
   - **TASK BLOCKED**: What's blocking and what's needed
   - **TASK NEEDS REVIEW**: Ready for next phase

### File Ownership
- No two specialists modify the same file in the same phase
- If overlap needed, sequence the tasks

### Discovering New Issues
When agents discover out-of-scope issues:
- Create a NEW issue (not scope creep)
- Label with `agent-discovered`
- Assign a priority using the project's ticket provider:
  - **GitHub:** Add a priority label (`priority:high`, `priority:medium`, or `priority:low`)
  - **Issues API:** Set the native priority field (`--priority HIGH`, `MEDIUM`, or `LOW`)
- Default to low priority unless the finding warrants higher
- Continue with original work
