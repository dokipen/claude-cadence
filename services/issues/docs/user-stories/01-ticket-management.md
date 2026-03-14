# Ticket Management

## User Stories

- As a user, I can create a ticket with a title, description, acceptance criteria, and optional labels so that work items are captured with full context from the start
- As a user, I can view a single ticket with all its details so that I can understand the full scope and current state of a work item
- As a user, I can list tickets with cursor pagination so that I can browse large backlogs efficiently
- As a user, I can filter tickets by state, label, assignee, blocked status, or priority so that I can focus on the subset of work that matters right now
- As a user, I can update a ticket's title, description, or acceptance criteria so that tickets stay accurate as understanding evolves
- As a user, I cannot delete tickets so that the project history is preserved (tickets are closed via state transition instead)

## Details

### GraphQL Operations

**Queries:**
- `ticket(id: ID!): Ticket` — returns a single ticket with all relations (labels, comments, assignee, blocks, blockedBy)
- `tickets(state, labelName, assigneeLogin, isBlocked, priority, first, after): TicketConnection` — cursor-paginated list with filters

**Mutations:**
- `createTicket(input: CreateTicketInput!): Ticket` — creates a ticket; supports optional `labelIds`, `assigneeId`, `storyPoints`, and `priority` at creation time
- `updateTicket(id: ID!, input: UpdateTicketInput!): Ticket` — updates title, description, acceptanceCriteria, storyPoints, or priority

**Input types:**
```graphql
input CreateTicketInput {
  title: String!
  description: String
  acceptanceCriteria: String
  labelIds: [ID!]
  assigneeId: ID
  storyPoints: Int
  priority: Priority
}

input UpdateTicketInput {
  title: String
  description: String
  acceptanceCriteria: String
  storyPoints: Int
  priority: Priority
}
```

### CLI Commands

```
issues ticket create           # Interactive or --title/--desc/--labels/--priority/--points
issues ticket view <id>        # Show ticket details
issues ticket list             # List with --state/--label/--assignee/--blocked/--priority
issues ticket update <id>      # Update fields
```

### Data Model

The Ticket model includes: `id`, `title`, `description`, `acceptanceCriteria`, `state` (enum: BACKLOG/REFINED/IN_PROGRESS/CLOSED), `storyPoints` (Int, optional), `priority` (enum, default MEDIUM), `assigneeId` (FK to User). New tickets default to BACKLOG state.

### Edge Cases

- Creating a ticket with no title returns a validation error
- Creating a ticket with non-existent `labelIds` returns an error
- Listing with no filters returns all tickets, paginated
- Cursor pagination uses opaque cursors; invalid cursors return an error
- Updating a non-existent ticket returns a not-found error

## Acceptance Criteria

- [ ] `createTicket` mutation accepts title (required), description, acceptanceCriteria, labelIds, assigneeId, storyPoints, and priority
- [ ] New tickets default to BACKLOG state and MEDIUM priority
- [ ] `ticket(id)` query returns the ticket with all relations populated (labels, comments, assignee, blocks, blockedBy)
- [ ] `tickets` query supports cursor-based pagination via `first` and `after` arguments
- [ ] `tickets` query supports filtering by state, labelName, assigneeLogin, isBlocked, and priority
- [ ] `updateTicket` mutation updates only the provided fields, leaving others unchanged
- [ ] No delete mutation exists for tickets
- [ ] CLI `ticket create` command works with flags (--title, --desc, --labels, --priority, --points)
- [ ] CLI `ticket view <id>` displays all ticket details including labels, assignee, and state
- [ ] CLI `ticket list` displays paginated results with filter flags
- [ ] CLI `ticket update <id>` updates the specified fields
- [ ] All operations require authentication (return UNAUTHENTICATED for anonymous requests)

## Related

- **E2E test**: `services/issues-cli/test/e2e/ticket-management.e2e.ts`
- **Phase**: Phase 1 — Steel Thread
