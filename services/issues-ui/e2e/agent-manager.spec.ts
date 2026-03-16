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
    {
      name: "offline-host",
      profiles: {
        lead: { description: "Lead profile", repo: "test-org/test-repo" },
      },
      status: "offline",
      last_seen: "2026-03-15T12:00:00Z",
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
  },
  {
    id: "session-2",
    name: "review-88",
    agent_profile: "lead",
    state: "running",
    tmux_session: "review-88",
    created_at: "2026-03-16T12:30:00Z",
    agent_pid: 1002,
    worktree_path: "/tmp/wt2",
    repo_url: "test-org/test-repo",
    base_ref: "main",
  },
];

const MOCK_SESSIONS_AGENT2 = [
  {
    id: "session-3",
    name: "lead-112",
    agent_profile: "lead",
    state: "running",
    tmux_session: "lead-112",
    created_at: "2026-03-16T13:00:00Z",
    agent_pid: 1003,
    worktree_path: "/tmp/wt3",
    repo_url: "test-org/test-repo",
    base_ref: "main",
  },
];

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
    // Offline agents won't be queried, but handle gracefully
    page.route("**/api/v1/agents/offline-host/sessions", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }),
  ]);
}

test.describe("agent manager page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cadence_project_id", "e2e-test-project");
    });
    await setupMocks(page);
  });

  test("header has agents nav link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("agents-nav-link")).toBeVisible();
    await expect(page.getByTestId("agents-nav-link")).toHaveText("Agents");
  });

  test("nav link navigates to /agents", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("agents-nav-link").click();
    await expect(page).toHaveURL("/agents");
    await expect(page.getByTestId("agent-manager")).toBeVisible();
  });

  test("sidebar lists agents grouped by host", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("session-list")).toBeVisible();

    const agents = page.getByTestId("sidebar-agent");
    await expect(agents).toHaveCount(3);

    // Check agent names are present
    await expect(page.getByTestId("session-list")).toContainText("mac-mini-1");
    await expect(page.getByTestId("session-list")).toContainText("mac-mini-2");
    await expect(page.getByTestId("session-list")).toContainText("offline-host");
  });

  test("sidebar shows online/offline status indicators", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("session-list")).toBeVisible();

    // Two online, one offline
    await expect(page.getByTestId("status-online")).toHaveCount(2);
    await expect(page.getByTestId("status-offline")).toHaveCount(1);
  });

  test("sidebar lists sessions under agents", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("session-list")).toBeVisible();

    // Wait for sessions to load
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Check session names
    await expect(page.getByTestId("session-list")).toContainText("lead-109");
    await expect(page.getByTestId("session-list")).toContainText("review-88");
    await expect(page.getByTestId("session-list")).toContainText("lead-112");
  });

  test("clicking session opens terminal in tiling area", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Click first session
    await page.getByTestId("sidebar-session").first().click();

    // Terminal window should appear
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);
    await expect(page.getByTestId("tile-header")).toBeVisible();
  });

  test("opening multiple sessions tiles them", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Open two sessions
    await page.getByTestId("sidebar-session").nth(0).click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);

    await page.getByTestId("sidebar-session").nth(2).click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(2);

    // Should have a split divider
    await expect(page.getByTestId("tile-divider")).toHaveCount(1);
  });

  test("minimize removes terminal but keeps session in sidebar", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Open a session
    await page.getByTestId("sidebar-session").first().click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);

    // Minimize it
    await page.getByTestId("tile-minimize").click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(0);

    // Session should still be in sidebar
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3);
  });

  test("terminate kills session and removes window", async ({ page }) => {
    // Mock DELETE endpoint
    await page.route("**/api/v1/agents/*/sessions/*", (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({ status: 204 });
      } else {
        route.continue();
      }
    });

    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Open a session
    await page.getByTestId("sidebar-session").first().click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);

    // Terminate it
    await page.getByTestId("tile-terminate").click();

    // Window should be removed
    await expect(page.getByTestId("terminal-window")).toHaveCount(0);
  });

  test("dividers are present between tiled windows", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Open three sessions
    await page.getByTestId("sidebar-session").nth(0).click();
    await page.getByTestId("sidebar-session").nth(1).click();
    await page.getByTestId("sidebar-session").nth(2).click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(3);

    // Should have dividers
    const dividers = page.getByTestId("tile-divider");
    await expect(dividers.first()).toBeVisible();
  });

  test("empty tiling area shows placeholder message", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("tiling-area")).toBeVisible();
    await expect(page.getByTestId("tiling-area")).toContainText(
      "Click a session in the sidebar to open a terminal",
    );
  });

  test("clicking already-open session does not duplicate it", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    await page.getByTestId("sidebar-session").first().click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);

    // Click same session again
    await page.getByTestId("sidebar-session").first().click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);
  });

  test("minimized session can be restored from sidebar", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Open then minimize
    await page.getByTestId("sidebar-session").first().click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);

    await page.getByTestId("tile-minimize").click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(0);

    // Click session again to restore
    await page.getByTestId("sidebar-session").first().click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);
  });
});
