import asyncio

from srv import make_client, run_message, sse_events

from loquent.adapters.agui_http import AgUiHttpAdapter
from loquent.settings import Settings


async def test_healthz_ok():
    async with make_client() as c:
        r = await c.get("/healthz")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


async def test_healthz_503_when_store_down():
    async with make_client() as c:

        async def down():
            return False

        c.store.ping = down
        r = await c.get("/healthz")
        assert r.status_code == 503

        async def boom():
            raise RuntimeError("db gone")

        c.store.ping = boom
        r = await c.get("/healthz")
        assert r.status_code == 503
        assert "db gone" not in r.text


async def test_config_has_no_secrets():
    upstream = "http://upstream.internal:9999/agent"
    settings = Settings(
        api_key="sk-very-secret-key-123",
        model="gpt-test",
        app_name="Acme Help",
        theme={"accent": "#ff0000"},
        hide=["thread_list"],
    )
    adapter = AgUiHttpAdapter(upstream)
    async with make_client(adapter=adapter, settings=settings) as c:
        r = await c.get("/api/config")
        assert r.status_code == 200
        body = r.json()
        assert "sk-very-secret-key-123" not in r.text
        assert "upstream.internal" not in r.text
        assert set(body) == {
            "app_name", "logo_url", "theme", "hide", "auth", "widgets", "attachments",
            "max_upload_mb",
        }  # fmt: skip
        assert body["app_name"] == "Acme Help"
        assert body["logo_url"] is None
        assert body["theme"] == {"accent": "#ff0000"}
        assert body["hide"] == ["thread_list"]
        assert body["auth"] == "none"
        assert body["max_upload_mb"] == 20
        assert isinstance(body["widgets"], bool)
        assert body["attachments"] is False  # no file store configured yet


async def test_security_headers_present():
    async with make_client() as c:
        for path in ("/healthz", "/api/config", "/api/threads", "/api/does-not-exist"):
            r = await c.get(path)
            assert r.headers["content-security-policy"] == (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'"
            )
            assert r.headers["x-content-type-options"] == "nosniff"
            assert r.headers["referrer-policy"] == "same-origin"
        # streaming responses get them too
        r = await run_message(c, "hi")
        sse_events(r)
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["cache-control"] == "no-cache"
        assert r.headers["x-accel-buffering"] == "no"

    settings = Settings(frame_ancestors=["https://a.example", "https://b.example"])
    async with make_client(settings=settings) as c:
        r = await c.get("/healthz")
        assert r.headers["content-security-policy"].endswith(
            "frame-ancestors https://a.example https://b.example"
        )


async def test_cors_only_when_configured():
    preflight = {
        "Origin": "https://embed.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-loquent-csrf",
    }
    async with make_client() as c:
        r = await c.get("/api/config", headers={"Origin": "https://embed.example"})
        assert "access-control-allow-origin" not in r.headers
    async with make_client(settings=Settings(cors_origins=["https://embed.example"])) as c:
        r = await c.options("/api/runs", headers=preflight)
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == "https://embed.example"
        assert r.headers["access-control-allow-credentials"] == "true"
        r = await c.get("/api/config", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in r.headers


async def test_root_path_prefix_routes():
    async with make_client(settings=Settings(root_path="/chat")) as c:
        r = await c.get("/chat/healthz")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}
        r = await c.get("/chat/api/config")
        assert r.status_code == 200
        r = await c.post(
            "/chat/api/runs",
            json={"thread_id": None, "input": {"type": "message", "content": "hi"}},
        )
        assert sse_events(r)[-1]["type"] == "RUN_FINISHED"
        r = await c.get("/healthz")
        assert r.status_code == 404


async def test_rate_limiter_false_returns_429():
    calls = []

    async def limiter(request, user):
        calls.append((request.url.path, user.username if user else None))
        return False

    async with make_client(rate_limiter=limiter) as c:
        r = await run_message(c, "hi")
        assert r.status_code == 429
        assert r.json() == {"error": "rate_limited"}
        assert calls == [("/api/runs", "local")]
        r = await c.get("/api/threads")
        assert r.json() == []  # nothing was created

    async def allow(request, user):
        return True

    async with make_client(rate_limiter=allow) as c:
        r = await run_message(c, "hi")
        assert sse_events(r)[-1]["type"] == "RUN_FINISHED"


async def test_lifespan_cancels_live_runs_on_shutdown():
    gate = asyncio.Event()
    entered = asyncio.Event()

    async def slow(messages):
        entered.set()
        await gate.wait()
        return "never"

    async with make_client(slow) as c:
        app = c.app
        task = asyncio.create_task(run_message(c, "hi"))
        await asyncio.wait_for(entered.wait(), 5)
        live = dict(app.state.live_runs)
        assert len(live) == 1
        (handle,) = live.values()
    # lifespan exited: the live task was cancelled before the store closed
    assert handle.task.done()
    await asyncio.wait_for(task, 5)
    assert app.state.live_runs == {}


async def test_unknown_routes_and_methods_are_json():
    async with make_client() as c:
        r = await c.get("/api/nope")
        assert r.status_code == 404
        assert r.json() == {"error": "not_found"}
        r = await c.put("/api/threads")
        assert r.status_code == 405
        assert r.json() == {"error": "method_not_allowed"}
