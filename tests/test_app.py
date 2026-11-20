import httpx
from fastapi import FastAPI
from starlette.applications import Starlette
from starlette.routing import Mount

from loquent import App, serve
from loquent.server import static as static_mod
from loquent.settings import Settings

MISSING = "UI assets missing: build with `npm run build` in frontend/"


def echo(messages):
    return f"echo: {messages[-1].content}"


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def fake_ui(tmp_path, monkeypatch):
    d = tmp_path / "static"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<html><head><title>x</title></head><body></body></html>")
    (d / "assets" / "a.js").write_text("console.log(1)")
    monkeypatch.setattr(static_mod, "STATIC_DIR", d)
    return d


def settings(tmp_path, **kw):
    return Settings(store_url=f"sqlite:///{tmp_path}/t.db", files_dir=str(tmp_path / "f"), **kw)


async def test_missing_ui_returns_503_message(tmp_path, monkeypatch):
    monkeypatch.setattr(static_mod, "STATIC_DIR", tmp_path / "nope")
    app = App(echo, settings=settings(tmp_path))
    async with app.lifespan(), client_for(app) as c:
        r = await c.get("/")
        assert r.status_code == 503
        assert r.text == MISSING
        assert (await c.get("/healthz")).json() == {"status": "ok"}


async def test_index_injects_base_href(tmp_path, monkeypatch):
    fake_ui(tmp_path, monkeypatch)
    app = App(echo, settings=settings(tmp_path))
    async with app.lifespan(), client_for(app) as c:
        r = await c.get("/")
        assert r.status_code == 200
        assert '<head><base href="/">' in r.text
        r = await c.get("/some/spa/route")
        assert '<base href="/">' in r.text
        assert (await c.get("/assets/a.js")).text == "console.log(1)"
        r = await c.get("/api/nope")
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
        assert (await c.get("/branding/logo")).status_code == 404
        assert (await c.get("/branding/custom.css")).status_code == 404
        assert (await c.get("/assets/%2e%2e/index.html")).status_code == 404
        assert (await c.get("/assets/a%00.js")).status_code == 404


async def test_base_href_with_settings_root_path(tmp_path, monkeypatch):
    fake_ui(tmp_path, monkeypatch)
    app = App(echo, settings=settings(tmp_path, root_path="/chat"))
    async with app.lifespan(), client_for(app) as c:
        assert '<base href="/chat/">' in (await c.get("/chat/")).text
        assert (await c.get("/chat/healthz")).status_code == 200


async def test_branding_files(tmp_path, monkeypatch):
    fake_ui(tmp_path, monkeypatch)
    (tmp_path / "l.png").write_bytes(b"\x89PNG")
    (tmp_path / "c.css").write_text("body{}")
    app = App(
        echo,
        settings=settings(
            tmp_path, logo_path=tmp_path / "l.png", custom_css_path=tmp_path / "c.css"
        ),
    )
    async with app.lifespan(), client_for(app) as c:
        assert (await c.get("/branding/logo")).content == b"\x89PNG"
        r = await c.get("/branding/custom.css")
        assert r.text == "body{}" and "css" in r.headers["content-type"]
        assert (await c.get("/api/config")).json()["logo_url"] == "branding/logo"


async def test_app_mounts_inside_fastapi_or_starlette_under_prefix(tmp_path, monkeypatch):
    fake_ui(tmp_path, monkeypatch)
    for outer in (
        Starlette(routes=[Mount("/chat", app=App(echo, settings=settings(tmp_path)))]),
        _fastapi(tmp_path),
    ):
        async with client_for(outer) as c:
            assert (await c.get("/chat/healthz")).json() == {"status": "ok"}
            r = await c.get("/chat/")
            assert '<base href="/chat/">' in r.text
            assert (await c.get("/chat/assets/a.js")).status_code == 200
            assert (await c.get("/chat/api/config")).status_code == 200
            assert (await c.get("/chat/api/zzz")).status_code == 404


def _fastapi(tmp_path):
    (tmp_path / "x").mkdir()
    outer = FastAPI()
    outer.mount("/chat", App(echo, settings=settings(tmp_path / "x")))
    return outer


async def test_overrides_and_injected_layers(tmp_path):
    s = settings(tmp_path)
    app = App(echo, settings=s, app_name="Hi")
    assert app.settings.app_name == "Hi" and s.app_name == "Chat"
    app2 = App(echo, app_name="Yo", store_url=f"sqlite:///{tmp_path}/u.db")
    assert app2.settings.app_name == "Yo"


def test_serve_passes_proxy_options_to_uvicorn(monkeypatch, tmp_path):
    import uvicorn

    calls = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: calls.update(app=app, **kw))
    serve(
        echo,
        port=9123,
        forwarded_allow_ips=["10.0.0.1", "10.0.0.2"],
        store_url=f"sqlite:///{tmp_path}/s.db",
    )
    assert calls["proxy_headers"] is True
    assert calls["forwarded_allow_ips"] == "10.0.0.1,10.0.0.2"
    assert calls["port"] == 9123 and calls["host"] == "127.0.0.1"


def test_serve_refuses_public_bind_without_auth(monkeypatch):
    import pytest
    import uvicorn

    from loquent.auth import InsecureConfigError

    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: None)
    with pytest.raises(InsecureConfigError):
        serve(echo, host="0.0.0.0")


async def test_base_injected_after_head_with_attributes(tmp_path, monkeypatch):
    d = fake_ui(tmp_path, monkeypatch)
    (d / "index.html").write_text('<HTML><HEAD lang="en"><title>x</title></HEAD></HTML>')
    app = App(echo, settings=settings(tmp_path))
    async with app.lifespan(), client_for(app) as c:
        assert '<HEAD lang="en"><base href="/">' in (await c.get("/")).text


def test_unknown_override_rejected_and_validated(tmp_path):
    import pytest
    from pydantic import ValidationError

    s = settings(tmp_path)
    with pytest.raises(TypeError):
        App(echo, settings=s, nonsense=1)
    with pytest.raises(ValidationError):
        App(echo, settings=s, port="abc")


def test_unknown_override_rejected_without_settings():
    import pytest

    with pytest.raises(TypeError, match="nonsense"):
        App(echo, nonsense=1)


def test_app_password_mode_requires_secret_key(tmp_path):
    import pytest

    from loquent.auth import InsecureConfigError

    with pytest.raises(InsecureConfigError, match="SECRET_KEY"):
        App(echo, settings=settings(tmp_path, auth="password"))
    with pytest.raises(InsecureConfigError):
        App(echo, settings=settings(tmp_path, auth="password", secret_key=""))
    with pytest.raises(InsecureConfigError):
        App(echo, auth="password", store_url=f"sqlite:///{tmp_path}/p.db")
    App(echo, settings=settings(tmp_path, auth="password", secret_key="k" * 32))  # fine


def remote_client(app, host):
    transport = httpx.ASGITransport(app=app, client=(host, 4321))
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_app_none_mode_serves_only_loopback_clients(tmp_path):
    app = App(echo, settings=settings(tmp_path))
    async with app.lifespan():
        for host in ("203.0.113.7", "10.0.0.2", "::ffff:198.51.100.1", "testserver"):
            async with remote_client(app, host) as c:
                r = await c.get("/api/auth/me")
                assert r.status_code == 403, host
                assert r.json() == {"error": "forbidden"}
                r = await c.post(
                    "/api/runs",
                    json={"input": {"type": "message", "content": "hi"}},
                    headers={"X-Loquent-CSRF": "1"},
                )
                assert r.status_code == 403
        for host in ("127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"):
            async with remote_client(app, host) as c:
                assert (await c.get("/api/auth/me")).status_code == 200, host
        async with remote_client(app, "203.0.113.7") as c:  # public routes stay public
            assert (await c.get("/healthz")).status_code == 200
            assert (await c.get("/api/config")).status_code == 200


async def test_app_none_mode_insecure_no_auth_serves_remote_clients(tmp_path):
    app = App(echo, settings=settings(tmp_path, insecure_no_auth=True))
    async with app.lifespan(), remote_client(app, "203.0.113.7") as c:
        assert (await c.get("/api/auth/me")).status_code == 200


async def test_app_none_mode_uses_proxy_resolved_client(tmp_path):
    """Behind uvicorn's proxy-headers middleware the forwarded client address is checked."""
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

    app = App(echo, settings=settings(tmp_path))
    proxied = ProxyHeadersMiddleware(app, trusted_hosts=["127.0.0.1"])
    async with app.lifespan(), remote_client(proxied, "127.0.0.1") as c:
        r = await c.get("/api/auth/me", headers={"X-Forwarded-For": "203.0.113.7"})
        assert r.status_code == 403
        assert (await c.get("/api/auth/me")).status_code == 200
        r = await c.get("/api/auth/me", headers={"X-Forwarded-For": "127.0.0.1"})
        assert r.status_code == 200
