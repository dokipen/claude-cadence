import { test, expect } from "./fixtures/auth";

const MOCK_AGENTS = {
  agents: [
    {
      name: "mac-mini-1",
      profiles: {
        lead: { description: "Lead profile", repo: "test-org/test-repo" },
      },
      status: "online",
      last_seen: "2026-03-16T12:00:00Z",
    },
    {
      name: "mac-mini-2",
      profiles: {
        lead: { description: "Lead profile", repo: "test-org/test-repo" },
      },
      status: "online",
      last_seen: "2026-03-16T12:00:00Z",
    },
  ],
};

const MOCK_SESSIONS_AGENT1 = [
  {
    id: "session-1",
    name: "lead-109",
    agent_profile: "lead",
    state: "running",
    tmux_session: "lead-109",
    created_at: "2026-03-16T12:00:00Z",
    agent_pid: 1001,
    worktree_path: "/tmp/wt1",
    repo_url: "test-org/test-repo",
    base_ref: "main",
    waiting_for_input: true,
    idle_since: "2026-03-16T12:05:00Z",
  },
];

const MOCK_SESSIONS_AGENT2 = [
  {
    id: "session-2",
    name: "lead-112",
    agent_profile: "lead",
    state: "running",
    tmux_session: "lead-112",
    created_at: "2026-03-16T13:00:00Z",
    agent_pid: 1003,
    worktree_path: "/tmp/wt3",
    repo_url: "test-org/test-repo",
    base_ref: "main",
    waiting_for_input: false,
  },
];

const MOCK_WAITING_SESSIONS = {
  agents: [
    {
      agent_name: "mac-mini-1",
      sessions: [MOCK_SESSIONS_AGENT1[0]],
    },
  ],
};

function setupMocks(page: import("@playwright/test").Page) {
  return Promise.all([
    page.route("**/api/v1/agents", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_AGENTS),
        });
      } else {
        route.continue();
      }
    }),
    page.route("**/api/v1/sessions?waiting_for_input=true", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_WAITING_SESSIONS),
      });
    }),
    page.route("**/api/v1/agents/mac-mini-1/sessions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_SESSIONS_AGENT1),
        });
      } else {
        route.continue();
      }
    }),
    page.route("**/api/v1/agents/mac-mini-2/sessions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_SESSIONS_AGENT2),
        });
      } else {
        route.continue();
      }
    }),
  ]);
}

test.describe("input notifications", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cadence_project_id", "e2e-test-project");
    });
    await setupMocks(page);
  });

  test("notification badge shows count of waiting sessions", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("notification-badge")).toBeVisible();
    await expect(page.getByTestId("notification-badge")).toHaveText("1");
  });

  test("notification dropdown lists waiting sessions with links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("notification-trigger")).toBeVisible();

    // Click to open dropdown
    await page.getByTestId("notification-trigger").click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();

    // Should show the waiting session
    const items = page.getByTestId("notification-item");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("lead-109");
    await expect(items.first()).toContainText("mac-mini-1");
  });

  test("clicking notification navigates to ticket Agent tab", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("notification-trigger").click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();

    // lead-109 should link to /ticket/109
    const item = page.getByTestId("notification-item").first();
    await item.click();
    await expect(page).toHaveURL("/ticket/109");
  });

  test("badge clears when session resumes output", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("notification-badge")).toBeVisible();
    await expect(page.getByTestId("notification-badge")).toHaveText("1");

    // Update mock to return no waiting sessions
    await page.route("**/api/v1/sessions?waiting_for_input=true", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ agents: [] }),
      });
    });

    // Wait for polling interval to pick up the change
    await expect(page.getByTestId("notification-badge")).toBeHidden({ timeout: 15000 });
  });

  test("agent manager sidebar highlights waiting sessions", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(2, { timeout: 15000 });

    // The waiting session (lead-109) should show the filled ring indicator
    const sessions = page.getByTestId("sidebar-session");
    await expect(sessions.first()).toContainText("◉");

    // The non-waiting session (lead-112) should show the normal dot
    await expect(sessions.nth(1)).toContainText("●");
  });

  test("notification not visible when no sessions waiting", async ({ page }) => {
    // Override to return no waiting sessions
    await page.route("**/api/v1/sessions?waiting_for_input=true", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ agents: [] }),
      });
    });

    await page.goto("/");
    // Badge should not be visible when count is 0
    await expect(page.getByTestId("notification-badge")).toBeHidden();
  });

  test("dropdown closes on outside click", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("notification-trigger").click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();

    // Click outside
    await page.locator("body").click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId("notification-dropdown")).toBeHidden();
  });

  test("multiple waiting sessions show correct badge count", async ({ page }) => {
    // Override with two waiting sessions
    await page.route("**/api/v1/sessions?waiting_for_input=true", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agents: [
            {
              agent_name: "mac-mini-1",
              sessions: [MOCK_SESSIONS_AGENT1[0]],
            },
            {
              agent_name: "mac-mini-2",
              sessions: [
                {
                  ...MOCK_SESSIONS_AGENT2[0],
                  waiting_for_input: true,
                  idle_since: "2026-03-16T13:10:00Z",
                },
              ],
            },
          ],
        }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("notification-badge")).toHaveText("2");
  });
});
