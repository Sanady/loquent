"""The "Extending Loquent" examples from the README, run against the real code."""

import time
from collections import defaultdict
from uuid import uuid4

import httpx
from ag_ui.core import TextMessageContentEvent, TextMessageEndEvent, TextMessageStartEvent

from loquent import AgentError, App, RunContext
from loquent.auth import UNUSABLE_HASH
from loquent.files import LocalFileStore
from loquent.store.sqlite import SqliteStore


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


def events(r):
    import json

    return [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]


async def test_readme_extending_examples(tmp_path):
    _recent.clear()
    app = App(
        ShoutAdapter(),
        store=SqliteStore(str(tmp_path / "chat.db")),
        file_store=LocalFileStore(tmp_path / "files"),
        authenticator=ProxyUserAuth(),
        rate_limiter=ten_per_minute,
    )
    transport = httpx.ASGITransport(app=app, client=("203.0.113.5", 1))
    async with app.lifespan(), httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        assert (await c.get("/api/auth/me")).status_code == 401
        h = {"X-Forwarded-User": "ann", "X-Loquent-CSRF": "1"}
        me = (await c.get("/api/auth/me", headers=h)).json()
        assert me["user"]["username"] == "ann"
        config = (await c.get("/api/config")).json()
        assert config["auth"] == "proxy" and config["widgets"] is False

        body = {"input": {"type": "message", "content": "hi"}}
        r = await c.post("/api/runs", json=body, headers=h)
        deltas = [e["delta"] for e in events(r) if e["type"] == "TEXT_MESSAGE_CONTENT"]
        assert deltas == ["hi", "HI"]  # the user's message, then the reply

        body = {"input": {"type": "message", "content": "x" * 501}}
        r = await c.post("/api/runs", json=body, headers=h)
        assert events(r)[-1] == {"type": "RUN_ERROR", "message": "That is too long to shout.",
                                 "code": "agent_error"}  # fmt: skip

        for _ in range(8):
            await c.post("/api/runs", json={"input": {"type": "message", "content": "x"}}, headers=h)
        r = await c.post("/api/runs", json={"input": {"type": "message", "content": "x"}}, headers=h)
        assert r.status_code == 429 and r.json() == {"error": "rate_limited"}
