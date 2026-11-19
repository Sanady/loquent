"""Shared helpers for the HTTP API tests."""

import asyncio
import json
from contextlib import asynccontextmanager

import httpx

from loquent.adapters.function import FunctionAdapter
from loquent.auth import NoAuth, PasswordAuth, SessionManager, hash_password
from loquent.server.app import create_app
from loquent.settings import Settings
from loquent.store.sqlite import SqliteStore

SECRET = "test-secret-key-for-sessions-0123456789"


def echo(messages):
    return f"echo: {messages[-1].content}"


def new_client(app, *, base_url="http://test") -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=base_url)


@asynccontextmanager
async def make_client(
    agent=echo,
    *,
    adapter=None,
    settings: Settings | None = None,
    authenticator=None,
    rate_limiter=None,
    base_url: str = "http://test",
):
    settings = settings or Settings()
    store = SqliteStore(":memory:")
    if authenticator is None:
        if settings.auth == "password":
            authenticator = PasswordAuth(SessionManager(settings.effective_secret()))
        else:
            authenticator = NoAuth()
    app = create_app(
        adapter or FunctionAdapter(agent), settings, store, None, authenticator, rate_limiter
    )
    async with app.router.lifespan_context(app), new_client(app, base_url=base_url) as client:
        client.app = app
        client.store = store
        yield client


def password_settings(**kw) -> Settings:
    return Settings(auth="password", secret_key=SECRET, **kw)


async def add_user(client, username, password="pw-" + "x" * 8):
    return await client.store.create_user(username, hash_password(password))


async def login(client, username, password="pw-" + "x" * 8) -> str:
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["csrf"]


def parse_sse(text: str) -> list[tuple[int, dict]]:
    out = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        seq, data = None, None
        for line in block.split("\n"):
            if line.startswith("id: "):
                seq = int(line[4:])
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        out.append((seq, data))
    return out


async def run_message(client, content, thread_id=None, headers=None, **extra):
    body = {"thread_id": thread_id, "input": {"type": "message", "content": content}}
    body.update(extra)
    r = await client.post("/api/runs", json=body, headers=headers or {})
    return r


def sse_events(r) -> list[dict]:
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/event-stream")
    return [e for _, e in parse_sse(r.text)]


def started(events) -> dict:
    assert events[0]["type"] == "RUN_STARTED"
    return events[0]


async def wait_for(predicate, timeout=5.0):
    async def loop():
        while not predicate():
            await asyncio.sleep(0.005)

    await asyncio.wait_for(loop(), timeout)
