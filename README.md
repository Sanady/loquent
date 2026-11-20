# Loquent

**Chat UI for any LLM or AI agent, in a few lines of Python.**

[![CI](https://github.com/Sanady/loquent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Sanady/loquent/actions/workflows/ci.yml)
[![PyPI version](https://img.shields.io/pypi/v/loquent)](https://pypi.org/project/loquent/)
[![Python versions](https://img.shields.io/pypi/pyversions/loquent)](https://pypi.org/project/loquent/)
[![License](https://img.shields.io/github/license/Sanady/loquent)](https://github.com/Sanady/loquent/blob/main/LICENSE)

Loquent gives your LLM app or AI agent a polished, streaming chat interface: point it at a
Python function, an OpenAI-compatible API (OpenAI, Ollama, vLLM, LiteLLM) or any
[AG-UI](https://docs.ag-ui.com) endpoint, and `pip install loquent` is all the frontend you
need. It is an open-source alternative to Chainlit that speaks AG-UI, the open agent-to-UI
protocol, and lets the agent draw UI (approve/reject buttons, choices, forms) in the middle
of a conversation.

![Loquent chat UI in the light theme: a sidebar with the chat list, a streamed assistant reply, and an agent-drawn "Refund $42?" confirm widget with Approve and Reject buttons](https://raw.githubusercontent.com/Sanady/loquent/main/docs/assets/loquent-chat.png)

## Why Loquent

- **No lock-in.** Loquent talks to agents over AG-UI, the open protocol, so your agent code
  doesn't need to import Loquent (a plain function imports it only to draw widgets).
  Leaving costs nothing.
- **The agent can draw UI.** Mid-conversation it can ask the user to confirm, pick from a
  list or fill in a form, then continue with the validated answer.
- **Production defaults.** The server is stateless, so you can run several replicas behind a
  load balancer on a shared MongoDB. It refuses to serve the public without sign-in, keeps
  API keys on the server, and ships a strict Content Security Policy and CSRF protection.
- **No Node needed.** The wheel contains the prebuilt React UI. Threads, history, stop and
  regenerate, Markdown with code and math, light and dark themes, optional password
  sign-in, and file uploads for agents written as Python functions all come with it.

## Quickstart

```bash
pip install loquent
```

Python 3.11 or newer.

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

## Coming from Chainlit?

Chainlit's repository was archived on 2026-10-15. If you are looking for a maintained
successor for a Chainlit app, most concepts map directly. Loquent is an independent project,
not affiliated with Chainlit.

| Chainlit | Loquent |
|---|---|
| `chainlit run app.py` | `loquent serve app.py:agent` |
| `@cl.on_message` handler | A plain function, `async def agent(messages, ctx)`, usually an async generator. It receives the whole conversation, not just the new message. |
| `cl.Message(...).send()`, `stream_token` | `yield "some text"` streams it; returning a string also works. |
| `cl.Step` | Yield AG-UI `StepStartedEvent` / `StepFinishedEvent` (shown as collapsible activity rows), or leave steps out. |
| `cl.AskUserMessage`, `cl.AskActionMessage` | `yield ui.ask(Confirm(...))`, `Select(...)` or `Form(...)`. The answer arrives in `ctx.answer` on the next call (see [the round trip](#interactive-widgets)). |
| Data layer (persisting threads) | Built in: SQLite by default, MongoDB with `LOQUENT_STORE_URL`, or your own `store=` object. |
| `@cl.password_auth_callback` | `loquent serve --auth password`, with users created by `loquent user add` (Argon2 hashes in the store). |
| Other auth callbacks (header auth, custom logic) | A custom `authenticator=` object (see [Extending Loquent](#extending-loquent)). |
| Files attached to a message | `ctx.files`, each with `name`, `content_type`, `size` and an async `read()`. |
| Theme and branding in the config file | `app_name`, `logo_path`, `theme`, `custom_css_path`, `hide` (see [Theming](#theming-and-branding)). |

A step, as a plain function:

```python
from ag_ui.core import StepFinishedEvent, StepStartedEvent


async def agent(messages):
    yield StepStartedEvent(step_name="Looking up the order")
    order = await find_order(messages[-1].content)  # your code
    yield StepFinishedEvent(step_name="Looking up the order")
    yield f"Order {order.id} shipped on {order.shipped_on}."
```

Two differences to plan for:

- **An ask ends the run.** Chainlit's `await cl.AskActionMessage(...).send()` pauses your handler
  until the user answers. In Loquent, `yield ui.ask(...)` ends the run, and your function is
  called again with the answer. Keep side effects behind the `ctx.answer` check.
- **No session object.** There is no `cl.user_session`. Key any state you keep by
  `ctx.thread_id` or `ctx.user.id`.

What release 1 does not have yet, among others:

- lifecycle hooks such as `@cl.on_chat_start`, welcome messages and starters
- chat settings and chat profiles (`cl.ChatSettings`)
- message feedback
- audio
- rich elements such as `cl.Image`, `cl.Pdf` and `cl.Plotly`, and a file-request widget
  like `cl.AskFileMessage`
- OAuth/OIDC sign-in and Postgres storage
- built-in adapters for agent frameworks (LangGraph, Pydantic AI, OpenAI Agents SDK);
  frameworks that already expose an AG-UI endpoint work today through its URL
- an importer for threads stored by Chainlit

## Use with OpenAI, Ollama, vLLM and AG-UI agents

Agents behind a URL (the OpenAI-compatible and AG-UI adapters below) don't take file
attachments, so the UI hides the attach button for them. To accept uploads, write the agent
as a [plain Python function](#a-plain-python-function-any-sdk-or-framework) or a
[custom adapter](#a-custom-adapter) and read them from `ctx.files`.

### OpenAI or any OpenAI-compatible API

The [quickstart](#quickstart) shows the command line. From Python, the same settings are
keyword arguments:

```python
import os

import loquent

loquent.serve("https://api.openai.com/v1", model="gpt-4o", api_key=os.environ["OPENAI_API_KEY"])
```

Any server that implements `/chat/completions` with streaming works the same way: change the
base URL and the model name.

### Ollama (local LLMs)

Ollama serves an OpenAI-compatible API at `http://localhost:11434/v1` and needs no API key:

```bash
ollama pull llama3.2
loquent serve http://localhost:11434/v1 --model llama3.2
```

If the model you pull has no tool support, add `--no-widgets`
([why](#interactive-widgets)):

```bash
loquent serve http://localhost:11434/v1 --model llama3.2 --no-widgets
```

### vLLM

vLLM's OpenAI-compatible server is under `/v1`. Its default port, 8000, is also Loquent's,
so move one of them:

```bash
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8001
loquent serve http://localhost:8001/v1 --model Qwen/Qwen2.5-7B-Instruct --no-widgets
```

vLLM rejects requests with tools unless it was started with `--enable-auto-tool-choice`
and a `--tool-call-parser` that fits the model ([why that matters](#interactive-widgets)).
Start it that way and drop `--no-widgets` to get the widgets. If you started vLLM with
`--api-key`, pass the key with `--api-key-env`.

### Any AG-UI agent (LangGraph, Pydantic AI and others)

Run your agent behind an AG-UI endpoint and point Loquent at the URL:

```bash
loquent serve http://localhost:9000/agent
```

LangGraph, Pydantic AI and other frameworks expose an AG-UI endpoint through their own
AG-UI adapters; follow their docs to serve one. Loquent proxies the events as they stream
and declares the widget tools as AG-UI frontend tools, so an agent that calls them gets
the user's answer back as a tool result.

### A plain Python function (any SDK or framework)

Anything you can call from Python works: wrap it in a function. Here with the OpenAI SDK
(`pip install openai`):

```python
# app.py
from openai import AsyncOpenAI

import loquent

client = AsyncOpenAI()  # reads OPENAI_API_KEY


async def agent(messages):
    history = [
        {"role": m.role, "content": m.content}
        for m in messages
        if m.role in ("user", "assistant") and isinstance(m.content, str)
    ]
    stream = await client.chat.completions.create(model="gpt-4o", messages=history, stream=True)
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


if __name__ == "__main__":
    loquent.serve(agent)
```

Sync functions and sync generators work too; Loquent runs them in a worker thread so they
never block the server.

## Loquent vs Chainlit, Gradio and Open WebUI

How Loquent compares with other ways to put a chat UI on an LLM. Claims about other projects
are kept conservative; "—" means we haven't verified it.

| | Loquent | Chainlit | Gradio `ChatInterface` | Open WebUI |
|---|---|---|---|---|
| What it is | Python library: a chat UI for your agent or model | Python framework for chat apps | Chat component of the Gradio library | Self-hosted chat application |
| Install | `pip install loquent` | `pip install chainlit` | `pip install gradio` | `pip install open-webui` or Docker |
| Agent-drawn UI (confirm, select, form) | Yes | Ask messages (text, actions, files) | — | — |
| AG-UI protocol | Yes | — | — | — |
| Multiple replicas | Yes (shared MongoDB) | — | — | Yes (Postgres + Redis) |
| Self-hosted auth | Password, or your own authenticator | Password, OAuth and header callbacks | Basic username/password | Built-in user accounts |
| Maintenance status | Active (alpha) | Archived 2026-10-15 | — | — |

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
is not on loopback (`127.0.0.0/8`, `::1`), unless you set `insecure_no_auth=True`. Starlette's
`TestClient` (host `testclient`) counts as local. Behind a reverse proxy this check is only
as good as the client address the proxy reports, so use `auth="password"` there (see
[Security defaults](#security-defaults)). With `auth="password"`, `App(...)` raises
`InsecureConfigError` unless `secret_key` is set, so every worker signs sessions with the same key.

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
  (`insecure_no_auth=True`). **Behind a reverse proxy, use `--auth password`**, and don't
  rely on `auth=none` there. The loopback rule judges the client address the proxy reports, so it protects you only if the
  proxy sets or appends the real client IP in `X-Forwarded-For`. A proxy on the same host
  that sends no `X-Forwarded-For` (nginx `proxy_pass` adds none by default) makes every
  visitor look like `127.0.0.1`, and a trusted proxy that passes a client-supplied
  `X-Forwarded-For` through unmodified lets clients spoof their address, `127.0.0.1`
  included.
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
  `X-Forwarded-*` headers. Only `127.0.0.1` is trusted by default, so a proxy on the same
  host is trusted without configuration.

## Deployment

The server keeps no session state in memory: run events are written to the store as they
stream, and a client that reconnects, even to another replica, replays them and follows
the run to the end. To run several replicas:

- use a shared store (MongoDB); SQLite is a single-process file
- set the **same** `LOQUENT_SECRET_KEY` on every replica (and every worker, e.g. with
  `gunicorn -w N`). Without it each process signs sessions and file URLs with its own random
  key, so they fail on the other processes.
- point `LOQUENT_FILES_DIR` at storage every replica can read, such as a shared volume
- sign users in with `--auth password` or your own authenticator: replicas sit behind a
  load balancer, where `auth=none` is not safe (see [Security defaults](#security-defaults))

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
    supports_widgets = False  # no widget tools are offered to this backend
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

## FAQ

### How do I add a chat UI to my LangGraph agent?

Serve the graph behind an AG-UI endpoint with LangGraph's AG-UI integration, then run
`loquent serve http://localhost:9000/agent` with that URL. Loquent has no LangGraph-specific
adapter in release 1; it talks to the AG-UI endpoint. The same goes for Pydantic AI and
other frameworks with AG-UI support. If your framework has none, call it from a
[plain Python function](#a-plain-python-function-any-sdk-or-framework).

### Is Loquent a Chainlit replacement?

For many Chainlit apps, yes: streaming chat, threads and history, steps, ask-the-user
widgets, file uploads, password sign-in and a persistent data store all have a Loquent
counterpart. Some Chainlit features don't exist yet, among them OAuth sign-in, Postgres
storage, chat settings, message feedback, audio and rich elements. See
[Coming from Chainlit?](#coming-from-chainlit) for the mapping and the full list of gaps.

### Does Loquent work with Ollama or other local LLMs?

Yes. Ollama, vLLM, LiteLLM and other servers with an OpenAI-compatible
`/chat/completions` endpoint work with `--model`, for example
`loquent serve http://localhost:11434/v1 --model llama3.2`. See [Ollama](#ollama-local-llms)
for models without tool support.

### Can users upload files to the chatbot?

Yes, when the agent is a Python function or a custom adapter: it reads the files from
`ctx.files`. Agents behind a URL (OpenAI-compatible or AG-UI) don't take attachments, and
the UI hides the attach button for them. Size and type limits are `max_upload_mb` and
`allowed_upload_types`.

### Can I deploy Loquent with multiple replicas?

Yes. The server keeps no session state in memory, so replicas can sit behind any load
balancer. Use MongoDB as the shared store, the same `LOQUENT_SECRET_KEY` everywhere, and a
files directory every replica can read. See [Deployment](#deployment).

### How do I add login to my chatbot UI?

Set `LOQUENT_SECRET_KEY`, create users with `loquent user add`, and serve with
`--auth password`. To reuse the sign-in you already have (for example a reverse proxy that
sets the user name), pass your own `authenticator=`. See [Sign-in](#sign-in).

### Can I embed the chat UI in my FastAPI app?

Yes. `loquent.App` is an ASGI app: mount it with `api.mount("/chat", App(agent))`. See
[Mounting in FastAPI](#mounting-in-fastapi).

### Do I need Node.js or React?

No. You need Node only to work on Loquent's frontend itself.

### Does my API key reach the browser?

No. Backend URLs and API keys stay on the server; the browser only talks to Loquent.

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
- **Also missing:** start-of-chat hooks, welcome messages and starters, chat settings and
  profiles, message feedback, audio, and rich media elements. See
  [Coming from Chainlit?](#coming-from-chainlit).
- **File uploads need a Python agent.** The OpenAI-compatible and AG-UI URL adapters don't
  take attachments.

## Development

```bash
uv sync                                   # Python deps; builds the UI once if it isn't built
npm --prefix frontend ci
npm --prefix frontend run build           # rebuild the UI into src/loquent/server/static/
uv run pytest -q
npm --prefix frontend test -- --run
npm --prefix frontend run e2e             # builds the UI, then runs Playwright
npm --prefix frontend run screenshot      # retakes docs/assets/loquent-chat.png (after a build)
uv build                                  # sdist + wheel with the bundled UI (needs Node)
```

Set `LOQUENT_SKIP_UI_BUILD=1` to build or install without running npm, for Python-only work.
See [CONTRIBUTING.md](https://github.com/Sanady/loquent/blob/main/CONTRIBUTING.md) for the full workflow.

## License

Loquent is licensed under the [Apache License 2.0](https://github.com/Sanady/loquent/blob/main/LICENSE).
