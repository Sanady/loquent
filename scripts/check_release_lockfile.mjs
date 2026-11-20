#!/usr/bin/env node
// Prove that release-please's `extra-files` entry bumps loquent's own version in uv.lock.
//
// Installs a pinned release-please into a temp dir, builds the GenericToml updater from the
// uv.lock entry in release-please-config.json, applies it to the real uv.lock with version
// 9.9.9, and asserts that exactly one line changed: the `version` line of the
// `[[package]] name = "loquent"` entry.
//
// release-please parses TOML into tagged scalars ({start, end, value}), so a jsonpath filter
// must compare `@.name.value`; `@.name=='loquent'` matches nothing and release-please only
// logs "No entries modified", leaving uv.lock stale. This check catches that.
//
// Usage: node scripts/check_release_lockfile.mjs   (exit 0 = pass, 1 = fail)

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep in step with what the pinned googleapis/release-please-action in
// .github/workflows/release.yml bundles: v5.0.0 ships release-please 17.6.0 with
// jsonpath-plus 10.3.0 and @iarna/toml 3.0.0 (see its package-lock.json).
const RELEASE_PLEASE_VERSION = "17.6.0";
const OVERRIDES = { "jsonpath-plus": "10.3.0", "@iarna/toml": "3.0.0" };
const TEST_VERSION = "9.9.9";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

const config = readJson("release-please-config.json");
const pkg = config.packages?.["."];
if (!pkg) fail('release-please-config.json has no packages["."] entry');

const extraFiles = (pkg["extra-files"] ?? []).filter(
  (f) => typeof f === "object" && f.path === "uv.lock",
);
if (extraFiles.length !== 1) {
  fail(`expected exactly one extra-files entry for uv.lock, found ${extraFiles.length}`);
}
const [entry] = extraFiles;
if (entry.type !== "toml") fail(`uv.lock extra-files entry has type ${entry.type}, want toml`);
if (!entry.jsonpath) fail("uv.lock extra-files entry has no jsonpath");

const tmp = mkdtempSync(join(tmpdir(), "release-please-check-"));
try {
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: { "release-please": RELEASE_PLEASE_VERSION },
      overrides: OVERRIDES,
    }),
  );
  execFileSync(
    "npm",
    ["install", "--prefix", tmp, "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const require = createRequire(join(tmp, "package.json"));
  const build = join(tmp, "node_modules", "release-please", "build", "src");
  const { GenericToml } = require(join(build, "updaters", "generic-toml.js"));
  const { Version } = require(join(build, "version.js"));

  const before = readFileSync(join(root, "uv.lock"), "utf8");
  const silent = { warn() {}, info() {}, debug() {}, error() {}, trace() {} };
  const after = new GenericToml(entry.jsonpath, Version.parse(TEST_VERSION)).updateContent(
    before,
    silent,
  );

  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  if (oldLines.length !== newLines.length) {
    fail(`line count changed: ${oldLines.length} -> ${newLines.length}`);
  }
  const changed = oldLines.flatMap((line, i) => (line === newLines[i] ? [] : [i]));
  if (changed.length !== 1) {
    fail(`expected exactly 1 changed line, got ${changed.length} (jsonpath ${entry.jsonpath})`);
  }

  const [i] = changed;
  const header = oldLines.slice(i - 2, i).join("\n");
  if (header !== '[[package]]\nname = "loquent"') {
    fail(`changed line ${i + 1} is not in the loquent [[package]] entry:\n${header}`);
  }
  if (!/^version = "[^"]+"$/.test(oldLines[i])) fail(`changed line was ${oldLines[i]}`);
  if (newLines[i] !== `version = "${TEST_VERSION}"`) fail(`new line is ${newLines[i]}`);

  console.log(
    `PASS: release-please ${RELEASE_PLEASE_VERSION} GenericToml(${entry.jsonpath}) ` +
      `changes only uv.lock line ${i + 1}: ${oldLines[i]} -> ${newLines[i]}`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
