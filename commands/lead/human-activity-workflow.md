## Human Activity Workflow

> This section applies **only** when the ticket has the `human-activity` label. The standard implementation phases (2–7) are skipped entirely. No source code is changed — the lead presents a step-by-step walkthrough and guides the human through completing the required manual tasks.

### Human Activity Phase 1: Build the Walkthrough

1. Read the full ticket description and acceptance criteria to identify all required manual steps.
2. Present the walkthrough to the user with a clear header and numbered steps. For each step, include:
   - **What to do**: A clear, actionable instruction
   - **Why**: The purpose or outcome of the step
   - **How to verify**: How the human knows the step is complete (if applicable)

   Example format:
   ```
   ## Walkthrough: [Ticket Title]

   This ticket requires manual steps that cannot be automated. Walk through each step below and confirm completion before moving to the next.

   ---

   ### Step 1: [Step title]

   **What to do:** [Clear instruction]

   **Why:** [Purpose of this step]

   **How to verify:** [Verification signal, if applicable]

   ---

   ### Step 2: [Step title]
   ...
   ```

### Human Activity Phase 2: Interactive Step Confirmation

After presenting the full walkthrough, guide the human through each step **one at a time** — present a single step, wait for confirmation, then move to the next:

1. Present the current step (starting with step 1).
2. **Wait for the human to confirm completion** before presenting the next step. Ask explicitly: *"Let me know when you've completed this step."*
3. If the human reports an issue or blocker on a step:
   - Offer clarification or alternative approaches if possible
   - If the step is truly blocked, help the human document what's needed and pause the workflow
4. Repeat until all steps are confirmed complete.

### Human Activity Phase 3: Close the Ticket

Once all steps are confirmed complete:

1. Post a completion summary to the ticket (see ticket-provider skill — **Comment** operation):
   ```
   ## Walkthrough complete: [TITLE]

   All manual steps confirmed complete by the human operator.
   ```

2. Close the ticket (see ticket-provider skill — **Close Ticket** operation).

3. Report completion to the user, including the ticket number and title (e.g., "Completed #42: Add user authentication.").

### Human Activity Phase 4: Cleanup

Since the human-activity workflow skips Phase 0, no worktree or branch was created. Skip all cleanup steps — there is nothing to remove. Report completion to the user and stop.
