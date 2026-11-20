# Loquent — Design

*Working name. Free on PyPI and npm as of 2026-11-18; trademark not yet checked.*

Once approved, this document is committed as
`~/code/loquent/docs/superpowers/specs/2026-11-18-loquent-design.md` in a new repo.

## Context and intent

Building a chat UI for an LLM backend is painful and repetitive. Loquent lets a developer
get a polished, production-ready chat interface on top of an LLM backend with **a few lines
of code**.

The gap it fills is the one Chainlit leaves. Chainlit was archived on 2026-10-15, after its
core team stepped away in May 2025. Its problem was robustness: when something broke or
didn't fit, developers couldn't fix it from their own code. The fix had to happen in
Chainlit's core. Its issue tracker shows where the walls were:
- **Sessions:** state was held in memory and tied to a live connection. There was no
  multi-replica deployment, no HTTP API for starting a session, and reading request
  headers meant patching internals.
- **The UI was closed:** the branding footer couldn't be removed, panels couldn't be
  hidden, and custom elements couldn't import packages.
- **Auth and storage were bolted on.** One data layer required a public S3 bucket. There
  was no health endpoint and no sub-path hosting.
- **Upgrades broke apps.** A Pydantic bump broke the framework, and a later release showed
  messages out of order.

Loquent must not be a Chainlit clone. Its identity, as chosen by the user, rests on two
ideas:
1. **Foundation: your code doesn't import Loquent.** Loquent speaks **AG-UI** (the open
   agent↔UI protocol; 1.0 stable since 2026-09-30; HTTP + SSE; official Python package
   `ag-ui-protocol`). Most agent frameworks already emit it. You hand Loquent an existing
   agent, a plain function, or a URL. Leaving Loquent costs nothing.
2. **Headline: the agent can draw UI.** Mid-conversation the agent shows forms,
   approve/reject buttons, choices, tables and charts, and waits for the user's answer.
   Human-in-the-loop is a built-in feature, not an add-on.

## Users

- **Developers** (primarily Python) who have LLM or agent logic and need a UI for it.
- **End users**, who chat in the resulting app: internal tools, customer-facing products,
  demos.

## Goals

- Under ~5 lines from `pip install loquent` to a working, streaming chat UI.
- Accept both kinds of backend:
  - **(A)** code Loquent runs: an agent-framework object or a plain function.
  - **(B)** a backend already running at a URL.
- A developer never hits a wall where the only fix is changing Loquent. Every layer can be
  replaced through a documented extension point.
- Ready for production out of the box:
  - the server keeps nothing in memory, so it scales horizontally
  - safe defaults
  - a health check
  - sub-path hosting

## Non-goals (v1)

- A TypeScript/Node server SDK. It comes later, against the same protocol and the same UI
  bundle.
- Voice, a canvas/side-by-side editor, real-time multi-user collaboration.
- Acting as an MCP client or a tool host. Tools belong to the agent; Loquent *displays*
  tool calls. This is zero-import consistent.
- An admin dashboard or analytics.
- A publishable React component library (`@loquent/react`). Considered for later.

## Anti-goals (failure even if it "works")

- A Loquent-only API spread through the developer's agent code (Chainlit lock-in again).
- Any state that lives only in one process's memory.
- Insecure by default: API keys reaching the browser, public file buckets, an
  unauthenticated server exposed on a network without an explicit opt-out.
- Forced branding, or UI pieces that can't be hidden or replaced.
- Silent breaking changes to the public Python API or the wire protocol.

## Approaches considered

**Language/stack:**
1. **Python server and SDK, with a prebuilt TypeScript/React UI bundled into the wheel.**
   ← chosen.
   - Most LLM backend code is in Python, and it's Chainlit's orphaned audience.
   - Users never need Node.
   - Cost: two languages in the repo, for maintainers only.
2. **TypeScript everywhere.** Rejected: Python developers would need Node just to show a
   chat.
3. **A standalone Go/Rust UI server plus thin SDKs.** Rejected: two processes for
   hello-world, three languages to maintain.

**Identity:**
1. **No lock-in on AG-UI**, combined with **agent-drawn interactive UI**, with no lock-in as
   the base. ← chosen.
2. **No lock-in only.** Rejected: thinner differentiation.
3. **Agent-drawn UI on Loquent's own API.** Rejected: it recreates lock-in.

## Decided design

### Packaging
- One PyPI package, `loquent`. The React/TypeScript UI is built at release time (Vite) and
  shipped as static assets inside the wheel.
- Optional extras pull in framework adapters: `loquent[langgraph]`,
  `loquent[pydantic-ai]`, `loquent[openai-agents]`, `loquent[mongo]`, `loquent[postgres]`.

### Entry points (all equivalent)
```python
loquent.serve(agent)  # Python
app = loquent.App(agent)
fastapi_app.mount("/chat", app)  # mount into existing ASGI app
```
```
loquent serve my_agent.py:graph              # CLI, module:object
loquent serve https://api.acme.com/v1 --model gpt-4o
```

### What `agent` can be (auto-detected, explicit override available)
| Input | Handling |
|---|---|
| URL of an AG-UI endpoint | Proxied as is |
| URL + `model` of an OpenAI-compatible endpoint | Translated to AG-UI events by Loquent |
| Framework object (LangGraph, Pydantic AI, OpenAI Agents SDK, …) | Wrapped with that framework's official AG-UI adapter |
| Plain `async def f(messages) -> str` or async generator of str | Wrapped by Loquent into AG-UI text events |
| Anything else | User supplies an adapter: a callable that yields AG-UI events (documented extension point) |

### Request flow
Browser UI → Loquent server (auth, persistence, file handling) → agent (in-process or over
HTTP) → AG-UI events streamed back over SSE.
- Loquent's server is the single place that persists threads and events.
- API keys and backend URLs live only on the server.

### Interactive UI (the headline)
Built on AG-UI **frontend-owned tools**:
- On each run, the Loquent UI declares its widget tools in `RunAgentInput.tools`:
  `confirm`, `select`, `form` (JSON-Schema-driven), `table`, `chart`, `file_request`.
- Any agent framework calls them like ordinary tools. **No Loquent import is needed.**
- When the agent calls one, the run ends and the UI renders the widget. The user's answer
  goes back as a `ToolMessage` in the next request and the agent continues.
- This round trip is stateless, so it fits the no-memory server.
- Display-only widgets (`table`, `chart`) render without waiting.
- An **optional** sugar for plain-function mode: `yield ui.ask(Confirm("Refund $42?"))`.
  It emits the widget tool call and ends the run.
  - The function is called again on the next request with the full history, the user's
    answer included, and reads it via `ctx.answer(...)`.
  - **There is no replay or resume-after-await magic**, so side effects never run twice
    (*my call*; a suspended coroutine would break statelessness).
- **Adapters that don't end the run on a frontend tool call:**
  - Loquent ships a thin wrapper for each officially supported adapter that does.
  - A contract test enforces this for every adapter.
  - Unsupported or third-party adapters still work for chat and are flagged
    "widgets unavailable" (*my call*).
- Developers can register custom widgets: a JSON schema plus an ES module that renders it,
  loaded at runtime, with no Node build required.

### Display of agent activity
Built from standard AG-UI events:
- streaming text
- steps (`STEP_STARTED`/`STEP_FINISHED`) as collapsible rows
- tool calls with arguments and results
- reasoning, where the backend emits it
- errors, shown inline with a retry button

### End-user features (v1)
- Formatted text: Markdown is sanitized, and raw HTML is off by default.
- Code highlighting and math.
- Stop, regenerate and copy.
- A thread list with history.
- File attachments.
- Light and dark themes.

### Storage
- One `Store` interface for threads, messages/events, users and file metadata.
- Three backends:
  - **SQLite** is the default, for zero setup.
  - **MongoDB** is the NoSQL production option, as the user requested.
  - **Postgres** is also a production option.
- Files sit behind a `FileStore` interface (local disk or S3-compatible) and are served
  only through short-lived signed URLs. Buckets are never public.

### Statelessness and reconnects
- No process memory holds session state. Run events are persisted as they stream.
- If a client reconnects mid-run (or hits another replica), it loads persisted events and
  polls until the run finishes.
- v1 needs no pub/sub (*my call*; live tailing across replicas through Redis can come
  later).
- **If the replica running an agent dies mid-run,** the run is marked `interrupted`. The
  history up to that point is kept, and the user sees a Retry button. There is no durable
  job queue and no automatic re-execution in v1 (*my call*: agents aren't guaranteed safe
  to restart, and a job queue is large infrastructure).
- **Stop/cancel:** a cancel flag is written to the store, and the replica running the
  agent checks it between events (*my call*; works without pub/sub).
- **Conversation state owner:** Loquent's store is the record of what the user saw.
  - Every run sends the full message history plus a stable `threadId`, as AG-UI expects.
  - Regenerate re-sends the history without the last reply under the same `threadId`.
  - Backends that keep their own checkpointed state are documented as possibly diverging
    on regenerate.
  - Edit-and-branch is not in v1 (*my call*).

### Auth
A pluggable `Auth` interface. Built in:
- none: allowed only when bound to localhost
- username/password
- OAuth/OIDC
- trusted header (for a login proxy in front)

Request headers and query parameters are exposed to the agent through the run context
(`forwardedProps`).

### Security defaults
- If bound to a non-localhost address with no auth configured, Loquent refuses to start
  unless `--insecure-no-auth` is passed.
- CSRF protection on cookie sessions.
- A strict CSP.
- Configurable CORS for embedding.
- Rate-limit hook.
- Upload size and type limits.

### Ops
- A `/healthz` endpoint.
- `root_path` (sub-path) support.
- Structured logs.
- OpenTelemetry tracing hooks.

### Customization without forking
- **Branding is the app's own:** a theme of tokens (colors, fonts, radius), a logo, a
  name, and **no Loquent branding by default**.
- Any panel can be hidden.
- Custom CSS.
- Custom widgets (above).
- Every server layer is replaceable: adapter, store, file store, auth.

### Stability
- The public Python API and Loquent's HTTP surface follow semver, with typed models
  generated from the AG-UI schema.
- Contract tests run against each supported framework adapter and storage backend.
- End-to-end UI tests run in CI.

## Release plan (decided by user)
**Release 1 (first installable):**
- Streaming chat UI showing steps and tool calls.
- Inputs: plain function or async generator, OpenAI-compatible URL, AG-UI URL.
- Storage: SQLite and MongoDB.
- Password sign-in, plus the full set of security defaults.
- Widgets: `confirm`, `select`, `form`.
- Stateless runtime: interrupted runs, cancel flag.
- `/healthz` and `root_path`.
- Theming and branding.

**Release 2:**
- Framework adapters: LangGraph, Pydantic AI, OpenAI Agents SDK.
- Postgres.
- OAuth/OIDC and trusted-header sign-in.
- `table`, `chart`, `file_request` and custom widgets.
- OpenTelemetry.

The interfaces (`Store`, `FileStore`, `Auth`, adapters) are defined in release 1 in their
final shape, so release 2 only adds implementations.

## Calls made during review (check these)
1. A dead replica marks the run `interrupted` with Retry; there is no job queue or
   auto-rerun.
2. `ui.ask` ends the run, and the function is re-called with the answer in history. There
   is no replay magic.
3. Stop/cancel uses a cancel flag in the store, polled between events.
4. Loquent's store is the record of the conversation; full history plus a stable
   `threadId` is sent each run; there is no edit-and-branch in v1.
5. Loquent wraps any supported adapter that doesn't stop on frontend tools; other
   adapters get chat only.
6. No pub/sub in v1; reconnect replays persisted events and polls.

## What's left to the builder
- Frontend internals: state library, component library, markdown/math renderer, styling
  approach (must be maintained and swappable).
- Exact config format (Python kwargs plus an optional `loquent.toml`) and the CLI flag
  names.
- Schema/collection layouts per storage backend, and migrations.
- Which framework adapters ship in v1 beyond LangGraph, Pydantic AI and the OpenAI Agents
  SDK.
- Exact widget JSON schemas, and the custom-widget module contract.
- Repo layout, CI, release tooling (uv on the Python side, pnpm on the TypeScript side is
  a reasonable default).

## Verification (when built)
- `pip install loquent` in a clean venv with no Node, then `loquent serve` with:
  - a plain async generator
  - a LangGraph graph
  - an OpenAI-compatible URL

  Each case should stream in the browser.
- **Interactive UI:** the agent calls `confirm`, the user clicks Approve, and the agent
  continues with the answer, on each supported adapter.
- **Statelessness:** run 2 replicas behind a load balancer with no sticky sessions, kill
  one mid-run, and check the thread still completes and history is intact (SQLite
  excluded; Mongo and Postgres).
- **Security:** binding to `0.0.0.0` without auth refuses to start; uploaded files aren't
  reachable without a signed URL; API keys never appear in browser network traffic.
- The contract test suite passes for every store and adapter.
