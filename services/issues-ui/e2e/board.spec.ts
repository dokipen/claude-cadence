import { test, expect } from "./fixtures/auth";

test.describe("kanban board", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-select the main test project so board tests are deterministic
    await page.addInitScript(() => {
      localStorage.setItem("cadence_project_id", "e2e-test-project");
    });
    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();
  });

  test("renders four columns", async ({ page }) => {
    await expect(page.getByTestId("column-BACKLOG")).toBeVisible();
    await expect(page.getByTestId("column-REFINED")).toBeVisible();
    await expect(page.getByTestId("column-IN_PROGRESS")).toBeVisible();
    await expect(page.getByTestId("column-CLOSED")).toBeVisible();
  });

  test("tickets appear in correct columns", async ({ page }) => {
    await expect(
      page.getByTestId("column-BACKLOG").getByText("Backlog ticket"),
    ).toBeVisible();
    await expect(
      page.getByTestId("column-REFINED").getByText("Refined ticket"),
    ).toBeVisible();
    await expect(
      page.getByTestId("column-IN_PROGRESS").getByText("In-progress ticket"),
    ).toBeVisible();
    await expect(
      page.getByTestId("column-CLOSED").getByText("Closed ticket"),
    ).toBeVisible();
  });

  test("card shows title", async ({ page }) => {
    const card = page.getByTestId("ticket-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("card-title")).not.toBeEmpty();
  });

  test("card shows priority badge with correct value", async ({ page }) => {
    const backlogColumn = page.getByTestId("column-BACKLOG");
    const badge = backlogColumn.getByTestId("priority-badge").first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("Low");
    await expect(badge).toHaveAttribute("data-priority", "LOW");
  });

  test("card shows labels", async ({ page }) => {
    const backlogColumn = page.getByTestId("column-BACKLOG");
    await expect(backlogColumn.getByTestId("label-badge")).toHaveText("bug");
  });

  test("card shows assignee", async ({ page }) => {
    const refinedColumn = page.getByTestId("column-REFINED");
    await expect(refinedColumn.getByTestId("assignee")).toBeVisible();
    await expect(refinedColumn.getByTestId("assignee")).toContainText(
      "e2e-tester",
    );
  });

  test("card shows story points", async ({ page }) => {
    const refinedColumn = page.getByTestId("column-REFINED");
    await expect(refinedColumn.getByTestId("story-points")).toHaveText("3");
  });

  test("story points are right-aligned regardless of assignee", async ({ page }) => {
    // Ticket with assignee (REFINED column, ticket #2)
    const withAssignee = page.getByTestId("column-REFINED").getByTestId("ticket-card").first();
    await expect(withAssignee.getByTestId("assignee")).toBeVisible();
    const actionsWithAssignee = withAssignee.locator('[class*="cardActions"]');
    const footerWithAssignee = withAssignee.locator('[class*="cardFooter"]');
    const actionsBoxWith = await actionsWithAssignee.boundingBox();
    const footerBoxWith = await footerWithAssignee.boundingBox();
    expect(actionsBoxWith).toBeTruthy();
    expect(footerBoxWith).toBeTruthy();
    // cardActions right edge should align with cardFooter right edge
    const rightEdgeWith = actionsBoxWith!.x + actionsBoxWith!.width;
    const footerRightWith = footerBoxWith!.x + footerBoxWith!.width;
    expect(rightEdgeWith).toBeCloseTo(footerRightWith, 0);

    // Ticket without assignee (CLOSED column, ticket #4 has story points but no assignee)
    const withoutAssignee = page.getByTestId("column-CLOSED").getByTestId("ticket-card").first();
    await expect(withoutAssignee.getByTestId("assignee")).not.toBeVisible();
    const actionsWithout = withoutAssignee.locator('[class*="cardActions"]');
    const footerWithout = withoutAssignee.locator('[class*="cardFooter"]');
    const actionsBoxWithout = await actionsWithout.boundingBox();
    const footerBoxWithout = await footerWithout.boundingBox();
    expect(actionsBoxWithout).toBeTruthy();
    expect(footerBoxWithout).toBeTruthy();
    // cardActions right edge should align with cardFooter right edge (right-justified)
    const rightEdgeWithout = actionsBoxWithout!.x + actionsBoxWithout!.width;
    const footerRightWithout = footerBoxWithout!.x + footerBoxWithout!.width;
    expect(rightEdgeWithout).toBeCloseTo(footerRightWithout, 0);
  });

  test("card shows blocked badge when blocker is open", async ({ page }) => {
    const refinedColumn = page.getByTestId("column-REFINED");
    await expect(refinedColumn.getByTestId("blocked-badge")).toBeVisible();
    await expect(refinedColumn.getByTestId("blocked-badge")).toHaveText("Blocked");
  });

  test("card hides blocked badge when all blockers are closed", async ({ page }) => {
    const backlogColumn = page.getByTestId("column-BACKLOG");
    // Backlog ticket is blocked only by a closed ticket — no badge should appear
    const backlogCards = backlogColumn.getByTestId("ticket-card");
    const backlogCard = backlogCards.filter({ hasText: "Backlog ticket" });
    await expect(backlogCard.getByTestId("blocked-badge")).not.toBeVisible();
  });

  test("column header shows ticket count", async ({ page }) => {
    await expect(page.getByTestId("count-BACKLOG")).toHaveText("2");
    await expect(page.getByTestId("count-REFINED")).toHaveText("1");
    await expect(page.getByTestId("count-IN_PROGRESS")).toHaveText("1");
    await expect(page.getByTestId("count-CLOSED")).toHaveText("1");
  });

  test("empty column shows empty state message", async ({ page }) => {
    // Switch to the second project which has only a BACKLOG ticket
    const selector = page.getByTestId("project-selector");
    await selector.selectOption({ label: "E2E Empty Project" });

    await expect(page.getByTestId("count-BACKLOG")).toHaveText("1");
    await expect(page.getByTestId("empty-REFINED")).toBeVisible();
    await expect(page.getByTestId("empty-REFINED")).toHaveText("No tickets");
    await expect(page.getByTestId("empty-IN_PROGRESS")).toBeVisible();
    await expect(page.getByTestId("empty-CLOSED")).toBeVisible();
  });
});

test.describe("project selector", () => {
  test("project selector is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-selector")).toBeVisible();
  });

  test("default project is auto-selected on first visit", async ({ page }) => {
    // No cadence_project_id in localStorage — first project alphabetically is selected
    await page.goto("/");
    const selector = page.getByTestId("project-selector");
    await expect(selector).toBeVisible();
    // "E2E Empty Project" sorts first alphabetically
    await expect(selector).toContainText("E2E Empty Project");
  });

  test("switching projects updates board", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cadence_project_id", "e2e-test-project");
    });
    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    // Verify first project tickets are visible
    await expect(
      page.getByTestId("column-BACKLOG").getByText("Backlog ticket"),
    ).toBeVisible();

    // Switch to second project
    const selector = page.getByTestId("project-selector");
    await selector.selectOption({ label: "E2E Empty Project" });

    // Second project ticket visible, first project ticket gone
    await expect(
      page.getByTestId("column-BACKLOG").getByText("Other project ticket"),
    ).toBeVisible();
    await expect(
      page.getByTestId("column-BACKLOG").getByText("Backlog ticket"),
    ).not.toBeVisible();
  });

  test("project selection persists across reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    // Switch to second project
    const selector = page.getByTestId("project-selector");
    await selector.selectOption({ label: "E2E Empty Project" });
    await expect(
      page.getByTestId("column-BACKLOG").getByText("Other project ticket"),
    ).toBeVisible();

    // Reload and verify second project is still selected
    await page.reload();
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(page.getByTestId("project-selector")).toHaveValue(
      "e2e-test-project-2",
    );
    await expect(
      page.getByTestId("column-BACKLOG").getByText("Other project ticket"),
    ).toBeVisible();
  });
});
