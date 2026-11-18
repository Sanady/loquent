import pytest

from loquent.store.sqlite import SqliteStore


@pytest.fixture(params=["sqlite"])
async def store(request):
    if request.param == "sqlite":
        s = SqliteStore(":memory:")
    await s.init()
    try:
        yield s
    finally:
        await s.close()
