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
    if url:
        from pymongo import MongoClient

        ms = int(float(os.environ.get("LOQUENT_TEST_MONGO_TIMEOUT_S", "10")) * 1000)
        client = MongoClient(url, serverSelectionTimeoutMS=ms, connectTimeoutMS=ms)
        try:
            client.admin.command("ping")
        except Exception as e:  # noqa: BLE001
            _unusable(f"LOQUENT_TEST_MONGO_URL is set but MongoDB is unreachable: {e}")
        finally:
            client.close()
        yield url
        return
    mongod = None
    try:
        from pymongo_inmemory.context import Context
        from pymongo_inmemory.mongod import Mongod

        mongod = Mongod(Context())
        mongod.start()
    except Exception as e:  # noqa: BLE001
        if mongod is not None:
            mongod.stop()
        _unusable(
            "no usable MongoDB (set LOQUENT_TEST_MONGO_URL, or allow the pymongo-inmemory "
            f"mongod download; note it ships mongod <=4.0): {e}"
        )
    try:
        yield mongod.connection_string
    finally:
        mongod.stop()


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
