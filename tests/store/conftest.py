import os
import uuid

import pytest

from loquent.store.sqlite import SqliteStore


def _unusable(reason: str) -> None:
    """No MongoDB: fail under CI (a skipped contract run must never look green), else skip."""
    if os.environ.get("CI"):
        pytest.fail(reason, pytrace=False)
    pytest.skip(reason)


@pytest.fixture(scope="session")
def mongo_url():
    url = os.environ.get("LOQUENT_TEST_MONGO_URL")
    if not url:
        _unusable("set LOQUENT_TEST_MONGO_URL, e.g. docker run -p 27017:27017 mongo:8.0")
    from pymongo import MongoClient

    ms = int(float(os.environ.get("LOQUENT_TEST_MONGO_TIMEOUT_S", "10")) * 1000)
    client = MongoClient(url, serverSelectionTimeoutMS=ms, connectTimeoutMS=ms)
    try:
        client.admin.command("ping")
    except Exception as e:  # noqa: BLE001
        _unusable(f"LOQUENT_TEST_MONGO_URL is set but MongoDB is unreachable: {e}")
    finally:
        client.close()
    return url


@pytest.fixture(params=["sqlite", pytest.param("mongo", marks=pytest.mark.mongo)])
async def store(request):
    if request.param == "sqlite":
        s = SqliteStore(":memory:")
    elif request.param == "mongo":
        from loquent.store.mongo import MongoStore

        url = request.getfixturevalue("mongo_url")
        s = MongoStore(url, db_name=f"loquent_test_{uuid.uuid4().hex}")
    else:
        raise ValueError(request.param)
    await s.init()
    try:
        yield s
    finally:
        if request.param == "mongo":
            await s._client.drop_database(s._db.name)
        await s.close()
