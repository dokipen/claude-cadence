import { test, expect } from "./fixtures/auth";

const MOCK_AGENTS = {
  agents: [
    {
      name: "mac-mini-1",
      profiles: {
        lead: {
          description: "Lead profile",
          repo: "test-org/test-repo",
        },
        review: {
          description: "Review profile",
          repo: "test-org/other-repo",
        },
      },
      status: "online",
      last_seen: "2026-03-16T12:00:00Z",
    },
    {
      name: "mac-mini-2",
      profiles: {
        lead: {
          description: "Lead profile",
          repo: "test-org/test-repo",
        },
      },
      status: "online",
      last_seen: "2026-03-16T12:00:00Z",
    },
    {
      name: "offline-host",
      profiles: {
        lead: {
          description: "Lead profile",
          repo: "test-org/test-repo",
        },
      },
      status: "offline",
      last_seen: "2026-03-15T12:00:00Z",
    },
  ],
};

const MOCK_SESSION = {
  id: "session-123",
  name: "lead-2",
  agent_profile: "lead",
  state: "creating",
  tmux_session: "lead-2",
  created_at: "2026-03-16T12:00:00Z",
  agent_pid: 1234,
  worktree_path: "/tmp/worktree",
  repo_url: "test-org/test-repo",
  base_ref: "main",
};

function setupAgentMocks(page: import("@playwright/test").Page) {
  return page.route("**/api/v1/agents", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_AGENTS),
    });
  });
}

const MOCK_RUNNING_SESSION = {
  ...MOCK_SESSION,
  state: "running",
};

function setupSessionMock(
  page: import("@playwright/test").Page,
  existingSessions: unknown[] = [],
) {
  return page.route("**/api/v1/agents/*/sessions", (route) => {
    if (route.request().method() === "POST") {
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(MOCK_SESSION),
      });
    } else if (route.request().method() === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(existingSessions),
      });
    } else {
      route.continue();
    }
  });
}

// Helper to get the open dialog (only one dialog is open at a time)
function openDialog(page: import("@playwright/test").Page) {
  return page.locator("dialog[open]");
}

test.describe("launch agent dialog", () => {
  test.beforeEach(async ({ page }) => {
    await setupAgentMocks(page);
    await setupSessionMock(page);
  });

  test("ticket card shows launch button", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const card = page.getByTestId("column-REFINED").getByTestId("ticket-card");
    await expect(card.getByTestId("card-launch-button")).toBeVisible();
    await expect(card.getByTestId("card-launch-button")).toHaveText("Launch");
  });

  test("launch button opens dialog without navigating", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const card = page.getByTestId("column-REFINED").getByTestId("ticket-card");
    await card.getByTestId("card-launch-button").click();

    // Dialog should be open
    await expect(openDialog(page)).toBeVisible();
    await expect(openDialog(page)).toContainText("Launch Agent on #2");
    // Should still be on the board, not navigated to detail
    await expect(page).toHaveURL("/projects/e2e-test-project");
  });

  test("dialog shows profiles filtered by repo", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const card = page.getByTestId("column-REFINED").getByTestId("ticket-card");
    await card.getByTestId("card-launch-button").click();

    const dialog = openDialog(page);
    await expect(dialog).toBeVisible();

    // Should show profile selector with matching profiles (mac-mini-1/lead and mac-mini-2/lead)
    // "review" profile on mac-mini-1 has a different repo and should NOT appear
    // "offline-host" should NOT appear
    const select = dialog.getByTestId("profile-select");
    await expect(select).toBeVisible();
    const options = select.locator("option");
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText("mac-mini-1 / lead");
    await expect(options.nth(1)).toContainText("mac-mini-2 / lead");
  });

  test("auto-selects when only one matching profile", async ({ page }) => {
    // Override with a single matching agent
    await page.route("**/api/v1/agents", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agents: [MOCK_AGENTS.agents[1]], // mac-mini-2 only has one matching profile
        }),
      });
    });

    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const card = page.getByTestId("column-REFINED").getByTestId("ticket-card");
    await card.getByTestId("card-launch-button").click();

    const dialog = openDialog(page);
    await expect(dialog).toBeVisible();

    // Should show the single profile as text, not a dropdown
    await expect(dialog.getByTestId("profile-single")).toBeVisible();
    await expect(dialog.getByTestId("profile-single")).toContainText("mac-mini-2 / lead");
    await expect(dialog.getByTestId("profile-select")).not.toBeVisible();
  });

  test("session is created and navigates to agent tab", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const card = page.getByTestId("column-REFINED").getByTestId("ticket-card");
    await card.getByTestId("card-launch-button").click();

    const dialog = openDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("launch-submit").click();

    // Should navigate to ticket detail with agent tab
    await expect(page).toHaveURL(/\/ticket\/.*\?tab=agent/);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("agent-tab-content")).toBeVisible();
  });

  test("dialog closes on close button click", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const card = page.getByTestId("column-REFINED").getByTestId("ticket-card");
    await card.getByTestId("card-launch-button").click();

    const dialog = openDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("dialog-close").click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe("ticket detail agent tab", () => {
  test.beforeEach(async ({ page }) => {
    await setupAgentMocks(page);
    await setupSessionMock(page);
  });

  test("detail page shows Details and Agent tabs", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await expect(page.getByTestId("tab-details")).toBeVisible();
    await expect(page.getByTestId("tab-agent")).toBeVisible();
  });

  test("Agent tab shows inline launch control", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("tab-agent").click();
    await expect(page.getByTestId("agent-tab-content")).toBeVisible();
    await expect(page.getByTestId("agent-launcher")).toBeVisible();
    await expect(page.getByTestId("launch-submit")).toBeVisible();
  });

  test("switching tabs preserves content", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    // Start on details tab — sidebar should be visible
    await expect(page.getByTestId("detail-assignee")).toBeVisible();

    // Switch to agent tab
    await page.getByTestId("tab-agent").click();
    await expect(page.getByTestId("agent-tab-content")).toBeVisible();
    await expect(page.getByTestId("detail-assignee")).not.toBeVisible();

    // Switch back to details tab
    await page.getByTestId("tab-details").click();
    await expect(page.getByTestId("detail-assignee")).toBeVisible();
    await expect(page.getByTestId("agent-tab-content")).not.toBeVisible();
  });

  test("navigating to detail with ?tab=agent opens agent tab", async ({ page }) => {
    await page.goto("/projects/e2e-test-project");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    // First navigate to detail to get a valid ticket ID
    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    const url = page.url();
    // Navigate to same URL with ?tab=agent
    await page.goto(url + "?tab=agent");
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("agent-tab-content")).toBeVisible();
  });
});

test.describe("ticket detail terminal", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cadence_project_id", "e2e-test-project");
    });
    await setupAgentMocks(page);
  });

  test("shows terminal when running session exists", async ({ page }) => {
    await setupSessionMock(page, [MOCK_RUNNING_SESSION]);

    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("tab-agent").click();
    await expect(page.getByTestId("agent-tab-content")).toBeVisible();

    // Terminal should be rendered (xterm.js container)
    await expect(page.getByTestId("terminal-wrapper")).toBeVisible();
    await expect(page.getByTestId("terminal-header")).toBeVisible();
    await expect(page.getByTestId("destroy-session")).toBeVisible();
  });

  test("shows launch control when no session exists", async ({ page }) => {
    await setupSessionMock(page, []);

    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("tab-agent").click();
    await expect(page.getByTestId("agent-tab-content")).toBeVisible();

    // Should show launcher, not terminal
    await expect(page.getByTestId("agent-launcher")).toBeVisible();
    await expect(page.getByTestId("terminal-wrapper")).not.toBeVisible();
  });

  test("shows launch control when session is stopped", async ({ page }) => {
    await setupSessionMock(page, [{ ...MOCK_SESSION, state: "stopped" }]);

    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("tab-agent").click();
    await expect(page.getByTestId("agent-tab-content")).toBeVisible();
    await expect(page.getByTestId("agent-launcher")).toBeVisible();
  });

  test("terminal header shows session name and agent", async ({ page }) => {
    await setupSessionMock(page, [MOCK_RUNNING_SESSION]);

    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("tab-agent").click();
    await expect(page.getByTestId("terminal-header")).toBeVisible();
    await expect(page.getByTestId("terminal-header")).toContainText("lead-2");
    await expect(page.getByTestId("terminal-header")).toContainText("mac-mini-1");
  });

  test("destroy session returns to launch control", async ({ page }) => {
    // Mock sessions list with a running session
    await setupSessionMock(page, [MOCK_RUNNING_SESSION]);

    // Also mock DELETE for session destroy
    await page.route("**/api/v1/agents/*/sessions/*", (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({ status: 204 });
      } else {
        route.continue();
      }
    });

    await page.goto("/");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    await page.getByTestId("column-REFINED").getByTestId("ticket-card").click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();

    await page.getByTestId("tab-agent").click();
    await expect(page.getByTestId("terminal-wrapper")).toBeVisible();

    // Now override session list to return empty (session destroyed)
    await page.route("**/api/v1/agents/*/sessions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      } else {
        route.continue();
      }
    });

    await page.getByTestId("destroy-session").click();

    // Should return to the launch control
    await expect(page.getByTestId("agent-launcher")).toBeVisible();
    await expect(page.getByTestId("terminal-wrapper")).not.toBeVisible();
  });
});
