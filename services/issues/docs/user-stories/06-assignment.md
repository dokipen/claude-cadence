# Assignment

## User Stories

- As a user, I can assign a ticket to a user so that ownership and responsibility for work items is clear
- As a user, I can unassign a ticket so that ownership can be released when work is handed off or deprioritized
- As a user, I can filter tickets by assignee so that I can view a specific person's workload

## Details

### GraphQL Operations

**Mutations:**
- `assignTicket(ticketId: ID!, userId: ID!): Ticket` — assigns the specified user to the ticket
- `unassignTicket(ticketId: ID!): Ticket` — removes the current assignee from the ticket

**Query filter:**
- `tickets(assigneeLogin: String, ...)` — filter tickets by the assignee's GitHub login

**Field resolvers:**
- `Ticket.assignee: User` — returns the assigned user (nullable; unassigned tickets return null)

### CLI Commands

```
issues assign <ticket-id>      # --user <id>
issues unassign <ticket-id>
```

### Data Model

The Ticket model has an optional `assigneeId` field (FK to User). A ticket can have at most one assignee at a time. Unassigned tickets have `assigneeId: null`.

### Edge Cases

- Assigning a non-existent user to a ticket returns a not-found error
- Assigning to a non-existent ticket returns a not-found error
- Re-assigning a ticket (already has an assignee) replaces the current assignee
- Unassigning an already-unassigned ticket is a no-op or returns the ticket unchanged
- Filtering by a non-existent assigneeLogin returns an empty list (not an error)

## Acceptance Criteria

- [ ] `assignTicket` mutation sets the assignee on a ticket
- [ ] `unassignTicket` mutation clears the assignee on a ticket
- [ ] Re-assigning a ticket replaces the previous assignee
- [ ] `Ticket.assignee` field resolver returns the User or null
- [ ] `tickets(assigneeLogin: "...")` filter returns only tickets assigned to that user
- [ ] Assigning a non-existent user returns an error
- [ ] CLI `assign <ticket-id> --user <id>` assigns the user to the ticket
- [ ] CLI `unassign <ticket-id>` removes the assignee
- [ ] CLI `ticket list --assignee <login>` filters by assignee
- [ ] All assignment operations require authentication

## Related

- **E2E test**: `services/issues-cli/test/e2e/assignment.e2e.ts`
- **Phase**: Phase 2 — Labels + Assignment
