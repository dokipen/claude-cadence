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

    const cardSelector = '[data-testid="ticket-card"], .card';
    await page.waitForSelector(cardSelector, { timeout: 5000 }).catch(() => null);

    const cardBg = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? window.getComputedStyle(el).backgroundColor : null;
    }, cardSelector);

    // Only assert if cards are present on the board
    if (cardBg !== null) {
      expect(cardBg).toBe(DARK_SURFACE);
    }
  });

  test("dark mode live switch: switching from light to dark updates body background without reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("user-info")).toBeVisible();

    const lightBg = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    expect(lightBg).toBe(LIGHT_BG);

    await page.emulateMedia({ colorScheme: "dark" });

    const darkBg = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    expect(darkBg).toBe(DARK_BG);
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
