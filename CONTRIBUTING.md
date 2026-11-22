# Contributing to Loquent

Thanks for helping. Loquent is Apache-2.0 licensed; by contributing you agree your work is
released under the same license.

## Development setup

You need Python 3.11+, [uv](https://docs.astral.sh/uv/) and Node.js.

```bash
uv sync
npm --prefix frontend ci
```

Set `LOQUENT_SKIP_UI_BUILD=1` to build or install without running npm, for Python-only work.

## Running the test suites

```bash
uv run pytest -q -m "not slow"        # Python tests (Mongo contract tests need a server, see below)
uv run pytest -q -m slow              # builds the wheel and sdist and checks the metadata
npm --prefix frontend test -- --run   # frontend unit tests (vitest)
npm --prefix frontend run e2e         # builds the UI, then runs Playwright
```

The MongoDB contract tests need a real server, so running them locally needs Docker. Without
`LOQUENT_TEST_MONGO_URL` they are skipped locally (and fail under `CI`):

```bash
docker run -d -p 27017:27017 mongo:8.0
LOQUENT_TEST_MONGO_URL=mongodb://localhost:27017 uv run pytest -q -m mongo
```

Lint and format before you push; CI enforces both:

```bash
uv run ruff check
uv run ruff format --check .
```

## Pull requests

- Branch from `main` and open a PR against it.
- The PR title must follow Conventional Commits, because merges are squashed and the title becomes
  the commit message that release automation reads. Allowed types: `feat`, `fix`, `docs`,
  `chore`, `refactor`, `perf`, `test`, `build`, `ci`. Example: `fix: reject empty thread ids`.
- Only squash merges are enabled.
- Add or update tests with your change, and run the suites above.

## Maintainers

### Bumping `googleapis/release-please-action`

Dependabot opens these bumps in their own PR. The `release-config` CI job fails until
`ACTION_BUNDLES` in `scripts/release_please_pin.mjs` has a row for the new version.

1. Find the release-please version the new action bundles: open that tag's `package-lock.json` /
   `package.json` in `googleapis/release-please-action` and read the `release-please` dependency
   (the same file lists `jsonpath-plus` and `@iarna/toml`).
2. Add the row to `ACTION_BUNDLES`.
3. Push the row to the Dependabot branch.

### Releasing

1. Merging the release PR creates the tag and the GitHub Release.
2. Approve the `pypi` deployment.
3. Never set `"release-as"` in `release-please-config.json` again. It pinned the one-time 0.1.0
   bootstrap release and was removed after it shipped. While it is set, release-please proposes that
   exact version on every release, even when that version already exists.
4. Keep immutable releases off: `attach-assets` uploads after publish.

## Ignoring formatting-only commits in `git blame`

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```
