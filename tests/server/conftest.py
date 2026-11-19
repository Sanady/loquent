import pytest

from loquent import runner


@pytest.fixture(autouse=True)
def fast_intervals(monkeypatch):
    monkeypatch.setattr(runner, "CANCEL_POLL_S", 0.01)
    monkeypatch.setattr(runner, "HEARTBEAT_INTERVAL_S", 0.02)
    monkeypatch.setattr(runner, "FLUSH_INTERVAL_S", 0.02)
