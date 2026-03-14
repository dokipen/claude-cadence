# Priority & Estimation

## User Stories

- As a user, I can set story points on a ticket so that the team can estimate effort and plan capacity
- As a user, I can set a priority on a ticket so that the most important work is identified and tackled first
- As a user, I can filter tickets by priority so that I can focus on the highest-impact items
- As a user, I can update story points and priority after creation so that estimates can be revised as understanding improves
- As a user, I can set story points and priority during ticket creation so that new tickets are fully triaged from the start

## Details

### Priority Levels

```graphql
enum Priority {
  HIGHEST
  HIGH
  MEDIUM
  LOW
  LOWEST
}
```

Default priority is MEDIUM when not specified at creation time.

### Story Points

Story points are arbitrary positive integers. There is no enforced scale at the API level (the Fibonacci convention of 1, 2, 3, 5, 8, 13 is a team practice, not a system constraint).

### GraphQL Operations

**At creation time:**
- `createTicket(input: CreateTicketInput!)` — the input includes optional `storyPoints: Int` and `priority: Priority` fields

**At update time:**
- `updateTicket(id: ID!, input: UpdateTicketInput!)` — the input includes optional `storyPoints: Int` and `priority: Priority` fields

**Filtering:**
- `tickets(priority: Priority, ...)` — filter tickets by priority level

### CLI Commands

```
issues ticket create           # --priority <LEVEL> --points <INT>
issues ticket update <id>      # --priority <LEVEL> --points <INT>
issues ticket list             # --priority <LEVEL>
```

### Data Model

On the Ticket model:
- `storyPoints: Int?` — optional, nullable positive integer
- `priority: Priority` — enum, defaults to MEDIUM

### Edge Cases

- Story points must be a positive integer; zero or negative values return a validation error
- Priority values outside the enum return a GraphQL validation error
- Omitting storyPoints at creation leaves it null (not estimated)
- Omitting priority at creation defaults to MEDIUM
- Filtering by priority returns tickets matching that exact level (not a range)
- Updating storyPoints or priority leaves other fields unchanged

## Acceptance Criteria

- [ ] `createTicket` accepts optional `storyPoints` (positive integer) and `priority` (enum)
- [ ] `storyPoints` defaults to null when not provided at creation
- [ ] `priority` defaults to MEDIUM when not provided at creation
- [ ] `updateTicket` can modify `storyPoints` and `priority` independently
- [ ] `tickets(priority: HIGHEST)` returns only tickets with HIGHEST priority
- [ ] Story points reject zero or negative values with a validation error
- [ ] Priority field only accepts valid enum values (HIGHEST, HIGH, MEDIUM, LOW, LOWEST)
- [ ] CLI `ticket create --priority HIGH --points 5` sets both fields at creation
- [ ] CLI `ticket update <id> --priority LOW` updates priority without affecting other fields
- [ ] CLI `ticket update <id> --points 8` updates story points without affecting other fields
- [ ] CLI `ticket list --priority MEDIUM` filters by priority
- [ ] All priority and estimation operations require authentication

## Related

- **E2E test**: `services/issues-cli/test/e2e/priority-estimation.e2e.ts`
- **Phase**: Phase 1 — Steel Thread
