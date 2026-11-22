import { expect, test } from "@playwright/test";
import { THEME_TOKENS, THEMES } from "../src/themes";

// One run per theme via the `?theme=` preview param. Screenshots go to test-results/themes/
// (gitignored; a CI artifact for visual review only).
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const id of THEMES) {
  test(`theme ${id}`, async ({ page }) => {
    const errors: string[] = [];
    // The page always links branding/custom.css; the server answers 404 when none is configured,
    // which Chromium logs as a console error. Known and unrelated to themes, so it is skipped.
    const known = /branding\/custom\.css/;
    page.on("console", (m) => m.type() === "error" && !known.test(m.text()) && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));

    await page.setViewportSize({ width: SIZES[0].width, height: SIZES[0].height });
    await page.goto(`/?theme=${id}`);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-lq-theme", id);
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--lq-bg").trim());
    expect(bg).toBe(THEME_TOKENS[id].bg);

    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("hi");
    await box.press("Enter");
    await expect(page.getByRole("log", { name: "Conversation" }).getByText("Hello from Loquent")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500); // let the drawer and layout transitions settle
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `test-results/themes/${id}-${size.name}.png` });
    }
    expect(errors).toEqual([]);
  });
}
