// Takes the README screenshot: docs/assets/loquent-chat.png (1280x800, graphite theme).
//
// Run with `npm run screenshot` after `npm run build`. Like the e2e tests (see
// playwright.config.ts) it serves the fixture agent, e2e/fixtures/shot_agent.py, from the built
// UI with a fresh store under the OS temp dir. Not part of CI.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(frontend, "..", "docs", "assets", "loquent-chat.png");
const PORT = 8766;
const base = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "loquent-shot-"));

const server = spawn(
  "uv",
  ["run", "loquent", "serve", "e2e/fixtures/shot_agent.py:agent", "--port", String(PORT), "--store", `sqlite:///${join(dir, "shot.db")}`],
  {
    cwd: frontend,
    env: { ...process.env, LOQUENT_FILES_DIR: join(dir, "files"), LOQUENT_APP_NAME: "Support" },
    stdio: ["ignore", "ignore", "inherit"],
  },
);

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start within 60 s");
}

async function send(page, text) {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await box.press("Enter");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  await page.goto(`${base}/?theme=graphite`);
  const log = page.getByRole("log", { name: "Conversation" });

  await send(page, "Hi there! I think I was billed twice for order #1042.");
  await log.getByText("I can refund the duplicate for you.").waitFor();
  await page.getByRole("button", { name: "Send message" }).waitFor();

  await send(page, "Yes, please refund the duplicate.");
  await log.getByRole("button", { name: "Approve" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0); // no hover styles in the shot
  await page.waitForTimeout(500); // let entry animations settle

  await page.screenshot({ path: out });
  console.log(`wrote ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
} finally {
  await browser?.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
