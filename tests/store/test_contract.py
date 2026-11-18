"""Contract suite: written against the Store protocol only."""

import asyncio
from datetime import UTC

import pytest

from loquent.store.base import Store
from loquent.store.models import FileMeta, Run, RunInProgress, StoredEvent


def ev(i: int, is_input: bool = False, kind: str = "TEXT_MESSAGE_CONTENT") -> StoredEvent:
    return StoredEvent(seq=i, event={"type": kind, "delta": f"d{i}"}, is_input=is_input)


async def test_ping(store: Store):
    assert await store.ping() is True


async def test_user_roundtrip_and_duplicate_username_rejected(store: Store):
    u = await store.create_user("alice", "hash")
    assert u.username == "alice" and u.password_hash == "hash"
    assert (await store.get_user(u.id)) == u
    assert (await store.get_user_by_username("alice")) == u
    assert await store.get_user("nope") is None
    assert await store.get_user_by_username("bob") is None
    with pytest.raises(ValueError):
        await store.create_user("alice", "other")


async def test_list_threads_owner_scoped_newest_first(store: Store):
    a = await store.create_user("a", "h")
    b = await store.create_user("b", "h")
    t1 = await store.create_thread(a.id, "one")
    t2 = await store.create_thread(a.id, "two")
    await store.create_thread(b.id, "other")
    assert [t.id for t in await store.list_threads(a.id)] == [t2.id, t1.id]
    await store.rename_thread(t1.id, "renamed")
    got = await store.list_threads(a.id)
    assert [t.id for t in got] == [t1.id, t2.id]
    assert got[0].title == "renamed"
    assert len(await store.list_threads(a.id, limit=1)) == 1
    assert (await store.get_thread(t1.id)).title == "renamed"
    assert await store.get_thread("nope") is None


async def _thread(store: Store):
    u = await store.create_user("u", "h")
    return await store.create_thread(u.id, "t")


async def test_create_run_rejects_second_running_run(store: Store):
    t = await _thread(store)
    run = await store.create_run(t.id)
    assert run.status == "running" and run.thread_id == t.id
    with pytest.raises(RunInProgress):
        await store.create_run(t.id)
    await store.finish_run(run.id, "succeeded")
    assert (await store.create_run(t.id)).status == "running"


async def test_create_run_allowed_when_previous_is_stale(store: Store):
    t = await _thread(store)
    first = await store.create_run(t.id)
    second = await store.create_run(t.id, stale_after_s=0)
    assert second.id != first.id
    assert [r.id for r in await store.list_runs(t.id)] == [first.id, second.id]


async def test_concurrent_create_run_exactly_one_wins(store: Store):
    t = await _thread(store)
    results = await asyncio.gather(
        store.create_run(t.id), store.create_run(t.id), return_exceptions=True
    )
    assert sum(isinstance(r, Run) for r in results) == 1
    assert sum(isinstance(r, RunInProgress) for r in results) == 1


async def test_finish_run_is_idempotent_on_terminal(store: Store):
    t = await _thread(store)
    run = await store.create_run(t.id)
    await store.finish_run(run.id, "failed", error="boom")
    await store.finish_run(run.id, "succeeded")
    got = await store.get_run(run.id)
    assert got.status == "failed" and got.error == "boom" and got.finished_at is not None
    assert await store.get_run("nope") is None


async def test_heartbeat_advances(store: Store):
    t = await _thread(store)
    run = await store.create_run(t.id)
    await store.heartbeat(run.id)
    assert (await store.get_run(run.id)).heartbeat_at >= run.heartbeat_at


async def test_cancel_flag_roundtrip(store: Store):
    t = await _thread(store)
    run = await store.create_run(t.id)
    assert await store.is_cancel_requested(run.id) is False
    await store.request_cancel(run.id)
    assert await store.is_cancel_requested(run.id) is True
    assert (await store.get_run(run.id)).cancel_requested is True


async def test_events_append_and_list_after_seq(store: Store):
    t = await _thread(store)
    run = await store.create_run(t.id)
    await store.append_events(run.id, [ev(1), ev(2, is_input=True)])
    await store.append_events(run.id, [ev(3)])
    got = await store.list_events(run.id)
    assert [e.seq for e in got] == [1, 2, 3]
    assert got[1].is_input is True and got[0].event == ev(1).event
    assert [e.seq for e in await store.list_events(run.id, after_seq=1)] == [2, 3]
    assert await store.list_events(run.id, after_seq=3) == []


async def test_thread_events_hides_superseded_output_keeps_input(store: Store):
    t = await _thread(store)
    r1 = await store.create_run(t.id)
    await store.append_events(r1.id, [ev(1, True, "RUN_STARTED"), ev(2)])
    await store.finish_run(r1.id, "succeeded")
    await store.mark_superseded(r1.id)
    r2 = await store.create_run(t.id)
    await store.append_events(r2.id, [ev(1, True, "RUN_STARTED"), ev(2)])
    events = await store.thread_events(t.id)
    assert events == [ev(1, True, "RUN_STARTED").event, ev(1, True, "RUN_STARTED").event,
                      ev(2).event]
    assert (await store.get_run(r1.id)).superseded is True


async def test_delete_thread_cascades(store: Store):
    u = await store.create_user("u", "h")
    t = await store.create_thread(u.id, "t")
    other = await store.create_thread(u.id, "keep")
    run = await store.create_run(t.id)
    await store.append_events(run.id, [ev(1)])
    keep_run = await store.create_run(other.id)
    await store.append_events(keep_run.id, [ev(1)])
    await store.delete_thread(t.id)
    assert await store.get_thread(t.id) is None
    assert await store.get_run(run.id) is None
    assert await store.list_events(run.id) == []
    assert await store.thread_events(t.id) == []
    assert await store.get_thread(other.id) is not None
    assert len(await store.list_events(keep_run.id)) == 1


async def test_file_meta_roundtrip(store: Store):
    u = await store.create_user("u", "h")
    from datetime import datetime

    meta = FileMeta(id="f1", owner_id=u.id, name="a.txt", content_type="text/plain",
                    size=3, created_at=datetime.now(UTC))
    await store.save_file_meta(meta)
    assert await store.get_file_meta("f1") == meta
    assert await store.get_file_meta("nope") is None
