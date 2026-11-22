import { expect, test, type Page } from "@playwright/test";

// Fixture agent: e2e/fixtures/agent.py.

async function send(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  // Send stays disabled until the previous run's stream has closed (store `busy`); Enter
  // before then keeps the draft and sends nothing, so wait like a user would.
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await box.press("Enter");
}

const log = (page: Page) => page.getByRole("log", { name: "Conversation" });
const threadButton = (page: Page, title: string) =>
  page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: title, exact: true });
// A 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

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
  await expect(page).toHaveURL(/#t=/);
  await page.reload();
  // No sidebar click: the open thread comes back from the URL hash.
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
  // No sidebar click: the open thread comes back from the URL hash.
  await expect(log(page).getByText("remember me")).toBeVisible();
  await expect(log(page).getByText("Hello from Loquent")).toBeVisible();
});

test("an image with no text gets a reply", async ({ page }) => {
  await page.locator("input[type=file]").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("list", { name: "Files to send" }).getByText("dot.png")).toBeVisible();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(log(page).getByText("Hello from Loquent")).toBeVisible();
  await expect(log(page).getByRole("button", { name: /dot\.png/ })).toBeVisible();
  await expect(page.locator(".lq-error")).toHaveCount(0);
  await expect(threadButton(page, "dot.png")).toBeVisible();
});

test("regenerate leaves exactly one assistant reply", async ({ page }) => {
  await send(page, "regen please");
  const first = log(page).getByText(/Reply #\d+/);
  await expect(first).toBeVisible();
  const before = await first.innerText();
  await log(page).getByRole("button", { name: "Regenerate response" }).click();
  await expect(log(page).getByText(before, { exact: true })).toHaveCount(0);
  await expect(log(page).getByText(/Reply #\d+/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(log(page).locator(".lq-msg-assistant")).toHaveCount(1);
  // And the stored thread agrees after a reload.
  await page.reload();
  await expect(log(page).getByText(/Reply #\d+/)).toBeVisible();
  await expect(log(page).locator(".lq-msg-assistant")).toHaveCount(1);
});
