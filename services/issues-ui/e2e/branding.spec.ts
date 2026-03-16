import { test, expect } from "./fixtures/auth";
import { test as unauthTest, expect as unauthExpect } from "@playwright/test";

// Brand spec for the small horizontal lockup (used in app header):
//   icon:               24×24px
//   wordmark font-size: 1rem (16px)
//   wordmark margin-top: 3px (optical baseline correction)
//   wordmark line-height: 1
//
// Brand spec for the vertical lockup (used on login page):
//   icon:                64×64px
//   wordmark margin-top: -2px  (optical baseline correction)
//   wordmark margin-left: -6px (optical indent correction)

test.describe("app header lockup (authenticated)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("user-info")).toBeVisible();
  });

  test("header icon is 24×24px", async ({ page }) => {
    const { width, height } = await page
      .locator("header img[alt='']")
      .first()
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
    expect(width).toBe(24);
    expect(height).toBe(24);
  });

  test("header wordmark font-size is 1rem (16px)", async ({ page }) => {
    const fontSize = await page
      .locator("header .logoText, header [class*='logoText']")
      .first()
      .evaluate((el) => {
        return window.getComputedStyle(el).fontSize;
      });
    // 1rem at default browser base (16px) = "16px"
    expect(fontSize).toBe("16px");
  });

  test("header wordmark has margin-top of 3px", async ({ page }) => {
    const marginTop = await page
      .locator("header .logoText, header [class*='logoText']")
      .first()
      .evaluate((el) => {
        return window.getComputedStyle(el).marginTop;
      });
    expect(marginTop).toBe("3px");
  });

  test("header wordmark has line-height of 1", async ({ page }) => {
    // Brand spec: lockup wordmark line-height is 1.
    const { lineHeight, fontSize } = await page
      .locator("header .logoText, header [class*='logoText']")
      .first()
      .evaluate((el) => {
        const style = window.getComputedStyle(el);
        return { lineHeight: style.lineHeight, fontSize: style.fontSize };
      });
    // line-height: 1 means lineHeight === fontSize (both in px)
    expect(lineHeight).toBe(fontSize);
  });

  test("header lockup container (headerLeft) has gap of 0px between icon and wordmark", async ({ page }) => {
    // Brand spec: icon and wordmark should sit flush together with no gap.
    // Bug: .headerLeft currently has gap: 0.5rem (8px), which violates the spec.
    const gap = await page
      .locator("header [class*='headerLeft']")
      .first()
      .evaluate((el) => {
        return window.getComputedStyle(el).gap;
      });
    expect(gap).toBe("0px");
  });
  test("header logo links to home", async ({ page }) => {
    const logoLink = page.locator("header a[href='/']");
    await expect(logoLink).toBeVisible();
    await expect(logoLink).toHaveAttribute("href", "/");
  });
});

unauthTest.describe("login page lockup (unauthenticated)", () => {
  unauthTest.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await unauthExpect(page.locator("h1")).toHaveText("Cadence");
  });

  unauthTest("login page icon renders at 64×64px", async ({ page }) => {
    const { width, height } = await page
      .locator('img[src="/cadence-icon.svg"]')
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
    unauthExpect(width).toBe(64);
    unauthExpect(height).toBe(64);
  });

  unauthTest("login page wordmark (h1) has margin-top of -2px for optical correction", async ({ page }) => {
    const marginTop = await page.locator("h1").evaluate((el) => {
      return window.getComputedStyle(el).marginTop;
    });
    unauthExpect(marginTop).toBe("-2px");
  });

  unauthTest("login page wordmark (h1) has margin-left of -6px for optical correction", async ({ page }) => {
    const marginLeft = await page.locator("h1").evaluate((el) => {
      return window.getComputedStyle(el).marginLeft;
    });
    unauthExpect(marginLeft).toBe("-6px");
  });
});
