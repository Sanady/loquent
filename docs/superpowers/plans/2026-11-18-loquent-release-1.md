# Loquent Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first installable `loquent` release: `pip install loquent` plus a few lines
gives a streaming, multi-thread chat UI with agent-drawn `confirm`/`select`/`form` widgets.
It runs over a plain Python function, an OpenAI-compatible URL, or an AG-UI URL, and
persists to SQLite or MongoDB behind password sign-in.

**Architecture:**
- A Starlette ASGI server (`loquent.server`) owns auth, persistence and run execution.
- Agents sit behind one `Adapter` interface that yields AG-UI events.
- Each run executes in a background task that persists every event (batched) to the
  `Store`, so a client can disconnect and reconnect. A replica dying mid-run shows up as a
  stale heartbeat, and the run reads as `interrupted`.
- The browser UI is a React/TypeScript app built with Vite into
  `src/loquent/server/static/` and shipped inside the wheel.

**Tech Stack:**
- **Python ≥3.11:** `ag-ui-protocol` (1.x), Starlette, uvicorn, httpx, pydantic v2,
  pydantic-settings, aiosqlite, pymongo ≥4.9 (async API) as extra `mongo`, argon2-cffi,
  itsdangerous, python-multipart.
- **Python tooling:** uv, hatchling, pytest + pytest-asyncio, ruff.
- **Frontend:** React 19, TypeScript, Vite, zustand, react-markdown + remark-gfm +
  remark-math + rehype-katex + rehype-highlight, Vitest + Testing Library, Playwright.
- **Frontend tooling:** npm, because pnpm is not installed on this machine.

**Spec:** `docs/superpowers/specs/2026-11-18-loquent-design.md` (Release 1 section is the
scope; "Calls made during review" are binding).

## Global Constraints

- Package name `loquent` (PyPI). CLI command `loquent`. Python `requires-python = ">=3.11"`.
- Users never need Node: the wheel contains the prebuilt UI.
  `LOQUENT_SKIP_UI_BUILD=1` skips the npm build for Python-only dev.
- API keys and backend URLs never appear in any response body, event, or static asset
  sent to the browser.
- No session state lives only in process memory, with one exception: the in-flight live
  queue of a run, which is always also persisted.
- Binding to a non-localhost host with `auth="none"` refuses to start unless
  `insecure_no_auth=True` / `--insecure-no-auth`.
- Files are served only via HMAC-signed URLs with a TTL of 300 s. There is no public file
  route.
- Markdown is rendered without raw HTML (no `rehype-raw`).
- No Loquent branding is shown by default. `app_name` defaults to `"Chat"`.
- Widget tool names: `loquent_confirm`, `loquent_select`, `loquent_form`.
- Heartbeat every 5 s. A `running` run whose heartbeat is older than 30 s is `interrupted`.
- The cancel flag is checked at most every 0.5 s. Events are flushed to the store every
  0.25 s or every 50 events, whichever comes first.
- A cancelled run ends with `RUN_FINISHED` `outcome={"type":"cancelled"}`. A run stopped on
  a widget call ends with `RUN_FINISHED` `outcome={"type":"success","pendingToolCallIds":[id]}`.
- An agent exception is shown to the end user as `RUN_ERROR` `code="agent_error"`,
  `message="The agent ran into an error."`. The traceback is logged server-side only.
- Every task commits with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Another user's ids:** another signed-in user's thread / run / file id in any route
   gets **404** (not 403, no data). Test in Task 9.
2. **Forged widget answer:** a `tool_result` for a `tool_call_id` that isn't a pending
   `loquent_*` call in that thread's last run, or with an answer that fails the widget
   schema (e.g. a `select` value not in options), gets **400** and starts no run. Test in
   Task 9.
3. **Browser closes mid-reply:** the run still completes and persists. Reopening shows
   the full reply. Tests in Task 7 (runner) and Task 13 (client polling).
4. **Double-click Send / two tabs:** two `POST /api/runs` on the same thread at once
   produce exactly one run; the other gets **409** `run_in_progress`. Tests in Task 2
   (store contract) and Task 9.
5. **Agent or user text containing `<script>`, `<img onerror>` or `javascript:` links:**
   rendered inert. Test in Task 14.

---

## File structure

```
pyproject.toml                 hatchling + build hook, deps, extras [mongo], scripts loquent=loquent.cli:main
hatch_build.py                 runs `npm ci && npm run build` in frontend/ unless LOQUENT_SKIP_UI_BUILD=1
src/loquent/
  __init__.py                  exports App, serve, Settings, ui, RunContext, Adapter
  protocol.py                  new_id(), events_to_messages(), encode_sse(), parse_event()
  settings.py                  Settings (pydantic-settings, env prefix LOQUENT_)
  context.py                   RunContext, WidgetAnswer, FileRef
  ui.py                        Confirm/Select/Form, ask(), WIDGET_TOOLS, is_widget_tool(), validate_answer()
  adapters/
    base.py                    Adapter protocol, AgentError
    function.py                FunctionAdapter
    openai_compat.py           OpenAICompatAdapter
    agui_http.py               AgUiHttpAdapter
    resolve.py                 resolve_agent()
  store/
    models.py                  User, Thread, Run, RunStatus, StoredEvent, FileMeta, RunInProgress
    base.py                    Store protocol
    sqlite.py                  SqliteStore
    mongo.py                   MongoStore
    factory.py                 open_store(url)
  files.py                     FileStore protocol, LocalFileStore, sign_file_url(), verify_file_sig()
  auth.py                      hash_password(), verify_password(), SessionManager, AuthMode, check_bind_safety()
  runner.py                    RunHandle, start_run(), effective_status()
  server/
    app.py                     create_app(adapter, settings, store, file_store) -> Starlette
    deps.py                    current_user(), require_csrf(), owned_thread()/owned_run()
    routes_auth.py routes_threads.py routes_runs.py routes_files.py routes_meta.py
    security.py                SecurityHeadersMiddleware
    static.py                  UI index with injected root path; static mount
    static/                    (build output, gitignored)
  app.py                       App (public ASGI wrapper), serve()
  cli.py                       main(): `serve`, `user add`
frontend/
  package.json vite.config.ts tsconfig.json index.html playwright.config.ts
  src/main.tsx App.tsx theme.ts
  src/api/sse.ts src/api/client.ts
  src/state/reducer.ts src/state/store.ts
  src/components/{ThreadList,MessageList,Message,Markdown,StepRow,ToolCallRow,Composer,Login,RunControls}.tsx
  src/widgets/{registry.ts,Confirm.tsx,Select.tsx,Form.tsx}
  e2e/smoke.spec.ts e2e/fixtures/agent.py
tests/                         pytest; mirrors src/loquent
README.md
```

---

### Task 1: Package scaffold and protocol helpers

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `src/loquent/__init__.py`, `src/loquent/protocol.py`
- Test: `tests/test_protocol.py`

**Interfaces:**
- Produces:
  - `new_id() -> str`: uuid4 hex.
  - `events_to_messages(events: Iterable[dict]) -> list[ag_ui.core.Message]`.
  - `encode_sse(seq: int, event: BaseEvent | dict) -> str`.
  - `parse_event(data: dict) -> BaseEvent`: validates via the ag_ui event union.
  - `event_to_dict(e: BaseEvent) -> dict`: `model_dump(by_alias=True, exclude_none=True, mode="json")`.
- Events are stored and passed around as camelCase dicts (the wire form).

- [ ] **Step 1: Scaffold.**
  - `uv init --lib`-style layout with hatchling.
  - Deps from the Tech Stack, plus dev deps `pytest pytest-asyncio ruff httpx`.
  - `[tool.pytest.ini_options] asyncio_mode="auto"`.
  - `.gitignore` covers `src/loquent/server/static/`, `node_modules/`, `*.db`,
    `loquent-files/`, `.venv/`.
  - Run `uv sync` and expect success.
- [ ] **Step 2: Write failing tests**

```python
def test_text_messages_grouped_by_id_and_role():
    ev = [
        {"type": "TEXT_MESSAGE_START", "messageId": "u1", "role": "user"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "u1", "delta": "Hi"},
        {"type": "TEXT_MESSAGE_END", "messageId": "u1"},
        {"type": "STEP_STARTED", "stepName": "search"},
        {"type": "TEXT_MESSAGE_START", "messageId": "a1"},  # role absent = assistant
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "a1", "delta": "Hel"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "a1", "delta": "lo"},
        {"type": "TEXT_MESSAGE_END", "messageId": "a1"},
    ]
    m = events_to_messages(ev)
    assert [(x.role, x.content) for x in m] == [("user", "Hi"), ("assistant", "Hello")]


def test_tool_call_attaches_to_parent_and_result_becomes_tool_message():
    ev = [
        {"type": "TEXT_MESSAGE_START", "messageId": "a1"},
        {"type": "TEXT_MESSAGE_END", "messageId": "a1"},
        {
            "type": "TOOL_CALL_START",
            "toolCallId": "t1",
            "toolCallName": "loquent_confirm",
            "parentMessageId": "a1",
        },
        {"type": "TOOL_CALL_ARGS", "toolCallId": "t1", "delta": '{"message":'},
        {"type": "TOOL_CALL_ARGS", "toolCallId": "t1", "delta": '"Ok?"}'},
        {"type": "TOOL_CALL_END", "toolCallId": "t1"},
        {
            "type": "TOOL_CALL_RESULT",
            "messageId": "r1",
            "toolCallId": "t1",
            "content": '{"confirmed":true}',
        },
    ]
    a, t = events_to_messages(ev)
    assert a.tool_calls[0].id == "t1" and a.tool_calls[0].function.arguments == '{"message":"Ok?"}'
    assert t.role == "tool" and t.tool_call_id == "t1"


def test_tool_call_without_parent_creates_assistant_message(): ...  # one assistant msg, content None/"" , 1 tool_call
def test_unterminated_text_kept_unterminated_tool_call_dropped(): ...  # START+CONTENT kept; START+ARGS w/o END dropped
def test_encode_sse_has_id_and_camelcase():
    s = encode_sse(7, TextMessageContentEvent(message_id="m", delta="x"))
    assert s.startswith("id: 7\ndata: ") and '"messageId":"m"' in s and s.endswith("\n\n")
```

- [ ] **Step 3: Run `uv run pytest tests/test_protocol.py -v`.** Expect FAIL (import error).
- [ ] **Step 4: Implement `protocol.py`.**
  - Use `ag_ui.core` message classes (`UserMessage`, `AssistantMessage`, `ToolMessage`,
    `ToolCall`, `FunctionCall`) and the event classes.
  - `events_to_messages` keeps insertion order of first appearance.
- [ ] **Step 5: Run the tests.** Expect PASS. Run `uv run ruff check`. Expect clean.
- [ ] **Step 6: Commit** `feat: package scaffold and AG-UI protocol helpers`.

---

### Task 2: Store interface, models, SQLite store, contract suite

**Files:**
- Create: `src/loquent/store/{__init__,models,base,sqlite,factory}.py`
- Test: `tests/store/conftest.py`, `tests/store/test_contract.py`

**Interfaces:**
- Produces (`store/models.py`, pydantic):
  - `User(id, username, password_hash, created_at)`
  - `Thread(id, owner_id, title, created_at, updated_at)`
  - `RunStatus = Literal["running","succeeded","failed","cancelled","interrupted"]`
  - `Run(id, thread_id, status, created_at, heartbeat_at, finished_at: datetime|None, error: str|None, cancel_requested: bool, superseded: bool)`
  - `StoredEvent(seq: int, event: dict, is_input: bool)`
  - `FileMeta(id, owner_id, name, content_type, size, created_at)`
  - `class RunInProgress(Exception)`
- Produces the `Store` protocol (`store/base.py`, all async):
  - **Lifecycle:** `init()`, `close()`, `ping() -> bool`
  - **Users:**
    - `create_user(username, password_hash) -> User`: raises `ValueError` on a duplicate
      username.
    - `get_user(user_id) -> User|None`
    - `get_user_by_username(username) -> User|None`
  - **Threads:**
    - `create_thread(owner_id, title) -> Thread`
    - `get_thread(thread_id) -> Thread|None`
    - `list_threads(owner_id, limit=50) -> list[Thread]`: newest `updated_at` first.
    - `rename_thread(thread_id, title)`
    - `delete_thread(thread_id)`: cascades runs, events, file metas linked to the thread.
  - **Runs:**
    - `create_run(thread_id, *, stale_after_s=30) -> Run`: atomic. Raises `RunInProgress`
      if the thread has a run with status `running` and `heartbeat_at` within
      `stale_after_s`. Touches the thread's `updated_at`.
    - `get_run(run_id) -> Run|None`
    - `list_runs(thread_id) -> list[Run]`: oldest first.
    - `heartbeat(run_id)`
    - `finish_run(run_id, status, error=None)`: no-op if already terminal.
    - `request_cancel(run_id)`
    - `is_cancel_requested(run_id) -> bool`
    - `mark_superseded(run_id)`
  - **Events:**
    - `append_events(run_id, events: list[StoredEvent])`
    - `list_events(run_id, after_seq=0) -> list[StoredEvent]`
    - `thread_events(thread_id) -> list[dict]`: runs oldest first. For superseded runs,
      only `is_input` events.
  - **Files:** `save_file_meta(meta)`, `get_file_meta(file_id) -> FileMeta|None`
  - `open_store(url: str) -> Store`: `sqlite:///path` or `sqlite:///:memory:` →
    `SqliteStore`; `mongodb://…` / `mongodb+srv://…` → `MongoStore` (lazy import, clear
    error if the extra is missing). Anything else raises `ValueError`.

- [ ] **Step 1: Write the contract suite, parametrized by a `store` fixture.**
  - `tests/store/conftest.py` yields `SqliteStore(":memory:")` after `init()`.
  - Task 3 adds a mongo param.
  - Tests:
    - `test_user_roundtrip_and_duplicate_username_rejected`
    - `test_list_threads_owner_scoped_newest_first`
    - `test_create_run_rejects_second_running_run` (`pytest.raises(RunInProgress)`)
    - `test_create_run_allowed_when_previous_is_stale`: set `heartbeat_at` 31 s back via
      `stale_after_s=0`, or a monkeypatched clock.
    - `test_concurrent_create_run_exactly_one_wins`: `asyncio.gather` of 2
      `create_run`, `return_exceptions=True`, then exactly 1 `Run` and 1 `RunInProgress`.
    - `test_finish_run_is_idempotent_on_terminal`
    - `test_cancel_flag_roundtrip`
    - `test_events_append_and_list_after_seq`
    - `test_thread_events_hides_superseded_output_keeps_input`
    - `test_delete_thread_cascades`
- [ ] **Step 2: Run `uv run pytest tests/store -v`.** Expect FAIL.
- [ ] **Step 3: Implement `SqliteStore(path: str)`.**
  - aiosqlite with WAL mode.
  - Tables: `users`, `threads`, `runs`, `events(run_id, seq, is_input, json)`, `files`.
  - Schema created in `init()`.
  - `create_run` runs inside `BEGIN IMMEDIATE`.
  - Datetimes are UTC ISO strings.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat: store interface with SQLite backend and contract suite`.

---

### Task 3: MongoDB store

**Files:**
- Create: `src/loquent/store/mongo.py`
- Modify: `tests/store/conftest.py`, `pyproject.toml` (extra `mongo = ["pymongo>=4.9"]`, dev
  dep `pymongo-inmemory`)

**Interfaces:**
- Consumes: the `Store` protocol and models from Task 2.
- Produces: `MongoStore(url: str, db_name: str = "loquent")`.

- [ ] **Step 1: Add a `mongo` param to the `store` fixture.**
  - Use `LOQUENT_TEST_MONGO_URL` if set, otherwise start a server with
    `pymongo_inmemory.Mongod`.
  - Skip with a clear reason only if both fail.
  - Use a unique db name per test and drop it after.
- [ ] **Step 2: Run `uv run pytest tests/store -v -k mongo`.** Expect FAIL (`MongoStore`
  missing).
- [ ] **Step 3: Implement `MongoStore`.**
  - Use `pymongo.AsyncMongoClient`.
  - Collections: `users` (unique index on username), `threads` (index `owner_id,updated_at`),
    `runs`, `events` (unique `run_id,seq`), `files`.
  - `create_run` atomicity: `threads.find_one_and_update` with filter
    `{_id, $or:[{active_run_id: null}, {active_heartbeat_at: {$lt: now - stale}}]}`, setting
    `active_run_id` and `active_heartbeat_at`. If no doc matches, raise `RunInProgress`.
  - `heartbeat` updates both the run and `threads.active_heartbeat_at`.
  - `finish_run` clears `active_run_id` when it matches.
- [ ] **Step 4: Run the whole contract suite for both params.** Expect PASS.
- [ ] **Step 5: Commit** `feat: MongoDB store backend`.

---

### Task 4: Widgets, RunContext, Adapter protocol, FunctionAdapter

**Files:**
- Create: `src/loquent/ui.py`, `src/loquent/context.py`,
  `src/loquent/adapters/{__init__,base,function}.py`
- Test: `tests/test_ui.py`, `tests/adapters/test_function.py`

**Interfaces:**
- Produces in `ui.py`:
  - `Confirm(message: str, key: str|None=None, confirm_label="Approve", reject_label="Reject")`
  - `Select(message: str, options: list[str | tuple[str,str]], multiple=False, key=None)`
    - `options` are `(value, label)` pairs; 1–20 of them.
  - `Form(message: str, schema: dict, key=None)`
    - `schema` is a flat JSON Schema object whose properties are of type
      string / number / integer / boolean, or `enum` of strings, with `required`.
  - `ask(widget) -> WidgetRequest`
  - `WIDGET_TOOLS: list[ag_ui.core.Tool]`: the three tools, each with a JSON Schema for
    `parameters`.
  - `is_widget_tool(name) -> bool`
  - `validate_answer(tool_name: str, args: dict, answer: Any) -> None`: raises
    `InvalidAnswer`. Answer shapes:
    - confirm → `{"confirmed": bool}`
    - select → `{"value": str}`, or `{"values": [str]}` when `multiple`; values must be
      in options
    - form → `{"values": {…}}`; types and required are checked against the schema.
- Produces in `context.py`:
  - `RunContext(thread_id, run_id, user: User|None, messages: list[Message], forwarded_props: dict, files: list[FileRef])`
  - property `answer -> WidgetAnswer|None`: present iff the last message is a tool message
    answering a `loquent_*` call.
  - `WidgetAnswer(key: str|None, tool: str, value: Any)`
  - `FileRef(id, name, content_type, size, read: Callable[[], Awaitable[bytes]])`
- Produces in `adapters/base.py`:
  - `class Adapter(Protocol)` with:
    - `supports_widgets: bool`
    - `supports_attachments: bool`
    - `def run(self, input: RunAgentInput, ctx: RunContext) -> AsyncIterator[BaseEvent]`
  - `class AgentError(Exception)`: its message is safe to show users.
  - **Adapters yield content events only.** The runner emits `RUN_STARTED`/`RUN_FINISHED`/
    `RUN_ERROR`.
- Produces `FunctionAdapter(fn)`:
  - Calls `fn(messages)` or `fn(messages, ctx)` depending on positional parameter count
    (1 or 2).
  - Accepts the return forms `str`, an awaitable of `str`, or a sync/async iterator of
    `str | WidgetRequest | BaseEvent`.
  - `supports_widgets=True`, `supports_attachments=True`.

- [ ] **Step 1: Write failing tests:**
  - `test_widget_tools_have_expected_names`: `== {"loquent_confirm","loquent_select","loquent_form"}`
  - `test_validate_answer_select_rejects_unknown_value`
  - `test_validate_answer_form_checks_required_and_types`
  - `test_ctx_answer_reads_last_widget_result`: `ctx.answer == WidgetAnswer(key="refund", tool="loquent_confirm", value={"confirmed": True})`
  - `test_ctx_answer_none_after_plain_user_message`
  - `test_function_str_return_becomes_one_text_message`: the yielded types are
    `[TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END]`.
  - `test_async_generator_streams_deltas_in_order`
  - `test_yielding_ask_emits_tool_call_and_closes_generator`: assert the `TOOL_CALL_START`
    name is `loquent_confirm`, the args JSON includes `key`, and code after the yield never
    runs (a flag stays False).
  - `test_passthrough_base_events`: a yielded `StepStartedEvent` appears unchanged.
- [ ] **Step 2: Run `uv run pytest tests/test_ui.py tests/adapters/test_function.py -v`.**
  Expect FAIL.
- [ ] **Step 3: Implement.**
  - The text deltas of one contiguous run of `str` yields share one `messageId`.
  - A `TOOL_CALL_START.parentMessageId` is the last text message id if one exists.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat: widgets, run context and function adapter`.

---

### Task 5: OpenAI-compatible adapter

**Files:**
- Create: `src/loquent/adapters/openai_compat.py`
- Test: `tests/adapters/test_openai_compat.py`

**Interfaces:**
- Consumes: `Adapter`, `AgentError` (Task 4), `WIDGET_TOOLS`.
- Produces: `OpenAICompatAdapter(base_url: str, model: str, api_key: str|None, client: httpx.AsyncClient|None=None)`
  - `supports_widgets=True`, `supports_attachments=False`.

- [ ] **Step 1: Write failing tests.**
  - Use `httpx.MockTransport` that returns a canned `text/event-stream` of chat.completions
    chunks. Tests:
    - `test_posts_to_chat_completions_with_stream_and_bearer`: assert the URL
      `{base_url}/chat/completions`, body `stream: true`, `model`, and the header
      `Authorization: Bearer k`.
    - `test_content_deltas_become_text_events`
    - `test_tool_call_deltas_become_tool_call_events`: the `loquent_confirm` name and
      concatenated args.
    - `test_widget_tools_sent_as_function_tools_only_when_input_has_tools`
    - `test_history_drops_tool_calls_without_results`
    - `test_http_error_raises_agent_error_without_key`: a 401 gives an `AgentError` whose
      message has the status but not the api key.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
  - Convert AG-UI messages to OpenAI message dicts.
  - Parse SSE `data:` lines and stop at `[DONE]`.
  - Accumulate `tool_calls[i]` by index.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat: OpenAI-compatible adapter`.

---

### Task 6: AG-UI HTTP proxy adapter and `resolve_agent`

**Files:**
- Create: `src/loquent/adapters/agui_http.py`, `src/loquent/adapters/resolve.py`
- Test: `tests/adapters/test_agui_http.py`, `tests/adapters/test_resolve.py`

**Interfaces:**
- Produces: `AgUiHttpAdapter(url: str, headers: dict[str,str]|None=None, client=None)`
  - `supports_widgets=True`, `supports_attachments=False`.
  - POSTs `RunAgentInput` (by_alias JSON) with `Accept: text/event-stream`.
  - Validates each event with `parse_event`.
  - Strips upstream `RUN_STARTED`/`RUN_FINISHED`; upstream `RUN_ERROR` raises
    `AgentError(message)`.
- Produces: `resolve_agent(target, *, model=None, api_key=None) -> Adapter`
  - An `Adapter` instance is returned as is.
  - `http(s)://` with `model` → `OpenAICompatAdapter`; without → `AgUiHttpAdapter`.
  - A callable → `FunctionAdapter`.
  - Anything else raises
    `TypeError("Loquent can't serve <type>: pass a function, a URL, or an Adapter")`.

- [ ] **Step 1: Write failing tests:**
  - `test_proxy_sends_run_agent_input_camelcase`
  - `test_proxy_strips_run_lifecycle_events`
  - `test_proxy_upstream_run_error_raises_agent_error`
  - `test_proxy_invalid_event_raises_agent_error` (malformed JSON or unknown type)
  - `test_resolve_*`: one test per rule.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat: AG-UI proxy adapter and agent resolution`.

---

### Task 7: Runner (background execution, persistence, heartbeat, cancel, interrupted)

**Files:**
- Create: `src/loquent/runner.py`
- Test: `tests/test_runner.py`

**Interfaces:**
- Consumes: `Store`, `Adapter`, `RunContext`, protocol helpers, `is_widget_tool`.
- Produces:
  - `start_run(*, store, adapter, run: Run, input: RunAgentInput, ctx: RunContext, input_events: list[BaseEvent]) -> RunHandle`
    - Spawns an `asyncio.Task` that runs to completion independently of any listener.
  - `RunHandle.stream() -> AsyncIterator[tuple[int, dict]]`: `(seq, event)` live; may be
    abandoned at any time.
  - `RunHandle.task`
  - `effective_status(store, run, now=None, stale_after_s=30) -> RunStatus`: lazily marks
    stale running runs `interrupted`.
  - Constants: `HEARTBEAT_INTERVAL_S=5`, `STALE_AFTER_S=30`, `CANCEL_POLL_S=0.5`,
    `FLUSH_INTERVAL_S=0.25`, `FLUSH_MAX_EVENTS=50`.

- [ ] **Step 1: Write failing tests** (SqliteStore in memory; small fake adapters):
  - `test_emits_run_started_inputs_content_run_finished_with_contiguous_seq`
  - `test_all_events_persisted_and_input_events_flagged`
  - `test_listener_abandoning_stream_does_not_stop_run`: read 1 event, drop the iterator,
    await `handle.task`, then the persisted last event is `RUN_FINISHED` and the status is
    `succeeded`.
  - `test_cancel_flag_stops_run_with_cancelled_outcome`
  - `test_stops_after_widget_tool_call_end_even_if_adapter_continues`: the adapter yields
    a `loquent_select` call, then more text. Expect no text after `TOOL_CALL_END`, and
    the outcome `pendingToolCallIds == [id]`.
  - `test_adapter_exception_yields_generic_run_error_without_secret`: the exception
    message contains `"sk-SECRET"`, the persisted events don't, and the status is `failed`.
  - `test_agent_error_message_passed_through`
  - `test_effective_status_marks_stale_running_run_interrupted`
  - `test_task_cancellation_marks_interrupted` (server shutdown path)
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
  - The task writes to an `asyncio.Queue` (unbounded) plus a buffered flusher.
  - Run the heartbeat and cancel polling inside the main loop by timestamp, with no extra
    tasks.
  - A `finally` flushes and sets the terminal status.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat: background run executor with persistence and cancellation`.

---

### Task 8: Settings, auth, sessions, bind-safety guard

**Files:**
- Create: `src/loquent/settings.py`, `src/loquent/auth.py`
- Test: `tests/test_auth.py`, `tests/test_settings.py`

**Interfaces:**
- Produces: `Settings(BaseSettings)` with env prefix `LOQUENT_`. Fields and defaults:
  - **Server:** `host="127.0.0.1"`, `port=8000`, `root_path=""`
  - **Storage:** `store_url="sqlite:///./loquent.db"`, `files_dir="./loquent-files"`
  - **Auth:** `auth: Literal["none","password"]="none"`, `insecure_no_auth=False`,
    `secret_key: SecretStr|None=None`
  - **Embedding:** `cors_origins: list[str]=[]`, `frame_ancestors: list[str]=[]`
  - **Uploads:** `max_upload_mb=20`,
    `allowed_upload_types=["image/png","image/jpeg","image/gif","image/webp","application/pdf","text/plain","text/markdown","text/csv","application/json"]`
  - **Branding:** `app_name="Chat"`, `logo_path: Path|None=None`, `theme: dict[str,str]={}`,
    `custom_css_path: Path|None=None`, `hide: list[Literal["thread_list"]]=[]`
  - **Agent:** `forward_headers: list[str]=[]`, `model: str|None=None`,
    `api_key: SecretStr|None=None` (env `LOQUENT_API_KEY`)
- Produces password helpers (argon2): `hash_password(pw) -> str`,
  `verify_password(hash, pw) -> bool`
- Produces: `SessionManager(secret: str)`, an itsdangerous `URLSafeTimedSerializer`. Cookie
  `loquent_session` holds `{uid, csrf}`, max age 7 days.
  - `issue(user_id) -> (cookie_value, csrf_token)`
  - `read(cookie_value) -> Session|None`
- Produces the pluggable auth slot, so release 2 can add OAuth/OIDC and trusted-header
  auth without changing it:
  - `class Authenticator(Protocol)` with `mode: str` and
    `async def current_user(request: Request, store: Store) -> User|None`.
  - `NoAuth` always returns the `local` user, creating it on first use.
  - `PasswordAuth(sessions: SessionManager)` reads the `loquent_session` cookie.
  - `/api/config.auth` reports `authenticator.mode`.
- Produces: `check_bind_safety(settings) -> None`, which raises `InsecureConfigError`.
  - Localhost = `127.0.0.1`, `::1`, `localhost`.
  - `password` mode with no `secret_key` also raises.
  - `none` mode with no key gets a random per-process key; a warning is logged.

- [ ] **Step 1: Write failing tests:**
  - `test_password_hash_roundtrip_and_wrong_password`
  - `test_session_tamper_and_expiry_rejected`
  - `test_bind_safety_matrix`: parametrize host × auth × flag → raises or not.
  - `test_password_mode_requires_secret_key`
  - `test_settings_from_env`
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat: settings, password auth, sessions, bind-safety guard`.

---

### Task 9: HTTP API (auth, threads, runs, replay, cancel, health, config, security headers)

**Files:**
- Create: `src/loquent/server/{__init__,app,deps,routes_auth,routes_threads,routes_runs,routes_meta,security}.py`
- Test: `tests/server/conftest.py` (httpx `ASGITransport` client, SqliteStore memory,
  FunctionAdapter echo agent), `tests/server/test_*.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `create_app(adapter: Adapter, settings: Settings, store: Store, file_store: FileStore|None, authenticator: Authenticator, rate_limiter: RateLimiter|None = None) -> Starlette`
  - `RateLimiter = Callable[[Request, User|None], Awaitable[bool]]`. It is called on
    `POST /api/runs` and `POST /api/files`. `False` → `429 {"error":"rate_limited"}`.
    Add the test `test_rate_limiter_false_returns_429`.
  - Lifespan: `store.init()`/`close()`. On shutdown, cancel live run tasks.
- In `none` mode all requests act as the user `local`, created on first use.
- In `password` mode, every `/api/*` route except `/api/config` and `/api/auth/login`
  needs a valid session, else 401. Non-GET routes need the header `X-Loquent-CSRF` equal to
  the session's csrf, else 403.
- **Routes** (all under `root_path`):
  - `GET /healthz` → `200 {"status":"ok"}` (`503` if `store.ping()` fails)
  - `GET /api/config` → `{app_name, logo_url|null, theme, hide, auth, widgets: bool, attachments: bool, max_upload_mb}`
  - `POST /api/auth/login {username,password}` → `200 {user:{id,username}, csrf}` plus a
    cookie (HttpOnly, SameSite=Lax, Secure when the request is https), or `401`.
    `POST /api/auth/logout`. `GET /api/auth/me`.
  - `GET /api/threads` → `[{id,title,updated_at}]`
  - `GET /api/threads/{id}` → `{thread, events: [...thread_events], last_run: {id,status,last_seq}|null}`.
    `status` comes from `effective_status`.
  - `PATCH /api/threads/{id} {title}`, `DELETE /api/threads/{id}`
  - `POST /api/runs` body:
    `{"thread_id": str|null, "input": {"type":"message","content":str,"attachments":[file_id]} | {"type":"tool_result","tool_call_id":str,"answer":any} | {"type":"regenerate"}, "page_query": {str:str}}`
    - Response is `text/event-stream` built with `encode_sse`; the first event is
      `RUN_STARTED` carrying `threadId` and `runId`.
    - The server builds the history from `store.thread_events` plus the new input events.
      Clients never send history.
    - `input_events` by input type:
      - message → `TEXT_MESSAGE_START(role=user, metadata={"attachments":[…FileMeta public fields]})`
        + `CONTENT` + `END`
      - tool_result → `TOOL_CALL_RESULT(content=json.dumps(answer))`
      - regenerate → none; the last run is marked superseded. Allowed only if the last run
        is terminal.
    - `forwarded_props = {"user": {"id","username"}|null, "headers": {allowlisted}, "query": page_query}`
      - `page_query` is capped at 20 keys and 1 KB per value; violations get 400.
    - `RunAgentInput.tools = WIDGET_TOOLS if adapter.supports_widgets else []`
    - A new thread's title is the first 60 chars of the first message.
  - `GET /api/runs/{id}/events?after=N` → `{"status": RunStatus, "events": [{"seq","event"}]}`
  - `POST /api/runs/{id}/cancel` → `202`
- **Errors:** JSON `{"error": code}` with codes `not_found` (404), `run_in_progress` (409),
  `invalid_answer` (400), `invalid_input` (400), `unauthorized` (401), `csrf` (403).
- `SecurityHeadersMiddleware`:
  - CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors <frame_ancestors or 'none'>`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: same-origin`
- CORS uses the Starlette middleware, only when `cors_origins` is set, with credentials.

- [ ] **Step 1: Write failing tests:**
  - `test_healthz_ok`
  - `test_config_has_no_secrets`: an api_key and an upstream URL are set; neither appears
    in the JSON.
  - `test_message_run_streams_and_persists`: parse SSE, then `RUN_STARTED` … assistant
    text … `RUN_FINISHED`. A `GET` of the thread shows the user and assistant messages.
  - `test_history_built_server_side`: the agent records the `ctx.messages` it receives
    and sees the earlier turns.
  - `test_widget_round_trip`: run 1 ends pending on `loquent_confirm`; tool_result
    `{"confirmed":true}` starts run 2; the agent sees `ctx.answer.value == {"confirmed": True}`.
  - **Review Focus 2:**
    - `test_tool_result_for_unknown_or_answered_call_is_400`
    - `test_tool_result_invalid_shape_is_400`
  - **Review Focus 4:** `test_second_concurrent_run_on_thread_is_409`. Start a slow
    agent, then a second POST gets 409.
  - `test_regenerate_supersedes_last_output_keeps_user_message`
  - `test_replay_events_after_seq`
  - `test_cancel_endpoint_stops_run`
  - **Review Focus 1:** `test_other_users_thread_run_file_are_404`. Password mode, two
    users; every id route for user B's resources from user A gets 404.
  - `test_password_mode_requires_session_and_csrf`
  - `test_security_headers_present`
  - `test_root_path_prefix_routes`: `root_path="/chat"`, then `/chat/healthz` returns 200.
- [ ] **Step 2: Run `uv run pytest tests/server -v`.** Expect FAIL.
- [ ] **Step 3: Implement.**
  - The runs route iterates `handle.stream()` inside a `StreamingResponse`. A disconnect
    abandons the iterator only, and the run continues (Task 7).
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat: HTTP API for auth, threads, runs, replay and cancel`.

---

### Task 10: File uploads and signed URLs

**Files:**
- Create: `src/loquent/files.py`, `src/loquent/server/routes_files.py`
- Modify: `server/app.py` (mount), `server/routes_runs.py` (resolve attachments into
  `ctx.files`, ownership check)
- Test: `tests/test_files.py`, `tests/server/test_files_routes.py`

**Interfaces:**
- Produces:
  - `FileStore` protocol:
    - `async save(file_id, chunks: AsyncIterator[bytes], max_bytes: int) -> int`: raises
      `FileTooLarge` and leaves no partial file.
    - `async read(file_id) -> bytes`
    - `async delete(file_id)`
  - `LocalFileStore(root: Path)`
  - `sign_file_url(file_id, secret, now: int, ttl_s=300) -> str` returns
    `api/files/{id}?exp=…&sig=…` (relative).
  - `verify_file_sig(file_id, exp, sig, secret, now) -> bool` (HMAC-SHA256,
    `hmac.compare_digest`)
- **Routes:**
  - `POST /api/files` (multipart `file`) → `{id,name,content_type,size,url}`
    - Rejects `content_type` not in `allowed_upload_types` → 415.
    - Rejects files over `max_upload_mb` → 413.
  - `GET /api/files/{id}?exp&sig`: no session needed, the signature is the credential.
    Sends `Content-Disposition: attachment` for non-images and `X-Content-Type-Options`.
    Expired or bad signature → 403.
- Message attachments must be owned by the sender, else 404 (Review Focus 1). Attachments
  are rejected with 400 if `adapter.supports_attachments` is false.

- [ ] **Step 1: Write failing tests:**
  - `test_sign_verify_roundtrip_expiry_tamper`
  - `test_save_over_limit_raises_and_leaves_nothing`
  - `test_upload_type_and_size_limits`
  - `test_file_get_requires_valid_signature`
  - `test_attachment_visible_to_function_agent_via_ctx_files`
  - `test_attachments_rejected_for_url_adapters`
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat: file uploads with signed URLs`.

---

### Task 11: Public API (`App`, `serve`), static UI serving, CLI

**Files:**
- Create: `src/loquent/app.py`, `src/loquent/cli.py`, `src/loquent/server/static.py`
- Modify: `src/loquent/__init__.py`, `pyproject.toml` (`[project.scripts] loquent = "loquent.cli:main"`)
- Test: `tests/test_app.py`, `tests/test_cli.py`

**Interfaces:**
- Produces: `App(agent, *, settings: Settings|None=None, store: Store|None=None, file_store: FileStore|None=None, authenticator: Authenticator|None=None, rate_limiter: RateLimiter|None=None, **overrides)`
  - An ASGI callable.
  - Every server layer can be replaced from user code. Defaults come from settings.
  - Resolves the agent with `resolve_agent(agent, model=settings.model, api_key=settings.api_key)`.
  - Opens the store with `open_store`.
  - Calls `check_bind_safety` in `serve`.
- Produces: `serve(agent, **overrides) -> None`, which runs uvicorn on `settings.host`/`port`.
- Produces static serving:
  - `GET /` and unknown non-`/api` paths return `index.html` with
    `<base href="{root_path}/">` injected.
  - `/assets/*` comes from the package static dir.
  - `/branding/logo` and `/branding/custom.css` come from settings paths if set.
  - Without a built UI, `/` returns 503 with the text
    `"UI assets missing: build with `npm run build` in frontend/"`.
- **CLI:**
  - `loquent serve TARGET [--model] [--api-key-env NAME] [--host] [--port] [--store URL] [--auth none|password] [--insecure-no-auth] [--root-path]`.
    - TARGET is a URL, `path/to/file.py:attr`, or `pkg.module:attr`.
  - `loquent user add USERNAME [--store URL]` prompts for a password with getpass, twice.

- [ ] **Step 1: Write failing tests:**
  - `test_app_mounts_inside_fastapi_or_starlette_under_prefix`
  - `test_index_injects_base_href`
  - `test_missing_ui_returns_503_message`
  - `test_cli_loads_file_target`
  - `test_cli_loads_module_target`
  - `test_cli_refuses_public_bind_without_auth`: exit code 2, and the message names
    `--insecure-no-auth`.
  - `test_cli_user_add_creates_user`
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expect PASS. Smoke test: run
  `uv run loquent serve tests/fixtures/echo.py:echo` and check
  `curl -s localhost:8000/healthz` gives `{"status":"ok"}`.
- [ ] **Step 5: Commit** `feat: App/serve public API, static UI serving and CLI`.

---

### Task 12: Frontend scaffold and event reducer

**Files:**
- Create: `frontend/{package.json,vite.config.ts,tsconfig.json,index.html}`,
  `frontend/src/state/reducer.ts`, `frontend/src/state/reducer.test.ts`

**Interfaces:**
- Produces in `reducer.ts`:

```ts
export type Item =
  | { kind: "message"; id: string; role: "user" | "assistant"; text: string; attachments: Attachment[]; streaming: boolean }
  | { kind: "step"; name: string; status: "running" | "done" }
  | { kind: "tool"; id: string; name: string; args: string; result?: string; status: "running" | "done" }
  | { kind: "widget"; id: string; widget: "confirm" | "select" | "form"; args: any; answer?: any; argsComplete: boolean }
  | { kind: "error"; message: string; code?: string };
export type RunState = "idle" | "running" | "cancelled" | "failed" | "interrupted";
export interface ThreadView { items: Item[]; run: RunState; runId?: string; lastSeq: number }
export function emptyView(): ThreadView;
export function applyEvent(v: ThreadView, e: AgUiEvent, seq?: number): ThreadView; // pure
export function applyEvents(v: ThreadView, es: AgUiEvent[]): ThreadView;
```

- `loquent_*` tool calls become `widget` items, and the args are parsed on
  `TOOL_CALL_END`. A `TOOL_CALL_RESULT` for a widget sets `answer`.
- `RUN_FINISHED` with outcome `cancelled` sets `run="cancelled"`; otherwise `"idle"`.
  `RUN_ERROR` sets `"failed"` and pushes an error item.

- [ ] **Step 1: Scaffold.**
  - `npm create vite@latest` with react-ts.
  - Add zustand, react-markdown, remark-gfm, remark-math, rehype-katex, rehype-highlight,
    katex, and dev vitest @testing-library/react jsdom @playwright/test.
  - `vite.config.ts`: `base: "./"`, `build.outDir: "../src/loquent/server/static"`,
    `emptyOutDir: true`, dev proxy `/api` → `http://127.0.0.1:8000`.
- [ ] **Step 2: Write failing tests:**
  - `streams text into one assistant message`
  - `user role message from input events`
  - `step started then finished`
  - `tool call args accumulate and result attaches`
  - `loquent_confirm becomes widget; result sets answer`
  - `cancelled outcome sets run cancelled`
  - `run error adds error item`
  - `ignores duplicate seq <= lastSeq`
- [ ] **Step 3: Run `npm --prefix frontend test -- --run`.** Expect FAIL.
- [ ] **Step 4: Implement `reducer.ts`.**
- [ ] **Step 5: Run the tests.** Expect PASS.
- [ ] **Step 6: Commit** `feat(ui): frontend scaffold and AG-UI event reducer`.

---

### Task 13: Frontend API client, SSE, reconnect, app state

**Files:**
- Create: `frontend/src/api/sse.ts`, `frontend/src/api/client.ts`,
  `frontend/src/state/store.ts`, plus tests next to each.

**Interfaces:**
- Consumes: `applyEvent` (Task 12) and the HTTP API from Task 9 (exact routes and bodies).
- Produces:
  - `parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<{ id?: number; data: any }>`
  - `api.config()`
  - `api.login(u,p)`, `api.logout()`, `api.me()`
  - `api.threads()`, `api.thread(id)`, `api.renameThread(id,t)`, `api.deleteThread(id)`
  - `api.startRun(body, signal): AsyncIterable<{seq,event}>`
  - `api.runEvents(id, after)`, `api.cancel(id)`, `api.upload(file)`
  - All paths are relative (no leading `/`), so `<base href>` handles `root_path`.
  - The CSRF header comes from memory, set on login and on `me()`.
- Produces a zustand store with:
  - state: `config`, `user`, `threads`, `currentThreadId`, `view: ThreadView`
  - actions: `send(text, files)`, `answer(toolCallId, value)`, `stop()`, `regenerate()`,
    `openThread(id)`, `newThread()`
  - **Reconnect:** if the SSE stream errors before a terminal event, or `openThread`
    finds `last_run.status === "running"`, poll `runEvents(runId, lastSeq)` every 1000 ms
    until the status is terminal.

- [ ] **Step 1: Write failing tests:**
  - `parseSSE handles split chunks and id field`
  - `startRun sends csrf header and parses events`
  - **Review Focus 3:** `store falls back to polling after stream drop and completes view`.
    Mock fetch: the stream drops after 2 events, and polling returns the rest plus
    `succeeded`.
  - `openThread on running run starts polling`
  - `409 surfaces "already running" error item`
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat(ui): API client, SSE parsing, reconnect and app state`.

---

### Task 14: Chat UI components, theming, branding

**Files:**
- Create: `frontend/src/{main.tsx,App.tsx,theme.ts,styles.css}`,
  `frontend/src/components/*.tsx`, plus component tests.

**Interfaces:**
- Consumes: the store (Task 13).
- Layout: thread list on the left (hidden if `config.hide` includes `"thread_list"`) and a
  conversation on the right. The composer has an attach button only when
  `config.attachments`.
- `Markdown.tsx`:
  - react-markdown with remark-gfm, remark-math, rehype-katex, rehype-highlight.
  - `skipHtml` is enabled.
  - `urlTransform` allows only `http:`, `https:`, `mailto:` and relative URLs.
- Run controls:
  - Stop while running.
  - Regenerate on the last assistant message when idle.
  - Copy on each assistant message.
  - Retry when the run is `interrupted` or `failed`; it calls `regenerate()`.
- `theme.ts`: maps `config.theme` keys (`accent`, `background`, `surface`, `text`, `muted`,
  `radius`, `font`) to CSS variables `--lq-*`. Dark mode follows `prefers-color-scheme`,
  with a header toggle persisted in localStorage (wrapped in try/catch).
- The header shows `config.logo_url` and `config.app_name`. There is no Loquent mark
  anywhere.
- `Login.tsx` is shown when `config.auth === "password"` and there is no user.

- [ ] **Step 1: Write failing tests:**
  - **Review Focus 5:** `markdown renders script and onerror inert, strips javascript: links`.
    Assert no `script` element and no `onerror` attribute, and that the anchor has no
    `javascript:` href.
  - `code blocks highlighted and math rendered` (has the `.katex` class)
  - `step and tool rows collapse/expand`
  - `stop button only while running; regenerate only when idle`
  - `thread list hidden by config`
  - `theme tokens applied as css vars`
  - `no "Loquent" text rendered with default config`
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expect PASS. Also run `npm --prefix frontend run build`,
  which must produce `src/loquent/server/static/index.html`.
- [ ] **Step 5: Commit** `feat(ui): chat interface, markdown, run controls, theming`.

---

### Task 15: Widget components

**Files:**
- Create: `frontend/src/widgets/{registry.ts,Confirm.tsx,Select.tsx,Form.tsx}` plus tests.
- Modify: `components/MessageList.tsx` (render widget items via the registry)

**Interfaces:**
- Consumes: the `widget` items (Task 12) and `store.answer(toolCallId, value)` (Task 13).
- Answer payloads must match `validate_answer` (Task 4) exactly:
  - confirm → `{confirmed: boolean}`
  - select → `{value}` or `{values}`
  - form → `{values}`
- Behavior shared by all three widgets:
  - An answered widget is shown read-only with the chosen value.
  - A widget that isn't the last pending one is disabled.
  - Submit is disabled while a run is in progress.
- `Form` renders the flat schema: string → text input, number/integer → number input,
  boolean → checkbox, enum → select. It shows a required marker and validates client-side
  before submit.

- [ ] **Step 1: Write failing tests:**
  - `confirm sends {confirmed:true}`
  - `select single and multiple payloads`
  - `form validates required and coerces integer`
  - `answered widget is read-only`
  - `unknown widget name renders fallback text, no crash`
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat(ui): confirm, select and form widgets`.

---

### Task 16: Wheel build with bundled UI, end-to-end smoke, README

**Files:**
- Create: `hatch_build.py`, `frontend/playwright.config.ts`, `frontend/e2e/smoke.spec.ts`,
  `frontend/e2e/fixtures/agent.py`, `README.md`
- Modify: `pyproject.toml`
  - `[tool.hatch.build.hooks.custom]`
  - `[tool.hatch.build.targets.wheel] artifacts = ["src/loquent/server/static/**"]`

**Interfaces:**
- `fixtures/agent.py` exposes `agent(messages, ctx)`:
  - streams `"Hello "`, `"from "`, `"Loquent"`
  - on the text `"refund"` it yields `ui.ask(Confirm("Refund $42?", key="refund"))`
  - on a confirmed answer it replies `"Refunded."`
- The README quickstart shows three entry forms (function, OpenAI URL, AG-UI URL), Mongo
  setup (`pip install "loquent[mongo]"`, `LOQUENT_STORE_URL=mongodb://…`), password mode
  (`loquent user add`), and every setting from Task 8.

- [ ] **Step 1: Write the Playwright smoke test.**
  - Its webServer is `uv run loquent serve e2e/fixtures/agent.py:agent --port 8765`.
  - `streams a reply`: type "hi" and expect the text "Hello from Loquent".
  - `confirm widget round trip`: type "refund", click "Approve", expect "Refunded.".
  - `stop`, `reload mid-stream recovers`, `thread persists after reload`.
- [ ] **Step 2: Run `npx --prefix frontend playwright test`.** Expect PASS. Fix any
  integration gaps in the owning task's files.
- [ ] **Step 3: Implement `hatch_build.py`.** Unless `LOQUENT_SKIP_UI_BUILD=1`, it runs
  `npm ci` and `npm run build` in `frontend/`, and fails the build if `index.html` is
  missing afterwards.
- [ ] **Step 4: Check the wheel in a clean, Node-free environment.**
  - Run `uv build`.
  - In a fresh venv with Node removed from PATH, run `pip install dist/loquent-*.whl`.
  - Run `loquent serve frontend/e2e/fixtures/agent.py:agent`. Expect
    `curl localhost:8000/` to return HTML containing `<base href="/">`.
  - Run `unzip -l dist/*.whl | grep static/index.html`, which must print a match.
- [ ] **Step 5: Write the README.** Then run the full suites, `uv run pytest -q` and
  `npm --prefix frontend test -- --run`. Expect all pass.
- [ ] **Step 6: Commit** `build: bundle UI into wheel; e2e smoke and README`.
