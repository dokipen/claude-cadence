import { test, expect } from "./fixtures/auth";
import { test as unauthTest, expect as unauthExpect } from "@playwright/test";

const LIGHT_BG = "rgb(250, 251, 252)";  // --bg light: #FAFBFC
const DARK_BG = "rgb(13, 17, 23)";      // --bg dark:  #0d1117
const DARK_SURFACE = "rgb(22, 27, 34)"; // --surface dark: #161b22

test.describe("dark mode (authenticated)", () => {
  test("light mode default: body has light --bg background-color", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("user-info")).toBeVisible();

    const bg = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    expect(bg).toBe(LIGHT_BG);
  });

  test("dark mode: body has dark --bg background-color", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.getByTestId("user-info")).toBeVisible();

    const bg = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    expect(bg).toBe(DARK_BG);
  });

  test("dark mode: ticket card has dark --surface background-color", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.getByTestId("user-info")).toBeVisible();

    const card = page.getByTestId("ticket-card").first();
    await expect(card).toBeVisible();

    const cardBg = await card.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );
    expect(cardBg).toBe(DARK_SURFACE);
  });

  test("dark mode live switch: switching from light to dark updates body background without reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("user-info")).toBeVisible();

    const lightBg = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    expect(lightBg).toBe(LIGHT_BG);

    await page.emulateMedia({ colorScheme: "dark" });

    await expect.poll(() =>
      page.evaluate(() => window.getComputedStyle(document.body).backgroundColor)
    ).toBe(DARK_BG);
  });
});

unauthTest.describe("dark mode (unauthenticated login page)", () => {
  unauthTest("login page dark mode: body has dark --bg background-color", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/login");
    await unauthExpect(page.locator("h1")).toHaveText("Cadence");

    const bg = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    unauthExpect(bg).toBe(DARK_BG);
  });
});
