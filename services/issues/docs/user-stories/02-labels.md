# Labels

## User Stories

- As a user, I can create a label with a name and color so that I can categorize tickets in a way that suits my project
- As a user, I can add a label to a ticket so that tickets are categorized for filtering and triage
- As a user, I can remove a label from a ticket so that miscategorized tickets can be corrected
- As a user, I can list all labels so that I know which categories are available
- As a user, I can view all tickets with a given label so that I can focus on a specific category of work
- As a user, I get default labels seeded on first run so that common categories are available out of the box

## Details

### GraphQL Operations

**Queries:**
- `labels: [Label!]!` — returns all labels
- `tickets(labelName: String, ...): TicketConnection` — filter tickets by label name

**Mutations:**
- `createLabel(name: String!, color: String!): Label` — creates a new label
- `addLabel(ticketId: ID!, labelId: ID!): Ticket` — adds a label to a ticket
- `removeLabel(ticketId: ID!, labelId: ID!): Ticket` — removes a label from a ticket

### CLI Commands

```
issues label create            # --name/--color
issues label list              # List all labels
issues label add <ticket-id>   # --label <id>
issues label remove <ticket-id># --label <id>
```

### Data Model

- **Label** — `id`, `name` (unique), `color`
- **TicketLabel** — explicit join table (`ticketId`, `labelId`) for the many-to-many relationship; uses a join table (rather than implicit) to support future metadata on the relationship

### Default Labels (seeded via `prisma/seed.ts`)

| Label         | Color   |
|---------------|---------|
| bug           | #d73a4a |
| enhancement   | #a2eeef |
| accessibility | #0075ca |
| security      | #e4e669 |
| ux            | #d876e3 |
| performance   | #f9d0c4 |

The seed uses `upsert` so it is idempotent and safe to re-run.

### Edge Cases

- Creating a label with a duplicate name returns an error (name is unique)
- Adding a label that is already on a ticket is a no-op or returns the ticket unchanged
- Removing a label not present on a ticket returns an error or is a no-op
- Adding a label with a non-existent labelId or ticketId returns an error

## Acceptance Criteria

- [ ] `createLabel` mutation creates a label with a name and color
- [ ] Label names are unique; duplicate creation returns an error
- [ ] `labels` query returns all labels in the system
- [ ] `addLabel` mutation associates a label with a ticket
- [ ] `removeLabel` mutation removes a label association from a ticket
- [ ] Tickets can be filtered by label name via the `tickets` query
- [ ] Default labels (bug, enhancement, accessibility, security, ux, performance) are seeded on first run
- [ ] Seed is idempotent (re-running does not create duplicates)
- [ ] CLI `label create` works with --name and --color flags
- [ ] CLI `label list` displays all available labels
- [ ] CLI `label add` and `label remove` work with ticket-id and --label flag
- [ ] All label operations require authentication

## Related

- **E2E test**: `services/issues-cli/test/e2e/labels.e2e.ts`
- **Phase**: Phase 2 — Labels + Assignment
