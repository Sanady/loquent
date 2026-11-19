import { expect, test, type Page } from "@playwright/test";

// Fixture agent: e2e/fixtures/agent.py.

async function send(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await box.press("Enter");
}

const log = (page: Page) => page.getByRole("log", { name: "Conversation" });
const threadButton = (page: Page, title: string) =>
  page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: title, exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
});

test("streams a reply", async ({ page }) => {
  await send(page, "hi");
  await expect(log(page).getByText("Hello from Loquent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});

test("confirm widget round trip", async ({ page }) => {
  await send(page, "refund");
  await expect(log(page).getByText("Refund $42?")).toBeVisible();
  await log(page).getByRole("button", { name: "Approve" }).click();
  await expect(log(page).getByText("Refunded.")).toBeVisible();
  await expect(log(page).getByText("Approved")).toBeVisible();
});

test("stop", async ({ page }) => {
  await send(page, "slow stop");
  await expect(log(page).getByText(/part1 /)).toBeVisible();
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(log(page).getByText("Stopped")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  // The run really ended: the rest of the reply never arrives.
  await page.waitForTimeout(2500);
  await expect(log(page).getByText(/Slow reply complete/)).toHaveCount(0);
});

test("reload mid-stream recovers", async ({ page }) => {
  await send(page, "slow reload");
  await expect(log(page).getByText(/part1 /)).toBeVisible();
  await page.reload();
  await threadButton(page, "slow reload").click();
  await expect(log(page).getByText(/Slow reply complete\./)).toBeVisible({ timeout: 10_000 });
  // Every part arrived exactly once, in order.
  const text = await log(page).innerText();
  const parts = Array.from({ length: 20 }, (_, i) => `part${i + 1} `).join("");
  expect(text.replace(/\s+/g, " ")).toContain(`${parts}Slow reply complete.`);
});

test("thread persists after reload", async ({ page }) => {
  await send(page, "remember me");
  await expect(log(page).getByText("Hello from Loquent")).toBeVisible();
  await page.reload();
  await threadButton(page, "remember me").click();
  await expect(log(page).getByText("remember me")).toBeVisible();
  await expect(log(page).getByText("Hello from Loquent")).toBeVisible();
});
