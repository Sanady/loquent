import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { PORT, SHOT_PORT } from "./e2e/ports";

// The server runs the built UI from src/loquent/server/static: use `npm run e2e`, which
// builds first. Each run gets a fresh store and files dir under the OS temp dir (override
// with LOQUENT_E2E_DIR). Playwright workers re-read this file, so only the main process
// creates the directory; workers never start the server.
const dir = process.env.LOQUENT_E2E_DIR ?? (process.env.TEST_WORKER_INDEX === undefined ? mkdtempSync(join(tmpdir(), "loquent-e2e-")) : tmpdir());

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `uv run loquent serve e2e/fixtures/agent.py:agent --port ${PORT} --store sqlite:///${join(dir, "e2e.db")}`,
      env: { LOQUENT_FILES_DIR: join(dir, "files") },
      url: `http://127.0.0.1:${PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // The screenshot agent (tool steps, markdown, a widget, code, a failed run) for the
      // per-theme shots in themes.spec.ts, on its own port and store. Its stderr is ignored:
      // the failed run logs an expected traceback.
      command: `uv run loquent serve e2e/fixtures/shot_agent.py:agent --port ${SHOT_PORT} --store sqlite:///${join(dir, "shot.db")}`,
      env: { LOQUENT_FILES_DIR: join(dir, "shot-files"), LOQUENT_APP_NAME: "Support" },
      url: `http://127.0.0.1:${SHOT_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "ignore",
    },
  ],
});
