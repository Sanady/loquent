// Shared by the release-please checks: the pinned release-please install, and the guard that
// keeps that pin in step with the release-please-action version used by release.yml.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// What each googleapis/release-please-action release bundles, from its package-lock.json.
// release-please-action v5.0.0 bundles release-please 17.6.0 (jsonpath-plus 10.3.0,
// @iarna/toml 3.0.0). When Dependabot bumps the action in release.yml, these checks fail until
// a row for the new version is added here.
const ACTION_BUNDLES = {
  "v5.0.0": { "release-please": "17.6.0", "jsonpath-plus": "10.3.0", "@iarna/toml": "3.0.0" },
};

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

export function readText(path) {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

export function readJson(path) {
  return JSON.parse(readText(path));
}

/** The bundle for the release-please-action version pinned in release.yml. */
export function pinnedBundle() {
  const workflow = readText(".github/workflows/release.yml");
  const pins = [
    ...workflow.matchAll(/googleapis\/release-please-action@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)/g),
  ];
  if (pins.length !== 1) {
    fail(`expected one pinned googleapis/release-please-action in release.yml, found ${pins.length}`);
  }
  const actionVersion = pins[0][2];
  const bundle = ACTION_BUNDLES[actionVersion];
  if (!bundle) {
    fail(
      `release.yml pins release-please-action ${actionVersion}, which has no ACTION_BUNDLES row ` +
        "in scripts/release_please_pin.mjs; add the release-please version it bundles",
    );
  }
  return { actionVersion, ...bundle };
}

/** Install the pinned release-please into a temp dir and pass its build/src dir to fn. */
export async function withReleasePlease(fn) {
  const bundle = pinnedBundle();
  const { "release-please": version, actionVersion, ...overrides } = bundle;
  const tmp = mkdtempSync(join(tmpdir(), "release-please-check-"));
  try {
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ private: true, dependencies: { "release-please": version }, overrides }),
    );
    execFileSync(
      "npm",
      ["install", "--prefix", tmp, "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const require = createRequire(join(tmp, "package.json"));
    const build = join(tmp, "node_modules", "release-please", "build", "src");
    return await fn({ require, build, version, actionVersion });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export const silentLogger = {
  warn() {},
  info() {},
  debug() {},
  error() {},
  trace() {},
  child() {
    return silentLogger;
  },
};
