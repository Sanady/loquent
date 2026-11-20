# Loquent Publishing, CI/CD and SEO README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the finished Loquent release 1 publishable at `https://github.com/Sanady/loquent`. That covers the pre-push fixes, Apache-2.0 licensing and metadata, an SEO-oriented README, the CI workflow, release-please with a gated PyPI publish, and the push itself.

**Architecture:**
- **Repository files only.** Community docs, `pyproject` metadata, README and `.github/` workflows. There are no product changes beyond three small fixes and test-harness changes.
- **CI** is one `ci.yml` ending in a single aggregate `ci-ok` check.
- **Release** is one `release.yml`: release-please runs with a GitHub App token, then build → publish to PyPI through the `pypi` environment (approval-gated) → attach assets.
- **The push** happens after merging locally, and only after explicit owner confirmation.

**Tech Stack:** GitHub Actions, `googleapis/release-please-action`, `pypa/gh-action-pypi-publish` (Trusted Publishing), `astral-sh/setup-uv`, `actions/setup-node`, `amannn/action-semantic-pull-request`, `actions/create-github-app-token`, Dependabot, ruff, pytest, vitest, Playwright, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-20-loquent-publishing-design.md` (approved 2026-11-20). Its "Owner answers" and "Calls settled" sections are binding.

## Global Constraints

### Licensing and metadata
- License: Apache-2.0, holder `The Loquent authors`. In `pyproject.toml`: `license = "Apache-2.0"`, `license-files = ["LICENSE"]`.
- Repo: `https://github.com/Sanady/loquent` (owner `Sanady`, repo `loquent`). Only `main` is pushed.
- Commits keep author `rener <ivanrenerr@gmail.com>`. History is never rewritten. `docs/superpowers/` is published.

### Toolchain and matrix
- Python matrix: 3.11, 3.12, 3.13, 3.14 on ubuntu-latest, plus windows-latest and macos-latest on 3.12. 3.14 resolves locally (`uv sync --locked --python 3.14` dry-run OK).
- Node from `frontend/.nvmrc` = `26`.
- Mongo service images: `mongo:7.0` and `mongo:8.0`. The pymongo floor leg is `pymongo==4.9.*`.

### Workflow conventions
- Action majors: `actions/checkout` v7, `actions/setup-node` v7, `astral-sh/setup-uv` v10, `actions/upload-artifact` v7, `actions/download-artifact` v8, `pypa/gh-action-pypi-publish` `release/v1`.
- Pin every action to a full commit SHA with a `# vX.Y.Z` comment. Checkout uses `persist-credentials: false`. Workflow-level `permissions: contents: read`, widened per job only where needed. Every job sets `timeout-minutes`.
- Single required check: job id `ci-ok` in `ci.yml`.

### Commits and releases
- Conventional PR title types: `feat fix docs chore refactor perf test build ci`. Squash merges only (applied as a ruleset after the first green CI).
- Release secrets: `RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY`. The documented fallback is a fine-grained PAT stored as `RELEASE_PLEASE_TOKEN`.
- Environments: `pypi` (required reviewer: the owner) and `testpypi` (no reviewer).
- First release is exactly `0.1.0`, via `"release-as": "0.1.0"`. Removing it afterwards is a manual owner-checklist PR, `chore: drop release-as`.

### README and repository metadata
- README claims must match the code. Every command, flag, env var, import and snippet is verified. Chainlit is described only factually ("alternative to", "successor for"), never with its logo or branding.
- GitHub topics: `chat-ui, llm, ai-agents, chatbot, ag-ui, chainlit, chainlit-alternative, python, react, fastapi, starlette, ollama, openai, langgraph, streaming, self-hosted`.

### Process
- Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Stop before any push or GitHub settings change and get the owner's explicit confirmation.**

## Review Focus

1. **The Mongo CI job passes while silently skipping every Mongo test.** Expected: under `CI`, an unreachable Mongo fails the run. Test in Task 1.
2. **release-please bumps `pyproject.toml` but not `uv.lock`, so `uv sync --locked` fails on the release PR.** Expected: `uv.lock`'s `loquent` version moves too. Test in Task 6, which applies the real GenericToml updater to a copy of `uv.lock`.
3. **A README snippet or flag that doesn't work as written.** Expected: every documented CLI flag appears in `--help`, and every Python snippet imports and type-checks. Test in Task 4.
4. **The built wheel or sdist is missing LICENSE, or its README fails to render on PyPI.** Expected: the wheel METADATA has `License-Expression: Apache-2.0` and the license file, and `twine check --strict` passes. Test in Task 3.
5. **The aggregate `ci-ok` passes when a needed job was skipped or cancelled.** Expected: `ci-ok` fails. Covered by an actionlint run plus an explicit result-check expression in Task 5.

---

## File structure

```
LICENSE                                   Apache-2.0 text (Task 3)
CONTRIBUTING.md  SECURITY.md              (Task 3)
CHANGELOG.md                              seed, owned by release-please afterwards (Task 6)
.git-blame-ignore-revs                    format-only commit SHA (Task 2)
pyproject.toml                            license/classifiers/keywords/urls/sdist include (Task 3); pytest marker (Task 1)
README.md                                 SEO rewrite (Task 4)
docs/assets/loquent-chat.png              README screenshot (Task 4)
frontend/.nvmrc                           "26" (Task 5)
frontend/e2e/screenshot.mjs               screenshot generator, not run in CI (Task 4)
.github/workflows/ci.yml                  (Task 5)
.github/workflows/release.yml             (Task 6)
.github/dependabot.yml                    (Task 5)
.github/ISSUE_TEMPLATE/{bug.yml,feature.yml,config.yml}   (Task 3)
.github/pull_request_template.md          (Task 3)
release-please-config.json  .release-please-manifest.json (Task 6)
scripts/check_release_lockfile.mjs        uv.lock jsonpath test (Task 6)
```

Code touched by Task 1: `src/loquent/auth.py`, `src/loquent/ui.py`, `frontend/src/state/store.ts`, `frontend/src/widgets/Select.tsx`, `tests/store/conftest.py`, and their tests.

---

### Task 0: Branch setup (controller, no subagent)

- [ ] Confirm the working tree is clean on `feat/release-1`: `git status --short` shows nothing.
- [ ] `git checkout main && git merge --no-ff feat/release-1 -m "Merge release 1"`, with the trailer.
- [ ] `git checkout -b chore/publish`. All of Tasks 1–6 commit here.
- [ ] Run `uv run pytest -q` and `npm --prefix frontend test -- --run`. Expect 339 and 154 passed.

---

### Task 1: Pre-push hardening and CI-safe Mongo fixture

**Files:**
- Modify: `src/loquent/auth.py` (`is_loopback`), `src/loquent/ui.py` (`Select.__post_init__`, `_option_values`)
- Modify: `frontend/src/state/store.ts` (`restoreThread`), `frontend/src/widgets/Select.tsx` (`parseOptions`)
- Modify: `tests/store/conftest.py`, `pyproject.toml` (`[tool.pytest.ini_options] markers`)
- Modify README: only the loopback paragraph gets one sentence; Task 4 rewrites the rest.
- Test: `tests/test_auth.py`, `tests/test_ui.py`, `tests/store/test_conftest_ci.py`, `frontend/src/state/store.test.ts`, `frontend/src/widgets/Select.test.tsx`

**Interfaces:**
- Produces:
  - `is_loopback(host: str | None) -> bool` now also returns True for exactly `"testclient"`.
  - A pytest marker `mongo` applied to every mongo-param test, so `-m "not mongo"` deselects all of them.
  - Under `os.environ.get("CI")`, the mongo fixture calls `pytest.fail` instead of `pytest.skip`.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_auth.py
@pytest.mark.parametrize("host", ["testclient"])
def test_testclient_counts_as_loopback(host): assert is_loopback(host) is True
@pytest.mark.parametrize("host", ["TESTCLIENT", "testclient.evil", "localhost", ""])
def test_other_names_still_refused(host): assert is_loopback(host) is False
def test_starlette_testclient_gets_through_auth_none():  # build create_app via tests/server/srv.py helpers
    with TestClient(app) as c:  # starlette.testclient
        assert c.get("api/threads", headers={"X-Loquent-CSRF": "1"}).status_code == 200

# tests/test_ui.py
def test_select_accepts_list_pairs():
    assert Select("Pick", [["pro", "Pro plan"], "basic"]).args()["options"] == [
        {"value": "pro", "label": "Pro plan"}, {"value": "basic", "label": "basic"}]
def test_validate_answer_accepts_value_from_list_pair():
    validate_answer("loquent_select", {"message": "m", "options": [["pro", "Pro"]]}, {"value": "pro"})  # no raise

# tests/store/test_conftest_ci.py — uses pytester
def test_mongo_fixture_fails_not_skips_under_ci(pytester, monkeypatch):
    monkeypatch.setenv("CI", "true"); monkeypatch.setenv("LOQUENT_TEST_MONGO_URL", "mongodb://127.0.0.1:1")
    # run a copy of the store conftest + one mongo-param test; assert outcomes: failed=1, skipped=0
def test_not_mongo_marker_deselects_all_mongo_params(pytester): ...  # collect-only: no id contains "mongo"
```

```ts
// store.test.ts
it("restoreThread does not open the hash thread while a send is starting", ...)
// expect api.thread not called while starting
// Select.test.tsx
it("accepts [value,label] list pairs as options", ...)
```

- [ ] **Step 2:** Run `uv run pytest tests/test_auth.py tests/test_ui.py tests/store/test_conftest_ci.py -q` and `npm --prefix frontend test -- --run src/state/store.test.ts src/widgets/Select.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `is_loopback`: `host == "testclient"` returns True, checked before IP parsing. The match is exact and case-sensitive.
  - `Select.__post_init__` and `_option_values`: accept a list of length 2 of strings as a pair. `args()` normalises it to `{"value","label"}`.
  - `parseOptions`: treat `[string, string]` the same way.
  - `restoreThread`: return early when `get().starting`.
  - conftest: when Mongo is unreachable, call `pytest.fail` (with the same message) if `CI` is set, else `pytest.skip`. Mark the `"mongo"` fixture param with `pytest.param("mongo", marks=pytest.mark.mongo)`, and mark `tests/store/test_mongo_indexes.py` module-wide with `pytestmark = pytest.mark.mongo`.
  - Register the marker in `pyproject.toml`.
  - README loopback paragraph: add "Starlette's `TestClient` (host `testclient`) counts as local."
- [ ] **Step 4:** Run the same commands. Expect PASS. Then run the full suites: `uv run pytest -q`, `npm --prefix frontend test -- --run`, `uv run ruff check`.
- [ ] **Step 5: Commit** `fix: TestClient counts as local; list-pair select options; no hash restore while starting` and `test: mongo marker and fail-not-skip under CI` (two commits).

---

### Task 2: Enforce formatting (format-only commit)

**Files:** every file `ruff format` changes; Create: `.git-blame-ignore-revs`

- [ ] **Step 1:** Run `uv run ruff format --check .` and record the count of files it would reformat.
- [ ] **Step 2:** Run `uv run ruff format .`, then `uv run pytest -q` and `uv run ruff check`. Expect the same pass count as before.
- [ ] **Step 3: Commit** `style: apply ruff format` with only the formatting changes in it.
- [ ] **Step 4:** Create `.git-blame-ignore-revs` with a comment line `# ruff format` and the full SHA of the Step 3 commit. Commit as `chore: ignore format commit in blame`.
- [ ] **Step 5:** Run `uv run ruff format --check .`. Expect `N files already formatted`.

---

### Task 3: License, package metadata, community files

**Files:**
- Create: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/feature.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/pull_request_template.md`
- Modify: `pyproject.toml`
- Test: `tests/test_packaging.py`

**Interfaces:** Produces the metadata the README badges read: license and classifiers.

- [ ] **Step 1: Write the failing test** `tests/test_packaging.py`. Mark it `@pytest.mark.slow` and register the marker. It builds with `LOQUENT_SKIP_UI_BUILD` unset only if npm exists, and skips with a clear reason otherwise. Assertions:

```python
def test_wheel_metadata_and_license(tmp_path):
    # uv build --wheel --out-dir tmp_path ; open METADATA
    assert "License-Expression: Apache-2.0" in meta
    assert "License-File: LICENSE" in meta
    assert "Classifier: Programming Language :: Python :: 3.14" in meta
    assert "Project-URL: Source, https://github.com/Sanady/loquent" in meta
    assert any(n.endswith("licenses/LICENSE") for n in names)
def test_sdist_contains_license_and_changelog(tmp_path): ...  # LICENSE, CHANGELOG.md in sdist; no node_modules
def test_twine_check_strict(tmp_path): ...  # subprocess `uvx twine check --strict` on built dists, returncode 0
```

- [ ] **Step 2:** Run `uv run pytest tests/test_packaging.py -q`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `LICENSE`: the full Apache-2.0 text, with copyright `2026 The Loquent authors` in the appendix line.
  - `pyproject.toml`: `license`, `license-files`, the `description` from spec §2, `keywords` and `classifiers` as listed in spec §2 (including 3.14), and `[project.urls]` with Homepage, Source and Issues pointing to `https://github.com/Sanady/loquent` and `/issues`, and Changelog pointing to `.../blob/main/CHANGELOG.md`. Add `/LICENSE` and `/CHANGELOG.md` to the sdist include.
  - Create an empty-ish `CHANGELOG.md` stub (`# Changelog`) if Task 6 hasn't created it yet. Task 6 owns its content.
  - `CONTRIBUTING.md`: dev setup (`uv sync`, `npm --prefix frontend ci`), how to run each suite (pytest, vitest, `npm run e2e`, Mongo via `docker run -p 27017:27017 mongo:8.0` + `LOQUENT_TEST_MONGO_URL`), the conventional PR title types from Global Constraints, squash merges, and the blame-ignore setup `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
  - `SECURITY.md`: report through GitHub private vulnerability reporting; supported versions are the latest 0.x.
  - Issue forms: bug (version, Python, how it is run, agent type, repro, logs) and feature. `config.yml` disables blank issues.
  - PR template: summary, a conventional-title reminder, and a checklist of the suites run.
- [ ] **Step 4:** Run `uv run pytest tests/test_packaging.py -q`. Expect PASS. Then run `uv run pytest -q -m "not slow"`. Expect PASS.
- [ ] **Step 5: Commit** `build: Apache-2.0 license and PyPI metadata` and `docs: contributing, security policy and issue/PR templates`.

---

### Task 4: SEO README and screenshot

**Files:**
- Modify: `README.md`
- Create: `docs/assets/loquent-chat.png`, `frontend/e2e/screenshot.mjs`
- Test: `tests/test_readme.py`

**Interfaces:**
- Consumes: Task 3's metadata (badges), the Task 1 TestClient sentence, CLI `--help` output, `Settings` fields.

- [ ] **Step 1: Write the failing test** `tests/test_readme.py`:

```python
def test_every_documented_cli_flag_exists():
    # collect `--[a-z-]+` tokens from README lines containing `loquent serve` / `loquent user add`
    # assert each appears in `loquent serve --help` / `loquent user add --help` output
def test_every_documented_env_var_is_a_setting():  # LOQUENT_* tokens ⊆ {f"LOQUENT_{n.upper()}" for n in Settings.model_fields} ∪ {"LOQUENT_SKIP_UI_BUILD","LOQUENT_TEST_MONGO_URL"}
def test_python_snippets_compile():  # every ```python block: compile(src, "README", "exec")
def test_python_imports_resolve():  # every `from loquent... import X` / `import loquent...` line in snippets executes
def test_required_sections_present():
    for h in ["## Quickstart", "## Coming from Chainlit?", "## Use with your stack", "## Comparison", "## FAQ"]:
        assert h in readme
def test_badges_and_screenshot():
    assert "actions/workflows/ci.yml/badge.svg" in readme and "img.shields.io/pypi/v/loquent" in readme
    assert "img.shields.io/pypi/pyversions/loquent" in readme and "img.shields.io/github/license/Sanady/loquent" in readme
    assert re.search(r"!\[[^\]]{20,}\]\(docs/assets/loquent-chat\.png\)", readme)  # descriptive alt text
```

- [ ] **Step 2:** Run `uv run pytest tests/test_readme.py -q`. Expect FAIL.
- [ ] **Step 3:** Write `frontend/e2e/screenshot.mjs`, a Playwright script using the same fixture server as the e2e config. It sends a "refund" message so a confirm widget shows, then saves a 1280×800 light-theme PNG to `docs/assets/loquent-chat.png`. Run it locally and commit the PNG (under 400 KB). Add an npm script `screenshot`. The script is not part of CI.
- [ ] **Step 4:** Rewrite `README.md` per spec §3:
  - H1 and tagline, badges, pitch, screenshot, "Why Loquent".
  - Quickstart (keep the existing three forms).
  - "Coming from Chainlit?": the mapping table and what release 1 lacks.
  - "Use with your stack": OpenAI, Ollama (`http://localhost:11434/v1`, `--no-widgets` note), vLLM, any AG-UI agent, plain function.
  - Comparison table: Loquent / Chainlit (archived 2026-10-15) / Gradio ChatInterface / Open WebUI. Use "—" when unsure.
  - FAQ (≥5 search-phrased questions).
  - Then the existing sections, kept and verified: widgets, storage, sign-in, security, deployment, theming, extending, settings table, limitations, development, license (Apache-2.0).
- [ ] **Step 5:** Run `uv run pytest tests/test_readme.py -q`. Expect PASS. Then run `uvx --from twine twine check --strict` on a fresh `uv build --sdist` output. Expect PASSED.
- [ ] **Step 6: Commit** `docs: README for discovery — Chainlit migration, stack guides, comparison, FAQ` and `docs: README screenshot`.

---

### Task 5: CI workflow, Node pin, Dependabot

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `frontend/.nvmrc`
- Test: `actionlint` and `zizmor` run locally via `uvx`/`npx` if available, otherwise via the official docker image. Report what was used.

**Interfaces:**
- Produces: `ci.yml` callable via `workflow_call` (used by Task 6's TestPyPI path), and the aggregate job id `ci-ok`.

- [ ] **Step 1:** Resolve the SHA of each action at the Global-Constraints majors with `git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>`. For annotated tags, use the peeled `^{}` SHA. Record them in the task report.
- [ ] **Step 2:** Write `ci.yml` per spec §4. Triggers: `pull_request`, `push: branches: [main]`, `workflow_call`, `workflow_dispatch`. Concurrency group `ci-${{ github.event.pull_request.number || github.ref }}`, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. Jobs and exact commands:
  - `lint`: `uv sync --locked`; `uv run ruff check --output-format=github .`; `uv run ruff format --check .`.
  - `pr-title` (`if: github.event_name == 'pull_request'`, `pull-requests: read`): `amannn/action-semantic-pull-request` with `types` = the Global Constraints list.
  - `frontend`: `npm ci`; `npm run typecheck`; `npx vitest --run`.
  - `test`: matrix per Global Constraints; `uv sync --locked`; `uv run pytest -q -rs -m "not mongo and not slow"`.
  - `mongo`: matrix `{mongo: "8.0", pymongo: "latest"}`, `{mongo: "7.0", pymongo: "latest"}`, `{mongo: "8.0", pymongo: "4.9.*"}`. Service with a `mongosh` ping health check, env `LOQUENT_TEST_MONGO_URL=mongodb://localhost:27017` and `CI=true`. Steps: `uv sync --locked --extra mongo` → `uv pip install "pymongo>=4.10"` or `"pymongo==4.9.*"` → `uv run --no-sync pytest -q -rs -m mongo tests/store`.
  - `e2e`: `uv sync --locked` with `LOQUENT_SKIP_UI_BUILD=1`; `npm ci`; `npx playwright install --with-deps chromium`; `npm run e2e`; on failure upload `frontend/test-results/` with 7-day retention.
  - `build`: `uv build`; assert with a Python heredoc that there is 1 sdist and 1 `py3-none-any` wheel, that `loquent/server/static/index.html` and ≥1 `static/assets/` file are present, that the sdist has `frontend/package-lock.json` but no `node_modules/` or `server/static/`; `uvx twine check --strict dist/*`; upload artifact `dist`.
  - `wheel-smoke` (`needs: build`, `container: python:3.12-slim`): assert no node or npm; venv install the wheel; start `loquent serve frontend/e2e/fixtures/agent.py:agent --port 8000 --store sqlite:////tmp/s.db` from `/tmp`; a urllib poll of `/healthz` (30 s); `/` contains `<base href="/">`; first `assets/*.js` returns 200; install `[mongo]` extra and `import loquent.store.mongo`.
  - `slow` (packaging tests): `uv run pytest -q -m slow`, with Node set up.
  - `ci-ok`: `needs: [lint, pr-title, frontend, test, mongo, e2e, build, wheel-smoke, slow]`, `if: always()`. A single step fails when any of these holds:
    - any need's result is `failure` or `cancelled`
    - any need other than `pr-title` is `skipped`
    - `pr-title` is `skipped` on a `pull_request` event

    Write it as one bash step reading `${{ toJSON(needs) }}` with `jq`.
- [ ] **Step 3:** Write `frontend/.nvmrc` = `26`. Use it via `node-version-file`. setup-uv uses `enable-cache: true`, `cache-dependency-glob: uv.lock`.
- [ ] **Step 4:** Write `dependabot.yml` per spec §6:
  - ecosystems `uv` at `/`, `npm` at `/frontend`, `github-actions` at `/`, all weekly
  - groups for minor+patch, and `cooldown: default-days: 7`
  - `ignore: [{dependency-name: pymongo}]` on the uv ecosystem
  - label `dependencies`
  - `commit-message` prefix `chore(deps)`
- [ ] **Step 5:** Run actionlint and zizmor (`zizmor --min-severity medium`) on `.github/workflows/`. Expect no errors. Also locally run each `run:` command block from `lint`, `frontend`, `test` and `build` in this repo. Expect them to pass. Paste the outputs.
- [ ] **Step 6: Commit** `ci: test, lint, e2e, mongo and wheel workflow with ci-ok gate` and `ci: dependabot and node pin`.

---

### Task 6: release-please and gated PyPI release

**Files:**
- Create: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release.yml`, `scripts/check_release_lockfile.mjs`
- Modify: `CHANGELOG.md`
- Test: `scripts/check_release_lockfile.mjs`, run with `node`

**Interfaces:**
- Consumes: `ci.yml`'s build commands (copied, not called, for the tagged build).
- Produces: release outputs `release_created`, `tag_name`, `sha`.

- [ ] **Step 1: Write the failing check** `scripts/check_release_lockfile.mjs`. It:
  - installs `release-please` into a temp dir (pinned version, `npm i --prefix <tmp>`)
  - imports its `GenericToml` updater
  - applies it to the contents of `uv.lock` with the `jsonpath` read from `release-please-config.json` and version `9.9.9`
  - asserts that the `[[package]] name = "loquent"` entry now has `version = "9.9.9"`, and that no other line changed

  The script exits 0 on success and 1 on failure.
- [ ] **Step 2:** Run `node scripts/check_release_lockfile.mjs`. Expect FAIL, because there is no config yet.
- [ ] **Step 3: Implement.**
  - `release-please-config.json`:
    - `$schema` set
    - `packages: {".": {...}}` with `release-type: python`, `package-name: loquent`, `include-v-in-tags: true`, `bump-minor-pre-major: true`, `release-as: "0.1.0"`
    - `changelog-sections`: feat→Features, fix→Bug Fixes, perf→Performance, docs→Documentation, deps→Dependencies; chore, ci, test, style, refactor and build are hidden
    - `extra-files: [{type: "toml", path: "uv.lock", jsonpath: "$.package[?(@.name=='loquent')].version"}]`
  - `.release-please-manifest.json`: `{".": "0.0.0"}`.
  - `CHANGELOG.md`: `# Changelog` only.
  - If the jsonpath can't satisfy the check, use the spec fallback instead: a job step on release-please's branch that runs `uv lock` and commits with the App token. Then change the check to assert that the fallback step exists.
- [ ] **Step 4:** Run `node scripts/check_release_lockfile.mjs`. Expect PASS.
- [ ] **Step 5:** Write `release.yml` per spec §5.
  - Triggers: `push: branches: [main]`, plus `workflow_dispatch` with input `testpypi: boolean`.
  - Jobs:
    - `release-please` (`if: github.event_name == 'push'`):
      - `actions/create-github-app-token` with `app-id: ${{ secrets.RELEASE_APP_ID }}`, `private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}`
      - then `googleapis/release-please-action` with `token: ${{ steps.app-token.outputs.token }}`, `config-file` and `manifest-file`
      - outputs `release_created`, `tag_name`, `sha`
    - `build` (`if: needs.release-please.outputs.release_created == 'true' || inputs.testpypi`):
      - check out `ref: ${{ needs.release-please.outputs.sha || github.sha }}`
      - verify `tag_name == "v" + pyproject version` when releasing
      - `uv build` with `enable-cache: false`
      - the same assertions as CI build
      - upload `dist`
    - `publish-pypi` (`if: release_created`, `environment: {name: pypi, url: https://pypi.org/p/loquent}`, `id-token: write`): download `dist`, then `pypa/gh-action-pypi-publish`.
    - `publish-testpypi` (`if: inputs.testpypi`, `environment: testpypi`, `id-token: write`): `repository-url: https://test.pypi.org/legacy/`.
    - `attach-assets` (`needs: publish-pypi`, `contents: write`): `gh release upload "$TAG" dist/* --clobber`, with `GH_TOKEN: ${{ github.token }}`.
  - Concurrency `release`, with `cancel-in-progress: false`.
- [ ] **Step 6:** Run actionlint and zizmor on `release.yml`. Expect no errors. Paste the outputs.
- [ ] **Step 7: Commit** `ci: release-please with gated PyPI trusted publishing` and `test: verify release-please bumps uv.lock`.

---

### Task 7: Merge, push, GitHub settings (controller; owner confirms each outward step)

- [ ] **Step 1:** On `chore/publish`, run the full verification: pytest (all markers), vitest, typecheck, e2e, ruff check and format, and `uv build` plus `twine check`. All must pass.
- [ ] **Step 2:** `git checkout main && git merge --no-ff chore/publish -m "Merge publishing setup"`, with the trailer.
- [ ] **Step 3: STOP. Ask the owner** to confirm the push. Show:
  - the remote URL
  - that only `main` is pushed
  - `git log --oneline main | wc -l` and the top 10 commits
  - the author identity that will be public
- [ ] **Step 4:** The owner runs `! gh auth login`. Then `git remote add origin https://github.com/Sanady/loquent.git && git push -u origin main`.
- [ ] **Step 5:** Run `gh repo edit Sanady/loquent --description "<spec §2 description>" --homepage "https://pypi.org/project/loquent/"`, plus `--add-topic` for each topic in Global Constraints.
- [ ] **Step 6:** Watch the first CI run: `gh run watch` on `ci.yml`. If it is red, fix it on a branch and PR. Do not proceed until `ci-ok` is green.
- [ ] **Step 7: STOP. Ask the owner** before changing repo settings. Then, via `gh api`:
  - Create the `main` ruleset: require a PR, require the `ci-ok` check, squash-only merges, block force-push and deletion.
  - Create the `v*` tag ruleset: restrict creation to admins.
  - Create environments: `pypi` with the owner as required reviewer and `main` as the deployment branch, and `testpypi`.
  - Set Actions defaults: read-only workflow token, can create PRs.

  Report any setting the API couldn't apply.
- [ ] **Step 8:** Hand off the owner checklist from spec §8, in this order:
  1. GitHub App or PAT, and the secrets
  2. PyPI and TestPyPI pending publishers
  3. CodeQL default setup and security toggles
  4. a TestPyPI dry run via `gh workflow run release.yml -f testpypi=true`
  5. merge the 0.1.0 release PR and approve the `pypi` deployment
  6. the `chore: drop release-as` PR
