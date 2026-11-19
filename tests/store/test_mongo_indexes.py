import uuid

from loquent.store.mongo import MongoStore


async def test_mongo_init_indexes_threads_active_run_id(mongo_url):
    s = MongoStore(mongo_url, db_name=f"loquent_test_{uuid.uuid4().hex}")
    await s.init()
    try:
        info = await s._db.threads.index_information()
        keys = [tuple(k for k, _ in v["key"]) for v in info.values()]
        assert ("active_run_id",) in keys
    finally:
        await s._client.drop_database(s._db.name)
        await s.close()
