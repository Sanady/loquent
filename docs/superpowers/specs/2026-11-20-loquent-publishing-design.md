# Loquent: publishing to GitHub, CI/CD and SEO README design

Date: 2026-11-20. This design builds on the release 1 spec (`2026-11-18-loquent-design.md`). Release 1 is
finished at `feat/release-1` fa5884f. Results at that commit:

| Check | Result |
|---|---|
| pytest | 339 passed |
| vitest | 154 passed |
| e2e | 7/7 |
| Final review | clean |

## Intent

Make Loquent public and keep it healthy.

- **Repository.** Push the work to the public repo `https://github.com/Sanady/loquent`, which is currently empty.
- **README.** Write it so people searching for a Chainlit replacement, or for a chat UI for their LLM or agent app, find it and understand it in seconds.
- **CI/CD.** Every change is tested automatically, and releases reach PyPI with as little manual work as possible.

The owner chose release-please for releases, Apache-2.0 for the license, a manual approval before each PyPI publish, and
three target audiences (below).

## Goals

- `main` on GitHub holds release 1 plus everything in this design. Every later change goes through a PR with a required green CI check.
- The README ranks for and converts three audiences:
  1. Chainlit users looking for a successor. Chainlit was archived on 2026-10-15.
  2. Python developers building agents (LangGraph, Pydantic AI, OpenAI Agents SDK, AG-UI).
  3. Teams self-hosting LLMs (Ollama, vLLM, OpenAI-compatible servers) who need security and multi-replica deploys.
- Releases are cut by merging a release-please PR. The version, CHANGELOG, tag and GitHub Release are automatic. The PyPI upload waits for the owner's approval and uses Trusted Publishing, so no long-lived secret is stored.
- The PyPI name `loquent` is free as of 2026-11-20 and is claimed by publishing 0.1.0 soon after the push.

## Non-goals

- Docs website, Docker images, conda-forge, nightly builds.
- New product features. The only code changes are the three small pre-push fixes in "Pre-push hardening".

## Anti-goals

- A README that overclaims: any feature, flag or setting that doesn't exist.
- A README that names Chainlit in a way that reads as affiliation or uses its branding. We say "alternative to"/"successor for", factually.
- Secrets in the repo or in workflow files (PyPI tokens, PATs).
- A release path that can publish without the owner's approval.
- Rewriting existing git history. The pre-conventional commits stay as they are.

## Constraints

- **Build.** Uses hatchling with the `hatch_build.py` hook. A wheel build runs `npm ci && npm run build`, and `LOQUENT_SKIP_UI_BUILD=1` skips it. `uv build` builds the sdist, then the wheel from the sdist. Python is `>=3.11`, with a dev pin of 3.12. `uv.lock` records the project's own version (`[[package]] name = "loquent" version = "0.1.0"`), and `uv sync --locked` fails if it is stale.
- **Mongo tests.** `tests/store/conftest.py` uses `LOQUENT_TEST_MONGO_URL` when it is set. Otherwise it uses pymongo-inmemory, which means mongod 4.0 and a dev-pinned `pymongo<4.10`.
- **Formatting.** `ruff format --check` would currently reformat 13 files.
- **Package metadata.** `pyproject.toml` has no license, classifiers, keywords or `[project.urls]`. There is no LICENSE file, and the sdist `include` list is explicit.
- **GitHub CLI.** `gh` is installed but not logged in. The owner must run `gh auth login` before anything is pushed.
- **release-please limits.** It does not update `uv.lock`. A tag or PR created with `GITHUB_TOKEN` triggers no other workflows. It needs conventional commits.

## Approaches considered

**Release mechanism.**

1. Tag-triggered release: bump the version in a PR, then push a tag. CI re-runs on that commit and publishes after approval.
   - This was the recommendation: it has the fewest moving parts and needs no bot token.
2. **release-please (chosen by the owner).** A bot maintains a release PR, built from conventional commits, that bumps the version and the CHANGELOG. Merging that PR creates the tag and the GitHub Release, and the same workflow run then publishes to PyPI.
   - It brings an automatic CHANGELOG and versioning.
   - It costs a bot token, conventional-commit discipline, and a lockfile workaround.
3. A manual `workflow_dispatch` release.
   - Rejected: the version bump is never reviewed, and a failure can leave a half-finished release.

**PyPI auth.** Trusted Publishing (OIDC) behind a `pypi` environment with a required reviewer. Chosen over an API token, because it stores no secret and attaches attestations.

**CI shape.** One `ci.yml` that ends in a single aggregate `ci-ok` job, which is the only required check. Chosen over split workflows, because a required check can't go "missing" on a PR.

## Decided design

### 1. Pre-push hardening (carried from the release 1 final review, ruling R31)

- `auth.is_loopback` accepts the literal host `"testclient"`, so Starlette's `TestClient` works in auth `none`. Add a test. The README's loopback paragraph should say that TestClient is treated as local.
- `store.ts` `restoreThread` also skips while `starting` is true. Add a vitest test.
- Select options accept two-item lists `["value", "label"]`, both in `ui.Select` construction / `_option_values` and in the client's `parseOptions`. Add tests on both sides.

### 2. Repository metadata and license

- A `LICENSE` file with the Apache-2.0 text, holder "The Loquent authors".
- Add `NOTICE` only if needed. Apache-2.0 doesn't require it for a new project; the builder decides.
- `pyproject.toml`:
  - `license = "Apache-2.0"` and `license-files = ["LICENSE"]`
  - `description` rewritten for search, e.g. "Chat UI for any LLM or AI agent in a few lines of Python. AG-UI native, Chainlit alternative."
  - `keywords`: chat ui, llm, ai agent, chatbot, ag-ui, chainlit alternative, langgraph, openai, ollama, streaming, fastapi
  - `classifiers`: Development Status :: 3 - Alpha; Python 3.11, 3.12, 3.13; Framework :: FastAPI; Framework :: AsyncIO; License :: OSI Approved :: Apache Software License; Topic :: Scientific/Engineering :: Artificial Intelligence; Topic :: Software Development :: User Interfaces
  - `[project.urls]`: Homepage, Source and Issues on the GitHub repo; Changelog points to `CHANGELOG.md`.
  - Add `/LICENSE` and `/CHANGELOG.md` to the sdist `include` list.
- Community files: `CONTRIBUTING.md` (dev setup with uv and npm, how to run each suite, the conventional-commit PR title rule, squash merges), `SECURITY.md` (private vulnerability reporting), `.github/ISSUE_TEMPLATE/` (bug and feature forms), `.github/pull_request_template.md`, and `.git-blame-ignore-revs`.
- GitHub "About" metadata (description, website, topics) can only be set through the API. The builder writes the exact `gh repo edit` command into the handoff, and it runs after the owner logs in. Topics: `chat-ui, llm, ai-agents, chatbot, ag-ui, chainlit, chainlit-alternative, python, react, fastapi, starlette, ollama, openai, langgraph, streaming, self-hosted`.

### 3. README (SEO and conversion)

The README is rewritten around the three audiences. Every existing accurate section is kept, including the full settings table and the Extending, Security and Deployment sections. Requirements:

- **Top of the page.** An H1 of "Loquent", then a one-line tagline containing the main search phrase, e.g. "**Chat UI for any LLM or AI agent, in a few lines of Python.**" Then badges (CI, PyPI version, Python versions, License; the PyPI badges render once 0.1.0 is published). Then a 2–3 sentence pitch that names AG-UI and says "an open-source alternative to Chainlit".
- **Screenshot.** A screenshot or GIF of the chat UI under the pitch. It is committed to `docs/assets/`, taken with Playwright against the e2e fixture agent (light theme, desktop width, showing streaming text, a tool row and a confirm widget), and has descriptive alt text.
- **"Why Loquent" bullets.** No lock-in (AG-UI, your code doesn't import Loquent); the agent can draw UI (confirm/select/form); production defaults (stateless, multi-replica, security); no Node needed.
- **Quickstart.** The current three entry forms, unchanged, because they are accurate.
- **"Coming from Chainlit?" section.** It explains the concept mapping honestly:
  - `@cl.on_message` → a plain async generator
  - `cl.Step` → AG-UI step events, or nothing
  - `cl.AskUserMessage` / `AskActionMessage` → `ui.ask(Confirm/Select/Form)`
  - data layer → `LOQUENT_STORE_URL`
  - auth callbacks → `--auth password` / custom `authenticator`

  It also lists what release 1 does not have yet (OAuth, Postgres, framework adapters). Every Loquent claim in it must be true in the code.
- **"Use with your stack" section.** Short subsections with one working snippet each: OpenAI / any OpenAI-compatible URL; Ollama (`http://localhost:11434/v1`, with a note on `--no-widgets` for models without tools); vLLM; any AG-UI agent (LangGraph, Pydantic AI and others through their AG-UI adapters); a plain Python function.
- **Comparison table.** Loquent vs Chainlit (archived) vs Gradio ChatInterface vs Open WebUI. Rows: install, agent-drawn UI, AG-UI, multi-replica, self-hosted auth, maintenance status. Claims about other projects must be factual and conservative. Use "—" when unsure.
- **FAQ.** Its questions are phrased the way people search, e.g. "How do I add a chat UI to my LangGraph agent?", "Is Loquent a Chainlit replacement?", "Does it work with Ollama?", "Can I deploy it with multiple replicas?"
- **SEO hygiene.** Descriptive headings that include keywords naturally (no stuffing), relative links, and alt text on images. The README must render on PyPI (`twine check --strict` passes) as well as GitHub, so no GitHub-only HTML is needed.
- **Accuracy gate.** Every command, flag, env var, import and code sample is verified against the code, the same way as the release 1 README. The examples in "Use with your stack" are runnable as written.

### 4. CI: `.github/workflows/ci.yml`

Triggers: `pull_request`, `push` to main, `workflow_call`, `workflow_dispatch`. Concurrency cancels superseded PR runs only. Workflow permissions are `contents: read`, and every job has a timeout.

Every action is pinned to a full commit SHA with a version comment, and checkout uses `persist-credentials: false`. Current majors (verified 2026-11-20): `actions/checkout` v7, `actions/setup-node` v7, `astral-sh/setup-uv` v10, `actions/upload-artifact` v7, `actions/download-artifact` v8, and `pypa/gh-action-pypi-publish` `release/v1`. The builder resolves the SHAs at write time.

Node comes from a new `frontend/.nvmrc` containing `26`. uv uses `enable-cache: true` with `uv.lock` as the dependency glob, and installs run with `uv sync --locked`. Jobs that don't need the UI set `LOQUENT_SKIP_UI_BUILD=1`.

Jobs (all parallel unless noted):

1. **lint.** Run `ruff check` and `ruff format --check`. Formatting is now enforced: land one format-only commit and list it in `.git-blame-ignore-revs`.
2. **pr-title** (PRs only). Use `amannn/action-semantic-pull-request` to require a conventional-commit PR title (feat, fix, docs, chore, refactor, perf, test, build, ci). The repo uses squash merges with the PR title as the commit message, so every commit on main is conventional.
3. **frontend.** Run `npm ci`, `npm run typecheck` and `vitest --run`.
4. **test.** pytest on ubuntu with Python 3.11, 3.12, 3.13 and 3.14, plus windows-latest and macos-latest on 3.12. `fail-fast: false`. Mongo params are deselected here; the builder confirms the selector with `--collect-only`.
5. **mongo.** Run against a service container `mongo:7.0` or `mongo:8.0`, with `LOQUENT_TEST_MONGO_URL` set, pymongo latest, and one leg on the `pymongo==4.9.*` floor.
   - Install with `uv sync --locked --extra mongo`, then `uv pip install` the matrix pymongo, then `uv run --no-sync pytest tests/store`.
   - A skip must fail the job: when `CI` is set, the conftest fails instead of skipping.
   - pymongo-inmemory and the `<4.10` dev pin stay for local work (my call). Removing them is a later cleanup.
6. **e2e.** Build the UI and run the 7 Playwright tests (`npx playwright install --with-deps chromium`). Upload traces on failure. Runs on every PR.
7. **build.** Run `uv build`. Then assert:
   - one sdist and one `py3-none-any` wheel
   - the wheel contains `loquent/server/static/index.html` and assets
   - the sdist contains `frontend/` sources but not `node_modules` or the built static files
   - `twine check --strict` passes

   Upload `dist` as an artifact.
8. **wheel-smoke** (needs build). Runs in a `python:3.12-slim` container with no Node, which the job asserts.
   - Install the wheel, then run `loquent serve` on the e2e fixture.
   - Poll `/healthz`. Check that `/` contains `<base href="/">` and that a referenced asset returns 200.
   - Also install the `[mongo]` extra and import `loquent.store.mongo`.
9. **ci-ok.** Needs all of the above and runs with `if: always()`. It fails if any needed job failed, was cancelled, or was skipped, except pr-title on push events. This is the single required check.

### 5. Releases: release-please plus gated PyPI publish

- **`release-please-config.json`**:
  - release-type `python`, package `loquent`, `include-v-in-tags: true`
  - `bump-minor-pre-major: true`, so breaking changes before 1.0 bump the minor version
  - changelog sections: Features, Bug Fixes, Performance, Documentation, Dependencies; chores hidden
  - `extra-files`: one toml entry for `uv.lock` with jsonpath `$.package[?(@.name=='loquent')].version`
  - The builder verifies the jsonpath with a local dry run of release-please's updater. If it can't be made to work, the fallback is a step in the release workflow, running on the release-please branch, that runs `uv lock` and commits.
- **`.release-please-manifest.json`**. Bootstrapped so the first release PR proposes exactly **0.1.0** (pyproject is already 0.1.0). Use `"release-as": "0.1.0"` for the first release, then remove it in that same release PR or straight after. The builder decides how.
- **`.github/workflows/release.yml`**, triggered on push to main.
  1. **release-please** job (`googleapis/release-please-action`, pinned). It authenticates with a GitHub App installation token (`actions/create-github-app-token`), so the release PR triggers CI and can satisfy the required `ci-ok` check. A fine-grained PAT is the documented alternative.
     - Permissions: contents write, pull-requests write, issues write.
     - Outputs `release_created`, `tag_name` and `sha`.
  2. **build** (if `release_created`). Check out the tagged `sha` and build `dist` exactly as in CI, with uv cache disabled. Also verify that the tag equals `v` plus the pyproject version.
  3. **publish-pypi** (needs build). Uses `environment: pypi` with a required reviewer (the owner), `permissions: id-token: write`, and `pypa/gh-action-pypi-publish` with Trusted Publishing.
  4. **attach-assets** (needs publish-pypi, `contents: write`). Uploads `dist/*` to the GitHub Release that release-please created.
- **TestPyPI rehearsal.** `release.yml` also has a `workflow_dispatch` input `testpypi: true`. It builds from main and publishes to TestPyPI under a `testpypi` environment, with no release created. It is used once before the first real 0.1.0.
- `CHANGELOG.md` is owned by release-please. Earlier history is summarised in one line: "0.1.0 — first public release".

### 6. Repository hygiene

- **`.github/dependabot.yml`**: weekly updates for `uv` (root), `npm` (`/frontend`) and `github-actions`.
  - Minor and patch updates are grouped.
  - 7-day cooldown.
  - `pymongo` is ignored while the dev pin exists.
  - Every update gets the label `dependencies`.
  - Commit messages use the prefixes `chore(deps)` and `build(deps)`, so they are conventional.
- **CodeQL** uses default setup (Python, JS/TS, Actions), enabled in Settings, with no workflow file. Secret scanning, push protection, Dependabot alerts and private vulnerability reporting are also enabled in Settings.
- **Optional `actions-lint` job**: actionlint and zizmor on `.github/workflows/`. The builder adds it if it is cheap.

### 7. Getting it onto GitHub

1. Finish the release 1 branch locally. Merge `feat/release-1` into `main` with a merge commit, which keeps the 16-task history with its reviews. Do the publishing work on a new branch from main (`chore/publish`), then merge it into main locally.
2. The owner runs `! gh auth login` in this session.
3. `git remote add origin https://github.com/Sanady/loquent.git`, then push `main`. Nothing goes anywhere else. Branches other than main are not pushed.
4. Apply the repo About metadata with `gh repo edit` (§2). Once the owner confirms, apply the repository settings that `gh api` can set: rulesets, environments and Actions permissions. Anything that can't be scripted goes into a checklist for the owner.
5. The owner does the one-time setup (§8), then runs the TestPyPI rehearsal and merges the first release PR to publish 0.1.0.

Because pushing is outward-facing, the implementer stops and asks before step 3. That confirmation includes the exact remote URL and what will be pushed.

### 8. One-time owner setup (checklist in the handoff)

1. Run `gh auth login`.
2. Create a GitHub App, e.g. "loquent-release", with Contents and Pull requests set to read & write. Install it on the repo, and store `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` as repository secrets. Alternative: a fine-grained PAT stored as `RELEASE_PLEASE_TOKEN`.
3. Configure environments. `pypi` has a required reviewer (the owner) and deployments from main only. `testpypi` has no reviewer.
4. On PyPI and on TestPyPI, add a pending Trusted Publisher: owner `Sanady`, repo `loquent`, workflow `release.yml`, environment `pypi` (or `testpypi`). The account needs 2FA.
5. Create a ruleset on main:
   - require a PR
   - require the status check `ci-ok`
   - squash merge only
   - block force-push and deletion

   Create a second ruleset that restricts who can create `v*` tags.
6. Under Actions settings, set the token default to read-only, allow GitHub Actions to create PRs (release-please needs this), and require approval for first-time contributors.
7. Under Code security, enable CodeQL default setup, Dependabot alerts and security updates, secret scanning with push protection, and private vulnerability reporting.

## Owner answers after the builder check

- Commits are published as they are, with author `rener <ivanrenerr@gmail.com>`. The author identity is not rewritten.
- The `docs/superpowers/` design docs and plans are published along with the code.

## Calls settled after the builder check

- **First push.** The first push goes straight to `main`, once, because the repo is empty and has no CI to satisfy. The format-only commit, and its `.git-blame-ignore-revs` entry, land before the push. Rulesets (required `ci-ok`, squash-only) are applied only after the first CI run on GitHub is green, so the merge-commit history from `feat/release-1` is unaffected.
- **First release version.** `release-as: 0.1.0` is used for the first release only. Removing it afterwards is a one-line manual step on the owner checklist: a PR titled `chore: drop release-as` that goes through normal CI. It is not automated.
- **`uv.lock` fallback.** If the `uv.lock` fallback is needed, it commits with the same GitHub App token, so CI runs on the release PR.
- **Test-only code changes.** Changing `tests/store/conftest.py` to fail rather than skip under CI, and adding the markers or selectors CI needs, are allowed code changes alongside the three pre-push fixes.
- **Python 3.14.** It goes into the matrix only if `uv sync --locked --python 3.14` succeeds locally. Otherwise it is left out, and the handoff says so. It is never added as an allowed-to-fail leg.
- **Node version.** `frontend/.nvmrc` = `26`. Node 26 is the Active LTS since October 2026.

## Calls I made (owner can override)

- Python 3.14 is added to the matrix. Windows and macOS run on 3.12 only.
- Mongo 7.0 and 8.0 are the supported versions, plus a pymongo floor leg.
- `ruff format` is enforced, starting with one format-only commit.
- e2e runs on every PR.
- pymongo-inmemory is kept for local development.
- A GitHub App token is preferred over a PAT for release-please.
- Signed tags and commits are not required.
- Squash-merge only, with conventional PR titles enforced by CI.
- `feat/release-1` is merged into main with a merge commit, preserving its history.

## Left to the builder

- Exact YAML, action SHAs, and job timeouts.
- The release-please bootstrap mechanics for 0.1.0 and the `uv.lock` jsonpath verification (with the documented fallback).
- How the README screenshot is produced, and the README prose.
- Wording of the issue and PR templates, CONTRIBUTING.md and SECURITY.md.
- Whether to add actionlint and zizmor.

## Verification (when built)

- **Local suites stay green.** Also `actionlint` on the workflows if available, and `uvx twine check --strict dist/*`.
- **First push.** `ci.yml` runs green on GitHub, including mongo, e2e, build and wheel-smoke.
- **Merge gating.** A PR whose title isn't conventional fails pr-title, and therefore fails ci-ok.
- **Release PR.** release-please opens a release PR for 0.1.0. CI runs on it (the App token works), and it bumps `pyproject.toml`, `uv.lock` and `CHANGELOG.md`.
- **TestPyPI rehearsal.** It publishes, and `pip install -i https://test.pypi.org/simple/ loquent` serves the UI.
- **Real release.** Merging the release PR creates the tag and the GitHub Release. The PyPI publish waits for approval, then succeeds, and `pip install loquent` works in a clean environment.
- **README.** It renders correctly on GitHub and PyPI, and every snippet in it is verified.
