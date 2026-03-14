# Comments

## User Stories

- As a user, I can add a comment to a ticket so that context, decisions, and discussion are captured alongside the work item
- As a user, I can view all comments on a ticket with author info so that I can follow the full discussion history
- As a user, I can edit my own comment so that I can correct mistakes or add clarification
- As a user, I can delete my own comment so that I can remove outdated or incorrect information

## Details

### GraphQL Operations

**Mutations:**
- `addComment(ticketId: ID!, body: String!): Comment` — adds a comment to a ticket, with the authenticated user as author
- `updateComment(id: ID!, body: String!): Comment` — updates the comment body (author-only)
- `deleteComment(id: ID!): Comment` — deletes the comment (author-only)

**Field resolvers:**
- `Ticket.comments` — returns all comments on a ticket, ordered by creation time
- `Comment.author` — returns the User who authored the comment

### CLI Commands

```
issues comment add <ticket-id> # --body
issues comment edit <id>       # --body
issues comment delete <id>
```

### Data Model

- **Comment** — `id`, `body`, `ticketId` (FK to Ticket), `authorId` (FK to User), `createdAt`, `updatedAt`

### Edge Cases

- Adding a comment to a non-existent ticket returns a not-found error
- Editing or deleting another user's comment returns a forbidden/authorization error
- Editing or deleting a non-existent comment returns a not-found error
- Empty comment body returns a validation error
- Comments are returned in chronological order (oldest first)

## Acceptance Criteria

- [ ] `addComment` mutation creates a comment linked to the ticket and authenticated user
- [ ] Comments include author information (login, displayName, avatarUrl) when queried
- [ ] `updateComment` mutation updates the body of the comment
- [ ] `updateComment` rejects updates from users who are not the comment author
- [ ] `deleteComment` mutation removes the comment
- [ ] `deleteComment` rejects deletion from users who are not the comment author
- [ ] `Ticket.comments` field resolver returns comments in chronological order
- [ ] CLI `comment add` creates a comment with --body flag
- [ ] CLI `comment edit` updates a comment with --body flag
- [ ] CLI `comment delete` removes a comment
- [ ] All comment operations require authentication

## Related

- **E2E test**: `services/issues-cli/test/e2e/comments.e2e.ts`
- **Phase**: Phase 4 — Comments
