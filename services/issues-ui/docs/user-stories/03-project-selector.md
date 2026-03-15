# US-03: Project Selector

**Phase:** 2 (Kanban Board) — included in Phase 2 estimate

## Summary

Users can switch between projects to view different sets of tickets.

## Stories

- As a user, I see a project selector in the header showing the current project name
- As a user, I can switch to a different project and the board updates to show that project's tickets
- As a user, my project selection persists across page refreshes (stored in localStorage)
- As a user, if I have not selected a project, the first project is automatically selected

## E2E Tests

| Test | Description |
|------|-------------|
| `project_selector_visible` | Project dropdown renders in the header |
| `switching_projects_updates_board` | Selecting a different project changes displayed tickets |
| `default_project_selected` | First project is selected on initial load |

## Technical Notes

- Uses `projects` query: `query { projects { id, name, repository } }`
- Selected project ID stored in localStorage as `cadence_project_id`
- Project selector is a dropdown in the `Layout` header component
