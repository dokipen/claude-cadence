# US-04: Ticket Detail

**Phase:** 3 (Ticket Detail) — 3 story points

## Summary

Users can view the full details of a ticket including comments and blocking relationships.

## Stories

- As a user, I can click a ticket card on the board to navigate to its detail page
- As a user, I see the ticket's title, state badge, and priority badge
- As a user, I see the ticket's description and acceptance criteria as text
- As a user, I see metadata: project name, assignee, story points, labels, created/updated dates
- As a user, I see a chronological list of comments with author avatar, author name, and timestamp
- As a user, I see "Blocks" and "Blocked By" sections showing linked tickets
- As a user, I can click a blocked/blocking ticket to navigate to its detail page
- As a user, I can navigate back to the board via a back link (preserving my project selection)
- As a user, I can navigate directly to a ticket via URL (`/ticket/:id`)

## E2E Tests

| Test | Description |
|------|-------------|
| `click_card_navigates_to_detail` | Clicking a card on the board opens the detail page |
| `detail_shows_title_and_description` | Ticket title and description are visible |
| `detail_shows_state_and_priority` | State and priority badges render |
| `detail_shows_comments` | Comments render with author and timestamp |
| `detail_shows_blocking` | Blocking relationships display with linked tickets |
| `blocking_links_navigate` | Clicking a blocked ticket navigates to its detail |
| `back_navigation_returns_to_board` | Back link returns to the kanban board |
| `direct_url_loads_detail` | Navigating to `/ticket/:id` directly loads the detail page |

## Technical Notes

- Uses `ticket(id)` query with full field selection including comments, blocks, blockedBy
- Route: `/ticket/:id` in React Router
- Back link preserves project selection from localStorage
- Comments displayed chronologically with `createdAt` timestamp
