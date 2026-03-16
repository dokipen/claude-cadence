import { test, expect } from "./fixtures/auth";

test.describe("ticket detail page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cadence_project_id", "e2e-test-project");
    });
  });

  test("clicking a ticket card navigates to detail page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const refinedCard = page.getByTestId("column-REFINED").getByTestId("ticket-card");
    await refinedCard.click();

    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page).toHaveURL(/\/ticket\//);
  });

  test("detail page shows ticket title and number", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-title")).toHaveText("Refined ticket");
    await expect(page.getByTestId("detail-number")).toHaveText("#2");
  });

  test("detail page shows state and priority", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-state")).toHaveText("Refined");
    await expect(page.getByTestId("priority-badge")).toHaveText("Medium");
  });

  test("detail page shows assignee", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-assignee")).toContainText("E2E Tester");
  });

  test("detail page shows story points", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-story-points")).toHaveText("3");
  });

  test("detail page shows labels", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-labels").getByTestId("label-badge")).toHaveText("enhancement");
  });

  test("detail page shows description", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-description")).toContainText("A ticket in refined state");
  });

  test("detail page shows acceptance criteria", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-acceptance-criteria")).toContainText("Criteria one");
  });

  test("detail page shows comments chronologically", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-comments")).toBeVisible();
    await expect(page.getByTestId("comment-body")).toHaveText("This is a test comment on the refined ticket.");
  });

  test("detail page shows blocked-by relationships", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-blocked-by")).toBeVisible();
    const blockingTicket = page.getByTestId("blocking-ticket");
    await expect(blockingTicket).toContainText("In-progress ticket");
  });

  test("blocking link navigates to other ticket", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("blocking-ticket").click();
    await expect(page.getByTestId("detail-title")).toHaveText("In-progress ticket");
  });

  test("back link returns to board", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("back-link").click();
    await expect(page.getByTestId("kanban-board")).toBeVisible();
  });

  test("back link preserves project selection", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("back-link").click();
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(page.getByTestId("column-REFINED").getByText("Refined ticket")).toBeVisible();
  });

  test("direct URL to ticket detail works", async ({ page }) => {
    // First navigate to get a real ticket ID
    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const card = page.getByTestId("column-REFINED").getByTestId("ticket-card");
    const href = await card.getAttribute("href");
    expect(href).toBeTruthy();

    // Navigate directly to the detail URL
    await page.goto(href!);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("detail-title")).toHaveText("Refined ticket");
  });

  test("ticket with no comments shows empty state", async ({ page }) => {
    await page.goto("/");
    // Backlog ticket has no comments
    await page.getByTestId("column-BACKLOG").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("no-comments")).toBeVisible();
  });

  test("ticket with no assignee shows unassigned", async ({ page }) => {
    await page.goto("/");
    // Backlog ticket has no assignee
    await page.getByTestId("column-BACKLOG").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("detail-assignee")).toContainText("Unassigned");
  });
});

test.describe("ticket detail unauthenticated", () => {
  test("unauthenticated direct navigation redirects to login", async ({ browser }) => {
    // Use a fresh context without the auth fixture
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/ticket/some-id");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
