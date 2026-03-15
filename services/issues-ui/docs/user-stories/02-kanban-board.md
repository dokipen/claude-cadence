# US-02: Kanban Board

**Phase:** 2 (Kanban Board) — 5 story points

## Summary

Users can view tickets organized by state in a kanban-style board, filtered by project.

## Stories

- As a user, I see four columns: BACKLOG, REFINED, IN_PROGRESS, and CLOSED
- As a user, each column displays tickets in that state for the currently selected project
- As a user, the CLOSED column shows only the most recent ~20 closed tickets
- As a user, each ticket card shows: title, priority indicator, labels, assignee avatar, and story points
- As a user, each column header shows the column name and ticket count
- As a user, I can scroll each column independently when there are many tickets
- As a user, I see a loading indicator while ticket data is being fetched
- As a user, I see a friendly empty state when a column has no tickets
- As a user, columns stack vertically on mobile viewports

## E2E Tests

| Test | Description |
|------|-------------|
| `board_renders_four_columns` | Four state columns are visible with correct headers |
| `tickets_in_correct_columns` | Seeded tickets appear in their expected state columns |
| `card_shows_title` | Ticket cards display the ticket title |
| `card_shows_priority` | Priority badge renders with correct color |
| `card_shows_labels` | Label chips render with correct name and color |
| `card_shows_assignee` | Assigned tickets show avatar or login |
| `card_shows_story_points` | Story point badge is visible when set |
| `empty_column_state` | Column with no tickets shows empty state message |

## Technical Notes

- Uses `tickets` query with `state` and `projectId` filters
- BACKLOG/REFINED/IN_PROGRESS: `first: 100`; CLOSED: `first: 20`
- Four parallel fetches (one per column) for fast loading
- Each column scrolls independently via `overflow-y: auto`
- Board uses CSS Grid: `grid-template-columns: repeat(4, 1fr)` on desktop, single column on mobile
