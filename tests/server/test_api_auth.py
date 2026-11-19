import json

import pytest
from srv import add_user, login, make_client, new_client, password_settings, run_message, sse_events

from loquent.server import routes_auth

PW = "pw-" + "x" * 8


async def test_none_mode_acts_as_local_user():
    async with make_client() as c:
        r = await c.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["username"] == "local"
        assert set(body["user"]) == {"id", "username"}
        assert body["csrf"] == ""
        # no csrf header needed in none mode
        assert sse_events(await run_message(c, "hi"))[-1]["type"] == "RUN_FINISHED"


async def test_password_mode_requires_session_and_csrf():
    async with make_client(settings=password_settings()) as c:
        await add_user(c, "alice")

        # public routes
        assert (await c.get("/api/config")).json()["auth"] == "password"
        assert (await c.get("/healthz")).status_code == 200

        # everything else needs a session
        for method, path in [
            ("GET", "/api/auth/me"),
            ("GET", "/api/threads"),
            ("GET", "/api/threads/x"),
            ("GET", "/api/runs/x/events"),
            ("POST", "/api/runs/x/cancel"),
            ("POST", "/api/auth/logout"),
        ]:
            r = await c.request(method, path)
            assert r.status_code == 401, (method, path)
            assert r.json() == {"error": "unauthorized"}
        r = await run_message(c, "hi")
        assert r.status_code == 401

        # a forged / garbage cookie is still 401 (and 401 comes before the csrf check)
        c.cookies.set("loquent_session", "garbage")
        r = await run_message(c, "hi")
        assert r.status_code == 401
        c.cookies.clear()

        # bad logins
        for u, p in [("alice", "wrong"), ("nobody", PW)]:
            r = await c.post("/api/auth/login", json={"username": u, "password": p})
            assert r.status_code == 401
            assert r.json() == {"error": "unauthorized"}

        # good login sets a hardened cookie
        r = await c.post("/api/auth/login", json={"username": "alice", "password": PW})
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["username"] == "alice"
        assert set(body["user"]) == {"id", "username"}
        csrf = body["csrf"]
        assert csrf
        cookie = r.headers["set-cookie"]
        assert cookie.startswith("loquent_session=")
        assert "HttpOnly" in cookie
        assert "SameSite=lax" in cookie or "SameSite=Lax" in cookie
        assert "Secure" not in cookie

        r = await c.get("/api/auth/me")
        assert r.status_code == 200
        assert r.json()["csrf"] == csrf
        assert r.json()["user"]["username"] == "alice"

        # GET needs no csrf
        assert (await c.get("/api/threads")).status_code == 200

        # non-GET needs the csrf header
        r = await run_message(c, "hi")
        assert r.status_code == 403
        assert r.json() == {"error": "csrf"}
        r = await run_message(c, "hi", headers={"X-Loquent-CSRF": "nope"})
        assert r.status_code == 403
        r = await run_message(c, "hi", headers={"X-Loquent-CSRF": csrf})
        assert sse_events(r)[-1]["type"] == "RUN_FINISHED"

        # logout needs csrf too, then clears the cookie
        assert (await c.post("/api/auth/logout")).status_code == 403
        r = await c.post("/api/auth/logout", headers={"X-Loquent-CSRF": csrf})
        assert r.status_code == 200
        assert "loquent_session=" in r.headers["set-cookie"]
        assert (await c.get("/api/auth/me")).status_code == 401


async def test_login_cookie_secure_on_https():
    async with make_client(settings=password_settings(), base_url="https://test") as c:
        await add_user(c, "alice")
        r = await c.post("/api/auth/login", json={"username": "alice", "password": PW})
        assert r.status_code == 200
        assert "Secure" in r.headers["set-cookie"]


async def test_login_unknown_user_still_verifies_a_hash(monkeypatch):
    calls = []
    real = routes_auth.verify_password

    def spy(h, pw):
        calls.append(h)
        return real(h, pw)

    monkeypatch.setattr(routes_auth, "verify_password", spy)
    async with make_client(settings=password_settings()) as c:
        r = await c.post("/api/auth/login", json={"username": "ghost", "password": "x"})
        assert r.status_code == 401
        assert len(calls) == 1
        assert calls[0].startswith("$argon2")


@pytest.mark.parametrize(
    "body", [b"not json", b"[]", b'{"username": "a"}', b'{"username": 1, "password": "x"}']
)
async def test_login_rejects_bad_bodies(body):
    async with make_client(settings=password_settings()) as c:
        r = await c.post(
            "/api/auth/login", content=body, headers={"content-type": "application/json"}
        )
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_input"}


async def test_json_routes_reject_non_json_content_type():
    async with make_client() as c:
        r = sse_events(await run_message(c, "first"))
        tid = r[0]["threadId"]
        body = '{"thread_id": null, "input": {"type": "message", "content": "hi"}}'
        for ctype in (
            "text/plain",
            "application/x-www-form-urlencoded",
            "multipart/form-data",
            None,
        ):
            headers = {"content-type": ctype} if ctype else {}
            r = await c.post("/api/runs", content=body, headers=headers)
            assert r.status_code == 415, ctype
            assert r.json() == {"error": "unsupported_media_type"}
            r = await c.patch(f"/api/threads/{tid}", content='{"title": "x"}', headers=headers)
            assert r.status_code == 415, ctype
        # charset parameter is fine
        r = await c.patch(
            f"/api/threads/{tid}",
            content='{"title": "renamed"}',
            headers={"content-type": "application/json; charset=utf-8"},
        )
        assert r.status_code == 200
        assert len((await c.get("/api/threads")).json()) == 1  # no new thread was created

    async with make_client(settings=password_settings()) as c:
        await add_user(c, "alice")
        r = await c.post(
            "/api/auth/login",
            content=json.dumps({"username": "alice", "password": PW}),
            headers={"content-type": "text/plain"},
        )
        assert r.status_code == 415


async def test_two_clients_have_separate_sessions():
    async with make_client(settings=password_settings()) as a:
        await add_user(a, "alice")
        await add_user(a, "bob")
        await login(a, "alice")
        async with new_client(a.app) as b:
            await login(b, "bob")
            assert (await a.get("/api/auth/me")).json()["user"]["username"] == "alice"
            assert (await b.get("/api/auth/me")).json()["user"]["username"] == "bob"
