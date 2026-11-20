"""The mongo fixture fails (not skips) under CI, and the `mongo` marker deselects it."""

from pathlib import Path

pytest_plugins = ["pytester"]

CONFTEST = Path(__file__).with_name("conftest.py")

TEST = """
async def test_uses_store(store):
    assert store is not None
"""

INI = """
[pytest]
asyncio_mode = auto
asyncio_default_fixture_loop_scope = function
markers =
    mongo: needs a real MongoDB
"""


def _setup(pytester):
    pytester.makeini(INI)
    pytester.makeconftest(CONFTEST.read_text())  # the real fixture code
    pytester.makepyfile(test_x=TEST)


def test_mongo_fixture_fails_not_skips_under_ci(pytester, monkeypatch):
    monkeypatch.setenv("CI", "true")
    monkeypatch.setenv("LOQUENT_TEST_MONGO_URL", "mongodb://127.0.0.1:1")
    _setup(pytester)
    res = pytester.runpytest("-k", "mongo")
    res.assert_outcomes(
        errors=1, skipped=0, failed=0
    )  # pytest.fail in a fixture reports as an error


def test_mongo_fixture_skips_without_ci(pytester, monkeypatch):
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setenv("LOQUENT_TEST_MONGO_URL", "mongodb://127.0.0.1:1")
    _setup(pytester)
    res = pytester.runpytest("-k", "mongo")
    res.assert_outcomes(skipped=1)


def test_ping_timeout_env_is_honoured(pytester, monkeypatch):
    monkeypatch.setenv("CI", "true")
    monkeypatch.setenv("LOQUENT_TEST_MONGO_TIMEOUT_S", "0.2")
    monkeypatch.setenv("LOQUENT_TEST_MONGO_URL", "mongodb://10.255.255.1:27017")  # black hole
    _setup(pytester)
    res = pytester.runpytest("-k", "mongo")
    res.assert_outcomes(errors=1, skipped=0, failed=0)
    assert res.duration < 5  # the default 10 s would blow past this


def test_not_mongo_marker_deselects_all_mongo_params(pytester):
    _setup(pytester)
    res = pytester.runpytest("--collect-only", "-q", "-m", "not mongo")
    out = res.stdout.str()
    assert "sqlite" in out
    assert "mongo" not in out.replace("not mongo", "")
