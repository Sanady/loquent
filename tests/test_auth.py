from datetime import UTC

import itsdangerous
import pytest
from starlette.requests import Request

from loquent.auth import (
    SESSION_COOKIE,
    ClientForbidden,
    InsecureConfigError,
    NoAuth,
    PasswordAuth,
    SessionManager,
    check_bind_safety,
    hash_password,
    verify_password,
)
from loquent.settings import Settings


class FakeStore:
    def __init__(self):
        self.users = {}

    async def create_user(self, username, password_hash):
        from datetime import datetime

        from loquent.store.models import User

        u = User(id=f"u{len(self.users)}", username=username, password_hash=password_hash,
                 created_at=datetime.now(UTC))
        self.users[u.id] = u
        return u

    async def get_user(self, user_id):
        return self.users.get(user_id)

    async def get_user_by_username(self, username):
        return next((u for u in self.users.values() if u.username == username), None)


def make_request(cookie=None, client=("127.0.0.1", 50000)):
    headers = []
    if cookie is not None:
        headers.append((b"cookie", f"{SESSION_COOKIE}={cookie}".encode()))
    scope = {"type": "http", "headers": headers, "method": "GET", "path": "/", "client": client}
    return Request(scope)


def test_password_hash_roundtrip_and_wrong_password():
    h = hash_password("hunter2")
    assert h != "hunter2"
    assert verify_password(h, "hunter2")
    assert not verify_password(h, "wrong")
    assert not verify_password("not-a-hash", "x")
    assert not verify_password("!", "")
    assert not verify_password("!", "!")


def test_session_tamper_and_expiry_rejected(monkeypatch):
    sm = SessionManager("secret")
    cookie, csrf = sm.issue("u1")
    s = sm.read(cookie)
    assert s is not None and s.user_id == "u1" and s.csrf == csrf
    assert sm.read(cookie[:-2] + "xx") is None
    assert sm.read("garbage") is None
    assert sm.read("") is None
    assert SessionManager("other").read(cookie) is None
    real = itsdangerous.timed.time.time
    monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: real() + 8 * 24 * 3600)
    assert sm.read(cookie) is None


@pytest.mark.parametrize(
    "host,auth,flag,raises",
    [
        ("127.0.0.1", "none", False, False),
        ("::1", "none", False, False),
        ("localhost", "none", False, False),
        ("0.0.0.0", "none", False, True),
        ("example.com", "none", False, True),
        ("0.0.0.0", "none", True, False),
        ("0.0.0.0", "password", False, False),
        ("127.0.0.1", "password", False, False),
        ("LOCALHOST", "none", False, False),
        ("[::1]", "none", False, False),
        ("::", "none", False, True),
        ("127.0.0.2", "none", False, True),
    ],
)
def test_bind_safety_matrix(host, auth, flag, raises):
    s = Settings(host=host, auth=auth, insecure_no_auth=flag, secret_key="k")
    if raises:
        with pytest.raises(InsecureConfigError):
            check_bind_safety(s)
    else:
        check_bind_safety(s)


def test_password_mode_requires_secret_key():
    with pytest.raises(InsecureConfigError):
        check_bind_safety(Settings(auth="password"))
    check_bind_safety(Settings(auth="password", secret_key="k"))


def test_none_mode_without_key_warns(caplog):
    with caplog.at_level("WARNING", logger="loquent.auth"):
        check_bind_safety(Settings())
    assert any("random" in r.message for r in caplog.records)


async def test_no_auth_creates_local_user_once():
    store = FakeStore()
    a = NoAuth()
    assert a.mode == "none"
    u1 = await a.current_user(make_request(), store)
    u2 = await a.current_user(make_request(), store)
    assert u1.username == "local" and u1.id == u2.id
    assert not verify_password(u1.password_hash, "")


async def test_no_auth_refuses_non_loopback_clients_unless_allowed():
    store = FakeStore()
    for client in (("203.0.113.9", 1), ("localhost", 1), None):
        with pytest.raises(ClientForbidden):
            await NoAuth().current_user(make_request(client=client), store)
    user = await NoAuth(allow_remote=True).current_user(make_request(client=("8.8.8.8", 1)), store)
    assert user.username == "local"
    assert (await NoAuth().current_user(make_request(client=("::1", 1)), store)).id == user.id


async def test_password_auth_current_user():
    store = FakeStore()
    user = await store.create_user("bob", hash_password("pw"))
    sm = SessionManager("secret")
    a = PasswordAuth(sm)
    assert a.mode == "password"
    cookie, _ = sm.issue(user.id)
    assert (await a.current_user(make_request(cookie), store)).id == user.id
    assert await a.current_user(make_request(), store) is None
    assert await a.current_user(make_request("garbage"), store) is None
    gone, _ = sm.issue("deleted")
    assert await a.current_user(make_request(gone), store) is None


def test_empty_secret_key_treated_as_missing(caplog):
    with pytest.raises(InsecureConfigError):
        check_bind_safety(Settings(auth="password", secret_key=""))
    s = Settings(secret_key="")
    assert len(s.effective_secret()) >= 32


def test_insecure_override_logs_warning(caplog):
    with caplog.at_level("WARNING", logger="loquent.auth"):
        check_bind_safety(Settings(host="0.0.0.0", insecure_no_auth=True, secret_key="k"))
    assert any("insecure_no_auth" in r.message for r in caplog.records)


async def test_no_auth_concurrent_first_requests():
    import asyncio

    class RacyStore(FakeStore):
        async def get_user_by_username(self, username):
            r = await super().get_user_by_username(username)
            await asyncio.sleep(0)
            return r

        async def create_user(self, username, password_hash):
            if await FakeStore.get_user_by_username(self, username):
                raise ValueError("duplicate")
            return await super().create_user(username, password_hash)

    store = RacyStore()
    a = NoAuth()
    u1, u2 = await asyncio.gather(
        a.current_user(make_request(), store), a.current_user(make_request(), store)
    )
    assert u1.username == "local" and u1.id == u2.id
