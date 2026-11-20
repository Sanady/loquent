# Loquent

Loquent gives any LLM backend a polished, streaming chat UI in a few lines of Python. Point
it at a function, an OpenAI-compatible API or any [AG-UI](https://docs.ag-ui.com) endpoint
and you get threads, history, stop and regenerate, Markdown with code and math, file
uploads, light and dark themes, and optional sign-in. There is no lock-in: Loquent speaks
AG-UI, the open agent-to-UI protocol, so your agent code doesn't need to import Loquent,
and leaving costs nothing. And the agent can draw UI: mid-conversation it can show
approve/reject buttons, choices and forms, then continue with the user's answer.

## Install

```bash
pip install loquent
```

Python 3.11 or newer. The wheel contains the prebuilt UI, so you don't need Node.

## Quickstart

Pick whichever form fits what you already have. Each one serves the UI at
http://127.0.0.1:8000.

**A Python function.** An async generator of strings streams its reply; a plain
`async def` returning a string works too.

```python
# app.py
import loquent

async def agent(messages):
    yield "You said: "
    yield messages[-1].content

if __name__ == "__main__":
    loquent.serve(agent)
```

```bash
python app.py
# or use the CLI, which imports the function and serves it:
loquent serve app.py:agent
```

`messages` is the whole conversation as AG-UI message objects (each has `.role` and
`.content`). Add a second parameter, `ctx`, to get the [run context](#the-run-context).

**An OpenAI-compatible API.** Passing `--model` selects the OpenAI-compatible adapter,
which calls `<url>/chat/completions`:

```bash
export OPENAI_API_KEY=...
loquent serve https://api.openai.com/v1 --model gpt-4o --api-key-env OPENAI_API_KEY
```

`--api-key-env` takes the *name* of an environment variable, so the key never appears in
your shell history or process list. You can also set `LOQUENT_API_KEY` instead. The key
stays on the server and never reaches the browser. The same works for any compatible server
(vLLM, Ollama, LiteLLM, and so on).

**Any AG-UI endpoint.** A URL without `--model` is treated as an AG-UI agent and proxied as
is:

```bash
loquent serve http://localhost:9000/agent
```

`loquent serve TARGET` accepts a URL, `path/to/file.py:attr` or `package.module:attr`. Run
`loquent serve --help` for all flags.

## Mounting in FastAPI

`loquent.App` is an ASGI app, so you can mount it into an existing FastAPI or Starlette
application:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from loquent import App

from my_project.agent import agent

chat = App(agent, app_name="Support")

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with chat.lifespan():  # mounted apps don't get lifespan events; run it here
        yield

api = FastAPI(lifespan=lifespan)
api.mount("/chat", chat)
```

The UI is then served at `/chat/`. The mount prefix is picked up automatically. `App`
accepts every [setting](#settings) as a keyword argument. Without the `lifespan` hook the
store still opens lazily on the first request; the hook adds a clean shutdown.

`loquent.serve` and `loquent serve` refuse to bind a public address with `auth=none`. When
you run `App` under your own server (uvicorn, gunicorn), `App` still protects itself: with
`auth=none` it answers `403 {"error": "forbidden"}` to every API request from a client that
is not on loopback (`127.0.0.0/8`, `::1`), unless you set `insecure_no_auth=True`. With
`auth="password"`, `App(...)` raises `InsecureConfigError` unless `secret_key` is set, so
every worker signs sessions with the same key.

## Interactive widgets

Loquent declares three frontend tools on every run: `loquent_confirm`, `loquent_select` and
`loquent_form`. Any agent that supports AG-UI frontend tools, an OpenAI-compatible model
included, can call them like ordinary tools. Plain functions get a shortcut: yield
`ui.ask(...)`.

Some backends reject tools outright (Ollama models without tool support, vLLM without auto
tool choice). Turn the widget tools off with `--no-widgets` (`LOQUENT_WIDGETS=false`,
`widgets=False`): no tools are sent and the UI is told widgets are off. Even with widgets
on, if an OpenAI-compatible endpoint answers HTTP 400 to a request that carried tools, the
adapter retries it once without tools and logs a warning on the `loquent.adapters` logger.

```python
from loquent import ui
from loquent.ui import Confirm, Form, Select

async def agent(messages, ctx):
    answer = ctx.answer
    if answer and answer.key == "refund":
        if answer.value == {"confirmed": True}:
            issue_refund(42)
            yield "Refunded."
        else:
            yield "OK, no refund."
        return

    if "refund" in messages[-1].content:
        yield "Let me check that order. "
        yield ui.ask(Confirm("Refund $42?", key="refund"))
        return

    yield "How can I help?"
```

The widgets:

| Widget | Example | `answer.value` |
|---|---|---|
| `Confirm(message, key=None, confirm_label="Approve", reject_label="Reject")` | `Confirm("Refund $42?", key="refund")` | `{"confirmed": True}` or `{"confirmed": False}` |
| `Select(message, options, multiple=False, key=None)` | `Select("Which plan?", ["basic", ("pro", "Pro plan")], key="plan")` | `{"value": "pro"}`, or `{"values": [...]}` with `multiple=True` |
| `Form(message, schema, key=None)` | `Form("Shipping address", {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}, key="addr")` | `{"values": {"city": "Lisbon"}}` |

`Select` takes 1 to 20 options; each is a string or a `(value, label)` pair, and values must
be unique. A `Form` schema is a flat JSON Schema object whose fields are `string`, `number`,
`integer`, `boolean`, or a non-empty `enum` of strings, and every name in `required` must be
one of its `properties`. Both raise `ValueError` when constructed with anything else, since
the UI couldn't display it. Loquent validates every answer against its widget before your
agent sees it.

How the round trip works:

1. `yield ui.ask(...)` sends the widget to the UI and **ends the run**. Your generator is
   closed at that point.
2. When the user answers, Loquent calls your function again with the full history, which now
   includes the answer.
3. `ctx.answer` returns the answer when the last message answers a widget, and `None`
   otherwise. It has `.key` (the `key` you passed), `.tool` (the widget tool name) and
   `.value`.

There is no replay or resume magic. Each call runs your function from the top, so code
before the `ask` runs once per call: in the example above, "Let me check that order." is
produced by the first call only, and `issue_refund` runs only in the second. Keep side
effects behind the `ctx.answer` check, as the example does.

### The run context

The optional second parameter, `ctx`, also carries:

- `ctx.thread_id` and `ctx.run_id`
- `ctx.user`: the user, as a `PublicUser` with `.id` and `.username` (never the password
  hash). With `auth=none` it is the single local user.
- `ctx.files`: attachments on the latest message, each with `name`, `content_type`, `size`
  and an async `read()`
- `ctx.forwarded_props`: `{"user": ..., "headers": ..., "query": ...}`. `query` is the page's
  URL query string, and `headers` holds the request headers listed in `forward_headers`.

## Storage

Threads, runs, events and users go to SQLite by default (`./loquent.db`), with no setup.
Uploaded files go to `./loquent-files`.

For production, or for more than one replica, use MongoDB:

```bash
pip install "loquent[mongo]"
export LOQUENT_STORE_URL="mongodb://user:pass@db.example.com:27017"
loquent serve app.py:agent
```

Loquent uses a database named `loquent` on that server and creates its indexes on startup.
You can also pass the URL with `--store URL`, or as `store_url=` in Python.

## Sign-in

By default there is no sign-in, which is allowed only on localhost: Loquent binds only to
localhost and serves only loopback clients. To require a username and password:

```bash
export LOQUENT_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
loquent user add alice          # prompts for the password twice
loquent serve app.py:agent --auth password
```

`loquent user add` writes to the store in `LOQUENT_STORE_URL` (or `--store URL`), so run it
against the same store as the server. Password mode refuses to start without
`LOQUENT_SECRET_KEY`, which signs the session cookies. Passwords are hashed with Argon2.

The session cookie is `SameSite=Lax`, so browsers don't send it to a Loquent embedded in an
iframe on another site. In release 1, password sign-in therefore doesn't work for
cross-site embeds; embed it on the same site, or put your own sign-in in front of it (see
[Extending Loquent](#extending-loquent)).

## Security defaults

- **No accidental public servers.** With `auth=none`, Loquent refuses to bind to anything
  but localhost, and answers `403 forbidden` to API requests from any client that is not on
  loopback (`127.0.0.0/8`, `::1`), unless you pass `--insecure-no-auth`
  (`insecure_no_auth=True`). Behind a trusted proxy the client is the forwarded address, so
  a public visitor reaching a no-auth Loquent through a proxy is refused too.
- **API keys stay on the server.** Backend URLs and keys are never sent to the browser.
- **Signed file URLs.** Uploads are never public. The UI fetches them through signed URLs
  that expire after 5 minutes.
- **Strict Content Security Policy.** Scripts load only from the app's own origin, and
  framing is denied unless you list origins in `frame_ancestors`.
- **CSRF protection.** In password mode every state-changing request must carry the
  session's CSRF token in the `X-Loquent-CSRF` header. In `auth=none` mode, every non-GET
  `/api` request must still send an `X-Loquent-CSRF` header, with any value. JSON bodies
  must be sent as `Content-Type: application/json` in both modes. The built-in UI does all
  of this. If you write your own client against the API, send the header too or you will
  get `403 csrf`.
- **Upload limits.** Size and type are limited by `max_upload_mb` and
  `allowed_upload_types`.
- **Behind a TLS proxy**, list the proxy's address with `--forwarded-allow-ips` (or
  `LOQUENT_FORWARDED_ALLOW_IPS`) so client addresses and the `https` scheme come from the
  `X-Forwarded-*` headers. Only `127.0.0.1` is trusted by default.

## Deployment

The server keeps no session state in memory: run events are written to the store as they
stream, and a client that reconnects, even to another replica, replays them and follows
the run to the end. To run several replicas:

- use a shared store (MongoDB); SQLite is a single-process file
- set the **same** `LOQUENT_SECRET_KEY` on every replica (and every worker, e.g. with
  `gunicorn -w N`). Without it each process signs sessions and file URLs with its own random
  key, so they fail on the other processes.
- point `LOQUENT_FILES_DIR` at storage every replica can read, such as a shared volume

Also:

- **Health check:** `GET /healthz` returns `{"status": "ok"}`, or `503` when the store is
  unreachable. It lives under `root_path` (and under the mount prefix): with
  `--root-path /chat` it is `GET /chat/healthz`.
- **Sub-path hosting:** set `--root-path /chat` (`LOQUENT_ROOT_PATH`) to serve the app
  under a prefix, for example behind a proxy that forwards `/chat/` unchanged. When you
  mount `App` in FastAPI or Starlette, the mount prefix is picked up automatically.

## Theming and branding

The default UI carries no Loquent branding. Make it your own:

```python
loquent.serve(
    agent,
    app_name="Acme Support",
    logo_path="static/acme.svg",
    theme={"accent": "#0a7d5a", "background": "#fbfaf7", "font": "Inter, system-ui, sans-serif"},
    custom_css_path="static/acme.css",
    hide=["thread_list"],
)
```

Or with environment variables. List and dict settings take JSON:

```bash
export LOQUENT_APP_NAME="Acme Support"
export LOQUENT_THEME='{"accent": "#0a7d5a", "radius": "6px"}'
export LOQUENT_HIDE='["thread_list"]'
```

- **`theme`** keys: `accent`, `background`, `surface`, `text`, `muted`, `radius` and `font`.
  Each one sets the CSS variable `--lq-<key>`. Text on the accent color is black or white,
  whichever contrasts more.
- **Dark mode:** your colors carry into dark mode only when you set `background`. Then the
  palette is yours: any missing `text`, `muted` and `surface` are derived from the
  background for contrast, and the light/dark toggle is hidden. Without `background`, your
  colors adjust light mode only, and dark mode uses the built-in dark palette.
- **`logo_path`**: an image file shown in the header (served at `branding/logo`).
- **`custom_css_path`**: a stylesheet served at `branding/custom.css` and loaded after the
  built-in styles, so it can override anything. The UI's classes start with `lq-`.
- **`hide`**: UI parts to hide. `thread_list` removes the chat list sidebar.
- **`app_name`**: shown in the header and the browser tab. The default is `Chat`.

Because of the CSP, fonts, images and stylesheets must come from the app's own origin. A
`font` naming a web font works only if `custom_css_path` loads it with `@font-face` from a
local file.

## Settings

Every setting can be passed as a keyword argument to `loquent.serve` or `App`, or set as an
environment variable. Some also have a CLI flag. Precedence, highest first: CLI flag or
keyword argument, then environment variable, then default. List and dict values in
environment variables are JSON, for example `LOQUENT_CORS_ORIGINS='["https://app.example.com"]'`.

| Setting | Environment variable | CLI flag | Default | Description |
|---|---|---|---|---|
| `host` | `LOQUENT_HOST` | `--host` | `127.0.0.1` | Interface to bind. Anything other than localhost needs `auth=password` or `insecure_no_auth`. |
| `port` | `LOQUENT_PORT` | `--port` | `8000` | Port to listen on. |
| `root_path` | `LOQUENT_ROOT_PATH` | `--root-path` | `""` | Sub-path the app is served under, e.g. `/chat`. |
| `forwarded_allow_ips` | `LOQUENT_FORWARDED_ALLOW_IPS` | `--forwarded-allow-ips` (comma-separated) | `["127.0.0.1"]` | Proxies whose `X-Forwarded-*` headers are trusted. |
| `store_url` | `LOQUENT_STORE_URL` | `--store` | `sqlite:///./loquent.db` | `sqlite:///path.db` or `mongodb://…` (needs `loquent[mongo]`). |
| `files_dir` | `LOQUENT_FILES_DIR` |  | `./loquent-files` | Directory for uploaded files. |
| `auth` | `LOQUENT_AUTH` | `--auth` | `none` | `none` or `password`. |
| `insecure_no_auth` | `LOQUENT_INSECURE_NO_AUTH` | `--insecure-no-auth` | `false` | Allow `auth=none` on a non-localhost bind, and serve non-loopback clients. |
| `secret_key` | `LOQUENT_SECRET_KEY` |  | unset | Signs sessions and file URLs. Required for `auth=password` (also by `App`) and for multiple workers or replicas. Unset: a random key per process. |
| `cors_origins` | `LOQUENT_CORS_ORIGINS` |  | `[]` | Origins allowed to call the API cross-origin (with credentials). |
| `frame_ancestors` | `LOQUENT_FRAME_ANCESTORS` |  | `[]` | CSP `frame-ancestors` sources allowed to embed the UI in an iframe. Empty: `'none'`. |
| `max_upload_mb` | `LOQUENT_MAX_UPLOAD_MB` |  | `20` | Largest accepted upload, in MB. |
| `allowed_upload_types` | `LOQUENT_ALLOWED_UPLOAD_TYPES` |  | see below | Accepted upload content types. The UI refuses other files before uploading. |
| `app_name` | `LOQUENT_APP_NAME` |  | `Chat` | Name shown in the header and the browser tab. |
| `logo_path` | `LOQUENT_LOGO_PATH` |  | unset | Image file shown as the logo. |
| `theme` | `LOQUENT_THEME` |  | `{}` | Design tokens; see [Theming and branding](#theming-and-branding). |
| `custom_css_path` | `LOQUENT_CUSTOM_CSS_PATH` |  | unset | Stylesheet loaded after the built-in styles. |
| `hide` | `LOQUENT_HIDE` |  | `[]` | UI parts to hide. Supported: `thread_list`. |
| `forward_headers` | `LOQUENT_FORWARD_HEADERS` |  | `[]` | Request headers passed to the agent in `ctx.forwarded_props["headers"]`. `Cookie`, `Authorization` and `X-Loquent-CSRF` are never forwarded. |
| `widgets` | `LOQUENT_WIDGETS` | `--no-widgets` | `true` | Offer the widget tools to the agent. Turn off for backends that reject tools. |
| `model` | `LOQUENT_MODEL` | `--model` | unset | With a URL target: the model name, which selects the OpenAI-compatible adapter. |
| `api_key` | `LOQUENT_API_KEY` | `--api-key-env NAME` | unset | API key sent to an OpenAI-compatible backend. Never reaches the browser. |

The default `allowed_upload_types` are `image/png`, `image/jpeg`, `image/gif`, `image/webp`,
`application/pdf`, `text/plain`, `text/markdown`, `text/csv` and `application/json`.

## Extending Loquent

### A custom adapter

Anything with a `run(input, ctx)` async generator and two flags is an adapter; pass it to
`loquent.serve` or `App` like a function or URL. `run` yields AG-UI *content* events (text
messages, tool calls, steps, custom events). Loquent emits `RUN_STARTED`, `RUN_FINISHED` and
`RUN_ERROR` itself and drops any your adapter yields. Raise `AgentError` to end the run with
a message the user sees as is; any other exception shows a generic error and is logged.

```python
from uuid import uuid4

from ag_ui.core import TextMessageContentEvent, TextMessageEndEvent, TextMessageStartEvent

import loquent
from loquent import AgentError, RunContext


class ShoutAdapter:
    supports_widgets = False      # no widget tools are offered to this backend
    supports_attachments = False  # messages with files are refused

    async def run(self, input, ctx: RunContext):
        text = ctx.messages[-1].content if ctx.messages else ""
        if len(text) > 500:
            raise AgentError("That is too long to shout.")  # shown to the user as is
        mid = str(uuid4())
        yield TextMessageStartEvent(message_id=mid, role="assistant")
        yield TextMessageContentEvent(message_id=mid, delta=text.upper())
        yield TextMessageEndEvent(message_id=mid)


loquent.serve(ShoutAdapter())
```

`input` is the AG-UI `RunAgentInput` (with `tools` holding the widget tools when
`supports_widgets` is true), and `ctx` is the [run context](#the-run-context). A
`loquent_*` tool call (`TOOL_CALL_START`/`ARGS`/`END`) shows that widget and ends the run.

### Your own store, file store, sign-in and rate limit

`App` also takes the layers underneath as keyword arguments:

```python
import time
from collections import defaultdict

from loquent import App
from loquent.auth import UNUSABLE_HASH
from loquent.files import LocalFileStore
from loquent.store.sqlite import SqliteStore


class ProxyUserAuth:
    """Trust the user name a reverse proxy sets. Only safe if the proxy is the sole way in."""

    mode = "proxy"  # anything but "password": no login form, CSRF by header presence

    async def current_user(self, request, store):
        name = request.headers.get("x-forwarded-user")
        if not name:
            return None  # answered 401
        user = await store.get_user_by_username(name)
        return user or await store.create_user(name, UNUSABLE_HASH)


_recent: dict[str, list[float]] = defaultdict(list)


async def ten_per_minute(request, user) -> bool:
    """At most 10 runs or uploads per user per minute (in this process)."""
    now = time.monotonic()
    _recent[user.id] = [t for t in _recent[user.id] if now - t < 60] + [now]
    return len(_recent[user.id]) <= 10


app = App(
    agent,
    store=SqliteStore("/var/lib/chat/chat.db"),
    file_store=LocalFileStore("/var/lib/chat/files"),
    authenticator=ProxyUserAuth(),
    rate_limiter=ten_per_minute,
)
```

- **`store=`**: any object implementing `loquent.store.Store` (users, threads, runs, events
  and file metadata). The built-in ones are `SqliteStore(path)` and
  `loquent.store.mongo.MongoStore(url, db_name="loquent")`. Without it, `store_url` decides.
- **`file_store=`**: any object with async `save(file_id, chunks, max_bytes) -> int`,
  `read(file_id) -> bytes` and `delete(file_id)` (`loquent.files.FileStore`). The default is
  `LocalFileStore(files_dir)`.
- **`authenticator=`**: an object with a `mode` string and
  `async current_user(request, store) -> User | None` (`loquent.auth.Authenticator`); `None`
  is answered `401`. The mode `"password"` is reserved for the built-in sign-in. The
  loopback-only rule of `auth=none` does not apply to your authenticator, and file URLs are
  still signed with `secret_key`.
- **`rate_limiter=`**: `async (request, user) -> bool`, called before every run start and
  upload; `False` is answered `429 {"error": "rate_limited"}`.

## Known limitations in v1

- **A run on a replica that dies is not resumed.** After 30 seconds without a heartbeat it is
  marked interrupted. The history up to that point is kept, and the user sees a Retry
  button. There is no job queue and no automatic re-run, because agents aren't guaranteed to
  be safe to restart.
- **Files are not deleted with their thread.** Deleting a thread removes its messages and
  runs. Uploaded files stay in `files_dir` and the store.
- **Not yet supported:** Postgres storage, OAuth/OIDC and trusted-header sign-in, built-in
  adapters for agent frameworks (LangGraph, Pydantic AI, OpenAI Agents SDK), and the
  `table`, `chart`, `file_request` and custom widgets. These are planned for release 2.
  Frameworks that already expose an AG-UI endpoint work today through its URL.

## Development

```bash
uv sync                                   # Python deps; builds the UI once if it isn't built
npm --prefix frontend ci
npm --prefix frontend run build           # rebuild the UI into src/loquent/server/static/
uv run pytest -q
npm --prefix frontend test -- --run
npm --prefix frontend run e2e             # builds the UI, then runs Playwright
uv build                                  # sdist + wheel with the bundled UI (needs Node)
```

Set `LOQUENT_SKIP_UI_BUILD=1` to build or install without running npm, for Python-only work.
