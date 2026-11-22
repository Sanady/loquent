import { expect, test, type Page } from "@playwright/test";
import { SHOT_PORT } from "./ports";
import { THEME_TOKENS, THEMES } from "../src/themes";

// One run per theme via the `?theme=` preview param, against the screenshot agent
// (e2e/fixtures/shot_agent.py), so each shot shows the redesigned conversation: a tool step,
// markdown with inline code and a Confirm widget; then a code block, and a failed run (a
// stopped tool row and an error). Screenshots go to test-results/themes/ (gitignored; a CI
// artifact for visual review only).
test.use({ baseURL: `http://127.0.0.1:${SHOT_PORT}` });

const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function send(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await box.press("Enter");
}

async function shot(page: Page, path: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0); // no hover styles in the shot
  await page.waitForTimeout(500); // let the drawer, layout and entry transitions settle
  await page.screenshot({ path });
}

// Relies on the default `themes` setting allowing all four themes.
for (const id of THEMES) {
  test(`theme ${id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} ${m.location().url}`));
    page.on("pageerror", (e) => errors.push(e.message));

    // Start from an empty thread list so earlier tests do not show in the screenshots.
    const list = await page.request.get("/api/threads");
    for (const t of await list.json()) await page.request.delete(`/api/threads/${t.id}`, { headers: { "X-Loquent-CSRF": "1" } });
    await page.setViewportSize({ width: SIZES[0].width, height: SIZES[0].height });
    await page.goto(`/?theme=${id}`);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-lq-theme", id);
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--lq-bg").trim());
    expect(bg).toBe(THEME_TOKENS[id].bg);
    const log = page.getByRole("log", { name: "Conversation" });

    // The conversation: tool pill, markdown with inline code, then a Confirm widget.
    await send(page, "Hi there! I think I was billed twice for order #1042.");
    await expect(log.getByText("I can refund the duplicate for you.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await expect(log.locator('[data-lq-part~="activity-tool"]')).toHaveAttribute("data-lq-state", "done");
    await expect(log.locator('[data-lq-part~="markdown"] code').first()).toBeVisible();
    await send(page, "Yes, please refund the duplicate.");
    await expect(log.getByRole("button", { name: "Approve" })).toBeVisible();

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await shot(page, `test-results/themes/${id}-${size.name}.png`);
    }

    // A second chat: a code block, then a run that fails mid tool call (taller, so both fit).
    await page.setViewportSize({ width: SIZES[0].width, height: 960 });
    await page.goto(`/?theme=${id}`);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await send(page, "Show me a snippet for retrying a call.");
    await expect(log.locator('[data-lq-part~="code-block"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await send(page, "Now sync the ledger (this will crash).");
    await expect(log.locator('[data-lq-part~="error"]')).toBeVisible();
    await expect(log.locator('[data-lq-part~="activity-tool"]')).toHaveAttribute("data-lq-state", "stopped");
    await shot(page, `test-results/themes/${id}-code-error.png`);

    expect(errors).toEqual([]);
  });
}
