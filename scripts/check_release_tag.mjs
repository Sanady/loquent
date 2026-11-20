#!/usr/bin/env node
// Prove that the first release is tagged exactly v0.1.0 and its PR is titled "release 0.1.0".
//
// Builds the Manifest from the real release-please-config.json and .release-please-manifest.json
// with the release-please that the pinned release-please-action bundles, serving files from
// this checkout instead of the GitHub API. It then asks the root strategy for the release PR
// that a single feat commit produces, and feeds that PR back as merged to get the release.
// Asserts:
//   - the release PR is for 0.1.0 and its title contains "release 0.1.0" but not "loquent"
//   - the release tag is exactly v0.1.0
//
// Without "include-component-in-tag": false, release-please 17 adds package-name to both,
// giving tag loquent-v0.1.0 and title "release loquent 0.1.0". release.yml's build job would
// only notice after the GitHub release and tag already existed.
//
// Usage: node scripts/check_release_tag.mjs   (exit 0 = pass, 1 = fail)

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fail, readJson, root, silentLogger, withReleasePlease } from "./release_please_pin.mjs";

const EXPECTED_VERSION = "0.1.0";
const EXPECTED_TAG = `v${EXPECTED_VERSION}`;
const BRANCH = "main";

await withReleasePlease(async ({ require, build, version, actionVersion }) => {
  const { Manifest } = require(join(build, "manifest.js"));
  const { parseConventionalCommits } = require(join(build, "commit.js"));
  const { setLogger } = require(join(build, "util", "logger.js"));
  setLogger(silentLogger);

  const { FileNotFoundError } = require(join(build, "errors", "index.js"));
  const github = {
    repository: { owner: "Sanady", repo: "loquent", defaultBranch: BRANCH },
    async getFileJson(path) {
      return readJson(path);
    },
    async getFileContentsOnBranch(path) {
      try {
        const parsedContent = readFileSync(join(root, path), "utf8");
        return { parsedContent, content: Buffer.from(parsedContent).toString("base64") };
      } catch {
        throw new FileNotFoundError(path);
      }
    },
    async findFilesByFilenameAndRef() {
      return [];
    },
    async findFilesByGlobAndRef() {
      return [];
    },
  };

  const manifest = await Manifest.fromManifest(
    github,
    BRANCH,
    "release-please-config.json",
    ".release-please-manifest.json",
  );
  const strategy = (await manifest.getStrategiesByPath())["."];
  if (!strategy) fail('no release-please strategy for path "."');

  const commits = parseConventionalCommits(
    [{ sha: "a".repeat(40), message: "feat: first public release", files: ["README.md"] }],
    silentLogger,
  );
  const pr = await strategy.buildReleasePullRequest(commits, undefined);
  if (!pr) fail("release-please proposed no release PR for a feat commit");

  const title = pr.title.toString();
  const errors = [];
  if (pr.version?.toString() !== EXPECTED_VERSION) {
    errors.push(`release PR version is ${pr.version}, want ${EXPECTED_VERSION}`);
  }
  if (!title.includes(`release ${EXPECTED_VERSION}`) || title.includes("loquent")) {
    errors.push(`release PR title is "${title}", want "release ${EXPECTED_VERSION}" without "loquent"`);
  }

  const release = await strategy.buildRelease({
    title,
    body: pr.body.toString(),
    headBranchName: pr.headRefName,
    baseBranchName: BRANCH,
    sha: "b".repeat(40),
    number: 1,
    labels: pr.labels,
    files: [],
  });
  const tag = release?.tag?.toString();
  if (tag !== EXPECTED_TAG) errors.push(`release tag is ${tag}, want ${EXPECTED_TAG}`);

  if (errors.length) fail(errors.join("\n      "));
  console.log(
    `PASS: release-please ${version} (release-please-action ${actionVersion}) proposes ` +
      `"${title}" on ${pr.headRefName} and tags ${tag}`,
  );
});
