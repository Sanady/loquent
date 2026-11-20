#!/usr/bin/env node
// Prove that release-please's `extra-files` entry bumps loquent's own version in uv.lock.
//
// Installs the release-please that the pinned release-please-action bundles into a temp dir,
// builds the GenericToml updater from the uv.lock entry in release-please-config.json, applies
// it to the real uv.lock with version 9.9.9, and asserts that exactly one line changed: the
// `version` line of the `[[package]] name = "loquent"` entry.
//
// release-please parses TOML into tagged scalars ({start, end, value}), so a jsonpath filter
// must compare `@.name.value`; `@.name=='loquent'` matches nothing and release-please only
// logs "No entries modified", leaving uv.lock stale. This check catches that.
//
// Usage: node scripts/check_release_lockfile.mjs   (exit 0 = pass, 1 = fail)

import { join } from "node:path";

import { fail, readJson, readText, silentLogger, withReleasePlease } from "./release_please_pin.mjs";

const TEST_VERSION = "9.9.9";

const pkg = readJson("release-please-config.json").packages?.["."];
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

await withReleasePlease(({ require, build, version, actionVersion }) => {
  const { GenericToml } = require(join(build, "updaters", "generic-toml.js"));
  const { Version } = require(join(build, "version.js"));

  const before = readText("uv.lock");
  const after = new GenericToml(entry.jsonpath, Version.parse(TEST_VERSION)).updateContent(
    before,
    silentLogger,
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
    `PASS: release-please ${version} (release-please-action ${actionVersion}) ` +
      `GenericToml(${entry.jsonpath}) changes only uv.lock line ${i + 1}: ` +
      `${oldLines[i]} -> ${newLines[i]}`,
  );
});
