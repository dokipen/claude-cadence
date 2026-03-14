# Workflow States (FSM)

## User Stories

- As a user, I can transition a ticket from Backlog to Refined so that triaged work is marked as ready for implementation
- As a user, I can transition a ticket from Refined to In-Progress so that active work is tracked (unless the ticket is blocked)
- As a user, I can transition a ticket from In-Progress to Closed so that completed work is recorded
- As a user, I can demote a ticket from Refined to Backlog so that deprioritized work returns to triage
- As a user, I can return a ticket from In-Progress to Refined so that paused or re-scoped work goes back to the ready queue
- As a user, I can reopen a ticket from Closed to Backlog so that regressions or incomplete work can be reworked
- As a user, I get a clear error when attempting an invalid transition so that I understand the allowed workflow
- As a user, I get a clear error when moving a blocked ticket to In-Progress so that I resolve dependencies first

## Details

### State Machine

Four states with the following allowed transitions:

```
BACKLOG     -> [REFINED]
REFINED     -> [IN_PROGRESS, BACKLOG]
IN_PROGRESS -> [CLOSED, REFINED]
CLOSED      -> [BACKLOG]
```

All other transitions are invalid and must be rejected.

### Guards

- **Blocker guard**: A ticket cannot transition to IN_PROGRESS if it has any unresolved blockers (i.e., any ticket in its `blockedBy` list is not in CLOSED state). This guard applies to the Refined -> In-Progress transition.

### GraphQL Operations

**Mutations:**
- `transitionTicket(id: ID!, to: TicketState!): Ticket` — validates the transition against the allowed map and guards, then updates the state

### CLI Commands

```
issues ticket transition <id>  # --to <STATE>
```

### Implementation

Data-driven approach in `src/fsm/`:
- `transitions.ts` — a map of `{ [fromState]: [allowedToStates] }`
- `ticket-machine.ts` — validation logic that checks the map and runs guard functions (e.g., blocker check)

No external state machine library is needed for 4 states.

### Edge Cases

- Transitioning to the current state (e.g., BACKLOG -> BACKLOG) is invalid
- Attempting a skip transition (e.g., BACKLOG -> CLOSED, BACKLOG -> IN_PROGRESS) returns a clear error with the allowed transitions
- Transitioning a non-existent ticket returns a not-found error
- The blocker guard only fires on transitions targeting IN_PROGRESS

## Acceptance Criteria

- [ ] BACKLOG -> REFINED transition succeeds
- [ ] REFINED -> IN_PROGRESS transition succeeds when ticket has no unresolved blockers
- [ ] IN_PROGRESS -> CLOSED transition succeeds
- [ ] REFINED -> BACKLOG demotion succeeds
- [ ] IN_PROGRESS -> REFINED return succeeds
- [ ] CLOSED -> BACKLOG reopen succeeds
- [ ] Invalid transitions (e.g., BACKLOG -> CLOSED, BACKLOG -> IN_PROGRESS) return an error with a message listing allowed transitions
- [ ] Transitioning a blocked ticket to IN_PROGRESS returns an error identifying the unresolved blockers
- [ ] Transitioning a ticket whose blockers are all CLOSED to IN_PROGRESS succeeds
- [ ] `transitionTicket` mutation updates the ticket state and returns the updated ticket
- [ ] CLI `ticket transition <id> --to <STATE>` works for all valid transitions
- [ ] CLI displays meaningful error messages for invalid transitions and blocked tickets
- [ ] Unit tests in `fsm.test.ts` cover all valid transitions, invalid transitions, and the blocker guard

## Related

- **E2E test**: `services/issues-cli/test/e2e/workflow-states.e2e.ts`
- **Phase**: Phase 3 — FSM + Blocking
