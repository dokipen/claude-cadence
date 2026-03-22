import { test, expect } from "./fixtures/auth";

const MOCK_DOC_FILES = {
  files: [
    { path: "getting-started.md", name: "Getting Started" },
    { path: "api-reference.md", name: "API Reference" },
  ],
};

const MOCK_DOC_CONTENT: Record<string, { path: string; content: string }> = {
  "getting-started.md": {
    path: "getting-started.md",
    content: "# Getting Started\n\nWelcome to the documentation.",
  },
  "api-reference.md": {
    path: "api-reference.md",
    content: "# API Reference\n\nEndpoints and schemas.",
  },
};

function setupDocsMocks(page: import("@playwright/test").Page) {
  return Promise.all([
    page.route("**/api/v1/docs", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_DOC_FILES),
        });
      } else {
        route.continue();
      }
    }),
    page.route("**/api/v1/docs/**", (route) => {
      if (route.request().method() === "GET") {
        const url = route.request().url();
        const fileName = url.split("/api/v1/docs/").pop() ?? "";
        const doc = MOCK_DOC_CONTENT[fileName] ?? MOCK_DOC_CONTENT["getting-started.md"];
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(doc),
        });
      } else {
        route.continue();
      }
    }),
  ]);
}

test.describe("docs page", () => {
  test.beforeEach(async ({ page }) => {
    await setupDocsMocks(page);
  });

  test("nav link navigates to /docs", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("docs-nav-link").click();
    await expect(page).toHaveURL("/docs");
  });

  test("docs page loads and shows Documents header", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByText("Documents")).toBeVisible();
  });

  test("docs page lists files from API in sidebar", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByText("getting-started.md")).toBeVisible();
    await expect(page.getByText("api-reference.md")).toBeVisible();
  });

  test("shows empty state before a file is selected", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByText("Select a document to preview")).toBeVisible();
  });

  test("clicking a file renders its specific content", async ({ page }) => {
    await page.goto("/docs");

    await page.getByText("getting-started.md").click();
    await expect(page.getByText("Getting Started")).toBeVisible();
    await expect(page.getByText("Welcome to the documentation.")).toBeVisible();

    await page.getByText("api-reference.md").click();
    await expect(page.getByText("API Reference")).toBeVisible();
    await expect(page.getByText("Endpoints and schemas.")).toBeVisible();
  });

  test("shows error when API is unavailable", async ({ page }) => {
    await page.route("**/api/v1/docs", (route) => {
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
    });
    await page.goto("/docs");
    await expect(page.getByText("Failed to fetch documents")).toBeVisible();
  });

  test("clicking a file updates the URL to /docs/<file-path>", async ({ page }) => {
    await page.goto("/docs");
    await page.getByText("getting-started.md").click();
    await expect(page).toHaveURL(/\/docs\/getting-started\.md$/);
  });

  test("navigating directly to /docs/<file-path> renders the file content", async ({ page }) => {
    await page.goto("/docs/api-reference.md");
    await expect(page.getByText("API Reference")).toBeVisible();
    await expect(page.getByText("Endpoints and schemas.")).toBeVisible();
  });

  test("back navigation restores the previously selected file", async ({ page }) => {
    await page.goto("/docs");
    await page.getByText("getting-started.md").click();
    await expect(page.getByText("Welcome to the documentation.")).toBeVisible();
    await page.getByText("api-reference.md").click();
    await expect(page.getByText("Endpoints and schemas.")).toBeVisible();
    await page.goBack();
    await expect(page.getByText("Welcome to the documentation.")).toBeVisible();
  });
});
