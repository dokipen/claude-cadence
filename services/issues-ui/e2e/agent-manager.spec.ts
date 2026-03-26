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
    created_at: "2026-03-16T12:00:00Z",
    agent_pid: 1001,
    repo_url: "test-org/test-repo",
    base_ref: "main",
  },
  {
    id: "session-2",
    name: "review-88",
    agent_profile: "lead",
    state: "running",
    created_at: "2026-03-16T12:30:00Z",
    agent_pid: 1002,
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
    created_at: "2026-03-16T13:00:00Z",
    agent_pid: 1003,
    repo_url: "test-org/test-repo",
    base_ref: "main",
  },
];

const MOCK_ALL_SESSIONS = {
  agents: [
    { agent_name: "mac-mini-1", sessions: MOCK_SESSIONS_AGENT1 },
    { agent_name: "mac-mini-2", sessions: MOCK_SESSIONS_AGENT2 },
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
    page.route("**/api/v1/sessions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_ALL_SESSIONS),
        });
      } else {
        route.continue();
      }
    }),
    // Per-agent endpoints still needed for DELETE (terminate)
    page.route("**/api/v1/agents/*/sessions/*", (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({}),
        });
      } else {
        route.continue();
      }
    }),
  ]);
}

test.describe("agent manager page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("cadence_project_id", "e2e-test-project");
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

  test("single window fills the full tiling area", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Open exactly one session
    await page.getByTestId("sidebar-session").first().click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);

    // With a single window there should be no split divider
    await expect(page.getByTestId("tile-split")).toHaveCount(0);

    // The terminal window should fill the full tiling area
    const tilingArea = page.getByTestId("tiling-area");
    const terminalWindow = page.getByTestId("terminal-window");

    const tilingBox = await tilingArea.boundingBox();
    const terminalBox = await terminalWindow.boundingBox();

    expect(tilingBox).not.toBeNull();
    expect(terminalBox).not.toBeNull();

    const tolerance = 2;
    expect(Math.abs(terminalBox!.x - tilingBox!.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(terminalBox!.y - tilingBox!.y)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(terminalBox!.width - tilingBox!.width)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(terminalBox!.height - tilingBox!.height)).toBeLessThanOrEqual(tolerance);
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

  test("stopped sessions appear dimmed in sidebar", async ({ page }) => {
    // Override aggregate sessions to include a stopped session
    await page.route("**/api/v1/sessions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            agents: [
              {
                agent_name: "mac-mini-1",
                sessions: [
                  MOCK_SESSIONS_AGENT1[0],
                  { ...MOCK_SESSIONS_AGENT1[1], state: "stopped" },
                ],
              },
              { agent_name: "mac-mini-2", sessions: MOCK_SESSIONS_AGENT2 },
            ],
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto("/agents");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // The stopped session should have the stopped class (dimmed)
    const sessions = page.getByTestId("sidebar-session");
    // Second session in mac-mini-1 group should show empty circle (non-running)
    await expect(sessions.nth(1)).toContainText("○");
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

  test("sidebar is expanded by default", async ({ page }) => {
    await page.goto("/agents");

    // Toggle button should be visible
    await expect(page.getByTestId("sidebar-toggle")).toBeVisible();

    // aria-expanded should be true (sidebar is expanded)
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "true");

    // Sidebar content (agents list) should be visible
    await expect(page.getByTestId("sidebar-agent")).toHaveCount(3);
  });

  test("click toggle collapses sidebar", async ({ page }) => {
    await page.goto("/agents");

    // Confirm expanded first
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("sidebar-agent")).toHaveCount(3);

    // Click the toggle to collapse
    await page.getByTestId("sidebar-toggle").click();

    // aria-expanded should now be false
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");

    // Content wrapper is aria-hidden; elements stay in DOM but are inaccessible
    await expect(page.getByTestId("session-list").locator('[aria-hidden="true"]')).toBeAttached();
  });

  test("click toggle again expands sidebar", async ({ page }) => {
    await page.goto("/agents");

    // Collapse
    await page.getByTestId("sidebar-toggle").click();
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("session-list").locator('[aria-hidden="true"]')).toBeAttached();

    // Expand again
    await page.getByTestId("sidebar-toggle").click();
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "true");

    // Session content should be visible again
    await expect(page.getByTestId("sidebar-agent")).toHaveCount(3);
    await expect(page.getByTestId("sidebar-session")).toHaveCount(3, { timeout: 15000 });

    // Verify session buttons are clickable after the collapse+expand cycle
    await page.getByTestId("sidebar-session").first().click();
    await expect(page.getByTestId("terminal-window")).toHaveCount(1);
  });

  test("collapsed state persists after navigating away and back", async ({ page }) => {
    await page.goto("/agents");

    // Sidebar should start expanded (normal state)
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "true");

    // Collapse the sidebar
    await page.getByTestId("sidebar-toggle").click();
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");

    // Navigate away to a different route
    await page.goto("/");

    // Navigate back to /agents
    await page.goto("/agents");

    // Sidebar should still be collapsed — localStorage persisted the state
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
  });
});

// ---------------------------------------------------------------------------
// Agent launch form — mock data
// ---------------------------------------------------------------------------

const LAUNCH_FORM_AGENTS = {
  agents: [
    {
      name: "test-agent",
      status: "online",
      profiles: {
        default: {
          description: "Default profile",
          repo: "test-org/test-repo",
        },
        fast: {
          description: "Fast profile",
          repo: "test-org/test-repo",
        },
      },
      last_seen: "2026-01-01T00:00:00Z",
    },
    {
      name: "offline-agent",
      status: "offline",
      profiles: {
        default: {
          description: "Default profile",
          repo: "test-org/test-repo",
        },
      },
      last_seen: "2025-12-01T00:00:00Z",
    },
  ],
};

const LAUNCHED_SESSION = {
  id: "new-session-1",
  name: "my-test-session",
  agent_profile: "default",
  state: "creating",
  created_at: "2026-01-01T01:00:00Z",
  agent_pid: 9999,
  repo_url: "test-org/test-repo",
  base_ref: "main",
};

function setupLaunchFormMocks(page: import("@playwright/test").Page) {
  return Promise.all([
    page.route("**/api/v1/agents", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(LAUNCH_FORM_AGENTS),
        });
      } else {
        route.continue();
      }
    }),
    // Aggregate sessions — start empty
    page.route("**/api/v1/sessions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ agents: [] }),
        });
      } else {
        route.continue();
      }
    }),
    // Mock projects so the selected project has a known repository for session filtering
    page.route("**/graphql", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { query?: string };
      if (typeof body.query === "string" && body.query.includes("Projects")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              projects: [
                { id: "e2e-test-project", name: "E2E Test Project", repository: "test-org/test-repo" },
              ],
            },
          }),
        });
      } else {
        route.continue();
      }
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Agent launch form tests
// ---------------------------------------------------------------------------

test.describe("agent launch form", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("cadence_project_id", "e2e-test-project");
    });
    await setupLaunchFormMocks(page);
  });

  test("form renders — host select, profile select, and name input are visible", async ({ page }) => {
    await page.goto("/agents");

    const form = page.getByTestId("agent-launch-form");
    await expect(form).toBeVisible();

    await expect(form.getByTestId("host-select")).toBeVisible();
    await expect(form.getByTestId("profile-select")).toBeVisible();
    await expect(form.getByTestId("name-input")).toBeVisible();
    await expect(form.getByTestId("launch-submit")).toBeVisible();
  });

  test("host select is populated with online agents; offline agents do not appear", async ({ page }) => {
    await page.goto("/agents");

    const hostSelect = page.getByTestId("host-select");
    await expect(hostSelect).toBeVisible();

    // Only "test-agent" (online) should appear as a selectable option
    const options = hostSelect.locator("option");
    // There is always a blank placeholder option plus the online agents
    const optionTexts = await options.allTextContents();
    expect(optionTexts).toContain("test-agent");
    expect(optionTexts).not.toContain("offline-agent");
  });

  test("profile select is disabled until a host is selected", async ({ page }) => {
    await page.goto("/agents");

    const profileSelect = page.getByTestId("profile-select");
    await expect(profileSelect).toBeDisabled();

    // After selecting a host it should become enabled
    await page.getByTestId("host-select").selectOption("test-agent");
    await expect(profileSelect).not.toBeDisabled();
  });

  test("profile select is populated with the selected host's profiles", async ({ page }) => {
    await page.goto("/agents");

    await page.getByTestId("host-select").selectOption("test-agent");

    const profileSelect = page.getByTestId("profile-select");
    await expect(profileSelect).not.toBeDisabled();

    const options = profileSelect.locator("option");
    const optionTexts = await options.allTextContents();
    expect(optionTexts).toContain("default");
    expect(optionTexts).toContain("fast");
  });

  test("submitting with empty fields shows a validation error and does not call the POST API", async ({ page }) => {
    let postCalled = false;

    await page.route("**/api/v1/agents/*/sessions", (route) => {
      if (route.request().method() === "POST") {
        postCalled = true;
        route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ session: LAUNCHED_SESSION }) });
      } else {
        route.continue();
      }
    });

    await page.goto("/agents");

    // Submit without filling any fields
    await page.getByTestId("launch-submit").click();

    // Validation error should appear
    const form = page.getByTestId("agent-launch-form");
    await expect(form).toContainText("Host, profile, and name are all required.");

    // POST must not have been called
    expect(postCalled).toBe(false);
  });

  test("successful launch calls POST with correct body and new session appears", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;

    // POST handler — capture body and return the new session
    await page.route("**/api/v1/agents/test-agent/sessions", async (route) => {
      if (route.request().method() === "POST") {
        capturedBody = JSON.parse(route.request().postData() ?? "{}");
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ session: LAUNCHED_SESSION }),
        });
      } else {
        route.continue();
      }
    });

    // After POST the aggregate sessions endpoint returns the new session
    await page.route("**/api/v1/sessions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            agents: [
              {
                agent_name: "test-agent",
                sessions: [LAUNCHED_SESSION],
              },
            ],
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto("/agents");

    await page.getByTestId("host-select").selectOption("test-agent");
    await page.getByTestId("profile-select").selectOption("default");
    await page.getByTestId("name-input").fill("my-test-session");

    await page.getByTestId("launch-submit").click();

    // Verify the POST body
    await expect.poll(() => capturedBody).not.toBeNull();
    expect(capturedBody!["agent_profile"]).toBe("default");
    expect(capturedBody!["session_name"]).toBe("my-test-session");

    // The new session should appear in the sidebar
    await expect(page.getByTestId("sidebar-session")).toHaveCount(1, { timeout: 15000 });
    await expect(page.getByTestId("session-list")).toContainText("my-test-session");
  });

  test("loading state — submit button shows 'Launching…' and is disabled while POST is in flight", async ({ page }) => {
    // Use a delayed route to keep the POST pending long enough to observe loading state
    await page.route("**/api/v1/agents/test-agent/sessions", async (route) => {
      if (route.request().method() === "POST") {
        // Delay fulfillment so we can inspect the button state
        await new Promise((resolve) => setTimeout(resolve, 1500));
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ session: LAUNCHED_SESSION }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto("/agents");

    await page.getByTestId("host-select").selectOption("test-agent");
    await page.getByTestId("profile-select").selectOption("default");
    await page.getByTestId("name-input").fill("my-test-session");

    // Click submit — do not await navigation, just observe in-flight state
    await page.getByTestId("launch-submit").click();

    const submitButton = page.getByTestId("launch-submit");
    await expect(submitButton).toHaveText("Launching…");
    await expect(submitButton).toBeDisabled();

    // Wait for the POST to complete and button to return to normal
    await expect(submitButton).toHaveText("Launch Session", { timeout: 5000 });
  });

  test("API error — shows error message when POST returns 500", async ({ page }) => {
    await page.route("**/api/v1/agents/test-agent/sessions", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "internal server error" }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto("/agents");

    await page.getByTestId("host-select").selectOption("test-agent");
    await page.getByTestId("profile-select").selectOption("default");
    await page.getByTestId("name-input").fill("my-test-session");

    await page.getByTestId("launch-submit").click();

    // An error message should appear inside the form — the component renders
    // the error string returned by hubFetch (the "error" field from the JSON body)
    const form = page.getByTestId("agent-launch-form");
    await expect(form).toContainText("internal server error", { timeout: 5000 });
  });
});
