# Blocking

## User Stories

- As a user, I can mark ticket A as blocking ticket B so that dependency relationships between work items are explicit
- As a user, I can remove a blocking relationship so that resolved or incorrect dependencies are cleaned up
- As a user, I can view which tickets a ticket blocks so that I understand the downstream impact of a work item
- As a user, I can view which tickets block a ticket so that I know what must be resolved before work can proceed
- As a user, I cannot move a blocked ticket to In-Progress until all blockers are Closed so that work does not start on items with unresolved dependencies

## Details

### GraphQL Operations

**Mutations:**
- `addBlockRelation(blockerId: ID!, blockedId: ID!): Ticket` — creates a directional blocking relationship where the blocker ticket blocks the blocked ticket
- `removeBlockRelation(blockerId: ID!, blockedId: ID!): Ticket` — removes the blocking relationship

**Field resolvers:**
- `Ticket.blocks: [Ticket!]!` — tickets that this ticket blocks (downstream dependents)
- `Ticket.blockedBy: [Ticket!]!` — tickets that block this ticket (upstream dependencies)

**Query filter:**
- `tickets(isBlocked: Boolean, ...)` — filter tickets by whether they have unresolved blockers

### CLI Commands

```
issues block add               # --blocker <id> --blocked <id>
issues block remove            # --blocker <id> --blocked <id>
```

### Data Model

- **BlockRelation** — directional join table with `blockerId` (FK to Ticket) and `blockedId` (FK to Ticket). The relationship means "blocker blocks blocked."

### Integration with FSM

The blocker guard in the state machine checks blocking relationships: a ticket with any `blockedBy` ticket not in CLOSED state cannot transition to IN_PROGRESS. This is enforced at the `transitionTicket` mutation level.

### Edge Cases

- A ticket cannot block itself (blockerId must differ from blockedId)
- Adding a duplicate block relation is a no-op or returns the ticket unchanged
- Removing a non-existent block relation returns an error or is a no-op
- Adding a block relation with non-existent ticket IDs returns a not-found error
- Circular blocking (A blocks B, B blocks A) is allowed but both tickets would be unable to move to IN_PROGRESS until the cycle is broken
- When viewing a ticket, both `blocks` and `blockedBy` lists are populated

## Acceptance Criteria

- [ ] `addBlockRelation` mutation creates a directional relationship (blocker blocks blocked)
- [ ] `removeBlockRelation` mutation removes the blocking relationship
- [ ] `Ticket.blocks` field resolver returns all tickets blocked by this ticket
- [ ] `Ticket.blockedBy` field resolver returns all tickets blocking this ticket
- [ ] A ticket cannot block itself
- [ ] `tickets(isBlocked: true)` returns only tickets that have unresolved blockers
- [ ] `tickets(isBlocked: false)` returns only tickets with no unresolved blockers
- [ ] A blocked ticket (with any blocker not in CLOSED state) cannot transition to IN_PROGRESS
- [ ] A blocked ticket can transition to IN_PROGRESS after all blockers reach CLOSED state
- [ ] CLI `block add` creates a blocking relationship with --blocker and --blocked flags
- [ ] CLI `block remove` removes a blocking relationship with --blocker and --blocked flags
- [ ] All blocking operations require authentication

## Related

- **E2E test**: `services/issues-cli/test/e2e/blocking.e2e.ts`
- **Phase**: Phase 3 — FSM + Blocking
