import { test, expect } from "./fixtures/auth";

test.describe("auto-refresh", () => {
  test("board re-fetches tickets every 60 seconds", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cadence_project_id", "e2e-test-project");
    });

    // Install fake timers before navigating
    await page.clock.install();

    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(
      page.getByTestId("column-BACKLOG").getByText("Backlog ticket"),
    ).toBeVisible();

    // Track GraphQL requests to count refetches
    let graphqlRequestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/graphql")) {
        graphqlRequestCount++;
      }
    });

    // Fast-forward 60 seconds to trigger the polling interval
    graphqlRequestCount = 0;
    await page.clock.fastForward(60_000);

    // Wait for the refetch request(s) to complete
    await page.waitForResponse((resp) => resp.url().includes("/graphql"));

    expect(graphqlRequestCount).toBeGreaterThanOrEqual(1);

    // Board should still be visible after refresh
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(
      page.getByTestId("column-BACKLOG").getByText("Backlog ticket"),
    ).toBeVisible();
  });

  test("ticket detail re-fetches data every 60 seconds", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cadence_project_id", "e2e-test-project");
    });

    // Install fake timers before navigating
    await page.clock.install();

    // Navigate to board, then click into a ticket detail
    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await page
      .getByTestId("column-REFINED")
      .getByTestId("ticket-card")
      .click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("detail-title")).toHaveText("Refined ticket");

    // Track GraphQL requests to count refetches
    let graphqlRequestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/graphql")) {
        graphqlRequestCount++;
      }
    });

    // Fast-forward 60 seconds to trigger the polling interval
    graphqlRequestCount = 0;
    await page.clock.fastForward(60_000);

    // Wait for the refetch request to complete
    await page.waitForResponse((resp) => resp.url().includes("/graphql"));

    expect(graphqlRequestCount).toBeGreaterThanOrEqual(1);

    // Ticket detail should still be visible with correct data after refresh
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("detail-title")).toHaveText("Refined ticket");
  });
});
