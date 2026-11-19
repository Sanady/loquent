import getpass
import sys
import textwrap

import pytest

from loquent import cli
from loquent.store.sqlite import SqliteStore

AGENT = textwrap.dedent(
    """
    def agent(messages):
        return "hi"
    """
)


@pytest.fixture
def captured(monkeypatch):
    calls = {}

    def fake_serve(agent, **kw):
        calls["agent"] = agent
        calls["kw"] = kw

    monkeypatch.setattr(cli, "serve", fake_serve)
    return calls


def test_cli_loads_file_target(tmp_path, captured):
    f = tmp_path / "myagent.py"
    f.write_text(AGENT)
    assert cli.main(["serve", f"{f}:agent", "--port", "9000"]) == 0
    assert captured["agent"]([]) == "hi"
    assert captured["kw"]["port"] == 9000


def test_cli_loads_module_target(tmp_path, captured, monkeypatch):
    (tmp_path / "climod.py").write_text(AGENT)
    monkeypatch.syspath_prepend(str(tmp_path))
    sys.modules.pop("climod", None)
    assert cli.main(["serve", "climod:agent"]) == 0
    assert captured["agent"]([]) == "hi"


def test_cli_url_target_and_options(captured, monkeypatch):
    monkeypatch.setenv("MY_KEY", "sk-secret")
    rc = cli.main(
        [
            "serve",
            "http://x/v1",
            "--model",
            "m",
            "--api-key-env",
            "MY_KEY",
            "--auth",
            "none",
            "--forwarded-allow-ips",
            "1.2.3.4,5.6.7.8",
            "--root-path",
            "/c",
            "--store",
            "sqlite:///a.db",
        ]
    )
    assert rc == 0
    assert captured["agent"] == "http://x/v1"
    kw = captured["kw"]
    assert kw["api_key"] == "sk-secret" and kw["model"] == "m"
    assert kw["forwarded_allow_ips"] == ["1.2.3.4", "5.6.7.8"]
    assert kw["root_path"] == "/c" and kw["store_url"] == "sqlite:///a.db"
    assert "host" not in kw  # unset flags do not override env/defaults


def test_cli_missing_api_key_env(captured, monkeypatch, capsys):
    monkeypatch.delenv("NOPE_KEY", raising=False)
    assert cli.main(["serve", "http://x", "--api-key-env", "NOPE_KEY"]) == 2
    assert "NOPE_KEY" in capsys.readouterr().err


def test_cli_bad_target(captured, capsys):
    assert cli.main(["serve", "nonexistent_mod_xyz:agent"]) == 2
    assert cli.main(["serve", "/no/such/file.py:agent"]) == 2


def test_cli_refuses_public_bind_without_auth(tmp_path, monkeypatch, capsys):
    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: pytest.fail("must not start"))
    f = tmp_path / "a.py"
    f.write_text(AGENT)
    rc = cli.main(["serve", f"{f}:agent", "--host", "0.0.0.0"])
    assert rc == 2
    assert "--insecure-no-auth" in capsys.readouterr().err


def test_cli_public_bind_allowed_with_flag(tmp_path, monkeypatch):
    import uvicorn

    ran = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, **k: ran.update(k))
    f = tmp_path / "a.py"
    f.write_text(AGENT)
    rc = cli.main(
        [
            "serve",
            f"{f}:agent",
            "--host",
            "0.0.0.0",
            "--insecure-no-auth",
            "--store",
            f"sqlite:///{tmp_path}/x.db",
        ]
    )
    assert rc == 0 and ran["host"] == "0.0.0.0"


async def _users(url):
    store = SqliteStore(url)
    await store.init()
    try:
        return await store.get_user_by_username("alice")
    finally:
        await store.close()


def test_cli_user_add_creates_user(tmp_path, monkeypatch):
    import asyncio

    db = tmp_path / "u.db"
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": "s3cret-pass")
    assert cli.main(["user", "add", "alice", "--store", f"sqlite:///{db}"]) == 0
    u = asyncio.run(_users(str(db)))
    assert u is not None and u.password_hash != "s3cret-pass"
    assert cli.main(["user", "add", "alice", "--store", f"sqlite:///{db}"]) == 2  # duplicate


def test_cli_user_add_mismatch_or_empty(tmp_path, monkeypatch):
    answers = iter(["a", "b"])
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": next(answers))
    assert cli.main(["user", "add", "bob", "--store", f"sqlite:///{tmp_path}/m.db"]) == 2
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": "")
    assert cli.main(["user", "add", "bob", "--store", f"sqlite:///{tmp_path}/m.db"]) == 2


def test_cli_user_add_uses_env_store(tmp_path, monkeypatch):
    import asyncio

    db = tmp_path / "e.db"
    monkeypatch.setenv("LOQUENT_STORE_URL", f"sqlite:///{db}")
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": "pw-pw-pw-1")
    assert cli.main(["user", "add", "alice"]) == 0
    assert asyncio.run(_users(str(db))) is not None
