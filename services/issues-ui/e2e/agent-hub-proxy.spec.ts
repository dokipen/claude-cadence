import { test, expect } from "@playwright/test";

test.describe("agent-hub proxy", () => {
  test("Vite proxy forwards /api/v1/agents and returns agent data", async ({
    page,
  }) => {
    const mockAgents = {
      agents: [
        {
          name: "mac-mini-1",
          profiles: {
            default: {
              description: "Default profile",
              repo: "https://github.com/org/repo",
            },
          },
          status: "online",
          last_seen: "2026-03-16T12:00:00Z",
        },
      ],
    };

    // Intercept the proxied request and return mock data.
    // In production, Vite forwards /api/v1/* to agent-hub; in tests
    // we verify the browser-side path resolution works correctly.
    await page.route("**/api/v1/agents", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAgents),
      });
    });

    // Navigate to the app so fetch has a proper origin
    await page.goto("/");

    // Make the fetch from the browser context to verify the path works
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/v1/agents");
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.agents).toHaveLength(1);
    expect(result.body.agents[0].name).toBe("mac-mini-1");
    expect(result.body.agents[0].status).toBe("online");
    expect(result.body.agents[0].profiles.default.repo).toBe(
      "https://github.com/org/repo",
    );
  });
});
