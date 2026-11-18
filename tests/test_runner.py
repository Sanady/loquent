import asyncio
import logging
from datetime import UTC, datetime, timedelta

import pytest
from ag_ui.core import (
    RunAgentInput,
    RunFinishedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)

from loquent import runner
from loquent.adapters.base import AgentError
from loquent.context import RunContext
from loquent.runner import effective_status, start_run
from loquent.store.sqlite import SqliteStore


@pytest.fixture
async def store():
    s = SqliteStore(":memory:")
    await s.init()
    yield s
    await s.close()


@pytest.fixture(autouse=True)
def fast_intervals(monkeypatch):
    monkeypatch.setattr(runner, "CANCEL_POLL_S", 0.01)
    monkeypatch.setattr(runner, "HEARTBEAT_INTERVAL_S", 0.02)
    monkeypatch.setattr(runner, "FLUSH_INTERVAL_S", 0.02)


class FakeAdapter:
    supports_widgets = True
    supports_attachments = False

    def __init__(self, fn):
        self._fn = fn
        self.closed = False

    async def run(self, input, ctx):
        try:
            async for e in self._fn():
                yield e
        finally:
            self.closed = True


def text(mid, *parts, end=True):
    out = [TextMessageStartEvent(message_id=mid, role="assistant")]
    out += [TextMessageContentEvent(message_id=mid, delta=p) for p in parts]
    if end:
        out.append(TextMessageEndEvent(message_id=mid))
    return out


def user_input(mid="u1", content="hi"):
    return [
        TextMessageStartEvent(message_id=mid, role="user"),
        TextMessageContentEvent(message_id=mid, delta=content),
        TextMessageEndEvent(message_id=mid),
    ]


async def begin(store, adapter, input_events=None):
    thread = await store.create_thread("owner", "t")
    run = await store.create_run(thread.id)
    inp = RunAgentInput(
        thread_id=thread.id, run_id=run.id, state={}, messages=[], tools=[], context=[],
        forwarded_props={},
    )  # fmt: skip
    ctx = RunContext(thread_id=thread.id, run_id=run.id)
    handle = start_run(
        store=store, adapter=adapter, run=run, input=inp, ctx=ctx,
        input_events=input_events or [],
    )  # fmt: skip
    return run, handle


def types(events):
    return [e["type"] for e in events]


async def wait_for(pred, timeout=2.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not await pred():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.005)


def gen_of(events):
    async def fn():
        for e in events:
            yield e

    return fn


async def test_emits_run_started_inputs_content_run_finished_with_contiguous_seq(store):
    adapter = FakeAdapter(gen_of(text("a1", "hel", "lo")))
    run, handle = await begin(store, adapter, user_input())
    got = [item async for item in handle.stream()]
    seqs = [s for s, _ in got]
    assert seqs == list(range(1, len(got) + 1))
    assert types(e for _, e in got) == [
        "RUN_STARTED",
        "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END",
        "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ]  # fmt: skip
    started = got[0][1]
    assert started["threadId"] == run.thread_id and started["runId"] == run.id
    assert "protocolVersion" in started
    assert got[-1][1]["outcome"] == {"type": "success"}
    await handle.task
    assert (await store.get_run(run.id)).status == "succeeded"
    assert adapter.closed


async def test_all_events_persisted_and_input_events_flagged(store):
    run, handle = await begin(store, FakeAdapter(gen_of(text("a1", "x"))), user_input())
    live = [item async for item in handle.stream()]
    await handle.task
    stored = await store.list_events(run.id)
    assert [(e.seq, e.event) for e in stored] == live
    assert [e.is_input for e in stored] == [False, True, True, True, False, False, False, False]


async def test_listener_abandoning_stream_does_not_stop_run(store):
    release = asyncio.Event()

    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        await release.wait()
        yield TextMessageContentEvent(message_id="a1", delta="later")
        yield TextMessageEndEvent(message_id="a1")

    run, handle = await begin(store, FakeAdapter(fn))
    stream = handle.stream()
    first = await anext(stream)
    assert first[0] == 1
    del stream
    release.set()
    await handle.task
    stored = await store.list_events(run.id)
    assert stored[-1].event["type"] == "RUN_FINISHED"
    assert "later" in [e.event.get("delta") for e in stored]
    assert (await store.get_run(run.id)).status == "succeeded"


async def test_listener_closing_stream_early_does_not_affect_other_listeners(store):
    release = asyncio.Event()

    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        await release.wait()
        yield TextMessageContentEvent(message_id="a1", delta="x")
        yield TextMessageEndEvent(message_id="a1")

    _, handle = await begin(store, FakeAdapter(fn))
    early = handle.stream()
    await anext(early)
    await early.aclose()
    release.set()
    full = [item async for item in handle.stream()]  # attaches late: replays from seq 1
    await handle.task
    assert [s for s, _ in full] == list(range(1, 6))
    assert full[-1][1]["type"] == "RUN_FINISHED"


async def test_multiple_listeners_each_get_full_sequence(store):
    release = asyncio.Event()

    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        await release.wait()
        yield TextMessageEndEvent(message_id="a1")

    _, handle = await begin(store, FakeAdapter(fn), user_input())

    async def collect():
        return [item async for item in handle.stream()]

    a = asyncio.create_task(collect())
    await asyncio.sleep(0.02)
    b = asyncio.create_task(collect())
    await asyncio.sleep(0.02)
    release.set()
    ra, rb = await a, await b
    assert ra == rb
    assert [s for s, _ in ra] == list(range(1, 8))
    after = [item async for item in handle.stream()]  # after the run ended
    assert after == ra


async def test_cancel_flag_stops_run_with_cancelled_outcome(store):
    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        while True:
            yield TextMessageContentEvent(message_id="a1", delta=".")
            await asyncio.sleep(0.005)

    adapter = FakeAdapter(fn)
    run, handle = await begin(store, adapter)
    stream = handle.stream()
    await anext(stream)
    await store.request_cancel(run.id)
    rest = [e async for _, e in stream]
    await asyncio.wait_for(handle.task, 2)
    assert rest[-2] == {"type": "TEXT_MESSAGE_END", "messageId": "a1"}
    assert rest[-1]["type"] == "RUN_FINISHED"
    assert rest[-1]["outcome"] == {"type": "cancelled"}
    assert (await store.get_run(run.id)).status == "cancelled"
    assert (await store.list_events(run.id))[-1].event["outcome"] == {"type": "cancelled"}
    assert adapter.closed


async def test_cancel_takes_effect_while_adapter_is_stalled(store):
    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        await asyncio.Event().wait()  # never returns
        yield TextMessageEndEvent(message_id="a1")

    adapter = FakeAdapter(fn)
    run, handle = await begin(store, adapter)
    stream = handle.stream()
    await anext(stream)
    await store.request_cancel(run.id)
    await asyncio.wait_for(handle.task, 2)
    events = [e.event for e in await store.list_events(run.id)]
    assert types(events)[-2:] == ["TEXT_MESSAGE_END", "RUN_FINISHED"]
    assert events[-1]["outcome"] == {"type": "cancelled"}
    assert adapter.closed


async def test_heartbeat_continues_while_adapter_is_stalled(store):
    release = asyncio.Event()

    async def fn():
        await release.wait()  # stalled until the heartbeat has been observed
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        yield TextMessageEndEvent(message_id="a1")

    run, handle = await begin(store, FakeAdapter(fn))
    before = run.heartbeat_at

    async def beat_moved():
        return (await store.get_run(run.id)).heartbeat_at > before

    await wait_for(beat_moved)
    release.set()
    await handle.task
    assert (await store.get_run(run.id)).status == "succeeded"


async def test_flushes_when_batch_size_reached(store, monkeypatch):
    monkeypatch.setattr(runner, "FLUSH_INTERVAL_S", 100)
    monkeypatch.setattr(runner, "FLUSH_MAX_EVENTS", 3)
    release = asyncio.Event()

    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        yield TextMessageContentEvent(message_id="a1", delta="x")
        await release.wait()
        yield TextMessageEndEvent(message_id="a1")

    run, handle = await begin(store, FakeAdapter(fn))

    async def three_persisted():
        return len(await store.list_events(run.id)) >= 3

    await wait_for(three_persisted)
    release.set()
    await handle.task
    assert len(await store.list_events(run.id)) == 5


async def test_flushes_on_interval_while_adapter_is_stalled(store, monkeypatch):
    monkeypatch.setattr(runner, "FLUSH_MAX_EVENTS", 1000)
    release = asyncio.Event()

    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        await release.wait()
        yield TextMessageEndEvent(message_id="a1")

    run, handle = await begin(store, FakeAdapter(fn))

    async def two_persisted():
        return len(await store.list_events(run.id)) == 2

    await wait_for(two_persisted, timeout=0.5)
    release.set()
    await handle.task


async def test_stops_after_widget_tool_call_end_even_if_adapter_continues(store):
    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        yield TextMessageContentEvent(message_id="a1", delta="pick one")
        yield TextMessageEndEvent(message_id="a1")
        yield ToolCallStartEvent(tool_call_id="c1", tool_call_name="loquent_select")
        yield ToolCallArgsEvent(tool_call_id="c1", delta='{"options":["a","b"]}')
        yield ToolCallEndEvent(tool_call_id="c1")
        yield from_after.pop()  # must never be pulled
        yield TextMessageStartEvent(message_id="a2", role="assistant")

    from_after = [TextMessageStartEvent(message_id="leak", role="assistant")]
    adapter = FakeAdapter(fn)
    run, handle = await begin(store, adapter)
    live = [e async for _, e in handle.stream()]
    await handle.task
    assert types(live)[-2:] == ["TOOL_CALL_END", "RUN_FINISHED"]
    assert live[-1]["outcome"] == {"type": "success", "pendingToolCallIds": ["c1"]}
    assert from_after, "adapter was pulled past the widget TOOL_CALL_END"
    assert adapter.closed
    assert (await store.get_run(run.id)).status == "succeeded"
    stored = [e.event for e in await store.list_events(run.id)]
    assert stored == live


async def test_non_widget_tool_call_does_not_stop_run(store):
    events = [
        ToolCallStartEvent(tool_call_id="c1", tool_call_name="search"),
        ToolCallEndEvent(tool_call_id="c1"),
        *text("a1", "done"),
    ]
    _, handle = await begin(store, FakeAdapter(gen_of(events)))
    live = [e async for _, e in handle.stream()]
    assert "done" in [e.get("delta") for e in live]
    assert live[-1]["outcome"] == {"type": "success"}


async def test_adapter_exception_yields_generic_run_error_without_secret(store, caplog):
    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        yield TextMessageContentEvent(message_id="a1", delta="par")
        raise RuntimeError("upstream rejected key sk-SECRET")

    caplog.set_level(logging.ERROR, logger="loquent.runner")
    run, handle = await begin(store, FakeAdapter(fn))
    live = [e async for _, e in handle.stream()]
    await handle.task
    assert live[-2] == {"type": "TEXT_MESSAGE_END", "messageId": "a1"}
    assert live[-1] == {
        "type": "RUN_ERROR",
        "message": "The agent ran into an error.",
        "code": "agent_error",
    }
    stored = await store.list_events(run.id)
    assert "sk-SECRET" not in repr([e.event for e in stored])
    final = await store.get_run(run.id)
    assert final.status == "failed"
    assert "sk-SECRET" not in (final.error or "")
    assert any(
        r.name == "loquent.runner" and r.exc_info and "sk-SECRET" in str(r.exc_info[1])
        for r in caplog.records
    )


@pytest.mark.parametrize("exc", [TypeError("bad sk-SECRET"), ValueError("bad sk-SECRET")])
async def test_non_agent_errors_all_use_generic_message(store, exc):
    async def fn():
        raise exc
        yield  # pragma: no cover

    _, handle = await begin(store, FakeAdapter(fn))
    live = [e async for _, e in handle.stream()]
    assert live[-1]["message"] == "The agent ran into an error."


async def test_agent_error_message_passed_through(store):
    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        raise AgentError("The model is overloaded, try again.")

    run, handle = await begin(store, FakeAdapter(fn))
    live = [e async for _, e in handle.stream()]
    await handle.task
    assert live[-1] == {
        "type": "RUN_ERROR",
        "message": "The model is overloaded, try again.",
        "code": "agent_error",
    }
    final = await store.get_run(run.id)
    assert final.status == "failed"
    assert final.error == "The model is overloaded, try again."


async def test_non_event_from_adapter_is_generic_error_with_contiguous_seq(store):
    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        yield {"type": "TEXT_MESSAGE_CONTENT", "secret": "sk-SECRET"}

    run, handle = await begin(store, FakeAdapter(fn))
    live = [item async for item in handle.stream()]
    await handle.task
    assert [s for s, _ in live] == list(range(1, len(live) + 1))
    assert types(e for _, e in live)[-2:] == ["TEXT_MESSAGE_END", "RUN_ERROR"]
    assert live[-1][1]["message"] == "The agent ran into an error."
    assert (await store.get_run(run.id)).status == "failed"


async def test_adapter_lifecycle_events_are_dropped(store):
    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        yield TextMessageEndEvent(message_id="a1")
        yield RunFinishedEvent(thread_id="x", run_id="y")

    run, handle = await begin(store, FakeAdapter(fn))
    live = [e async for _, e in handle.stream()]
    assert types(live).count("RUN_FINISHED") == 1
    assert live[-1]["runId"] == run.id


async def test_effective_status_marks_stale_running_run_interrupted(store):
    thread = await store.create_thread("owner", "t")
    run = await store.create_run(thread.id)
    assert await effective_status(store, run) == "running"
    later = datetime.now(UTC) + timedelta(seconds=31)
    assert await effective_status(store, run, now=later) == "interrupted"
    assert (await store.get_run(run.id)).status == "interrupted"
    assert await effective_status(store, run, now=later, stale_after_s=60) == "running"


async def test_effective_status_leaves_terminal_runs_alone(store):
    thread = await store.create_thread("owner", "t")
    run = await store.create_run(thread.id)
    await store.finish_run(run.id, "succeeded")
    done = await store.get_run(run.id)
    later = datetime.now(UTC) + timedelta(hours=1)
    assert await effective_status(store, done, now=later) == "succeeded"
    assert (await store.get_run(run.id)).status == "succeeded"


async def test_task_cancellation_marks_interrupted(store):
    async def fn():
        yield TextMessageStartEvent(message_id="a1", role="assistant")
        yield TextMessageContentEvent(message_id="a1", delta="partial")
        await asyncio.Event().wait()
        yield TextMessageEndEvent(message_id="a1")  # pragma: no cover

    adapter = FakeAdapter(fn)
    run, handle = await begin(store, adapter)
    stream = handle.stream()
    for _ in range(3):
        await anext(stream)
    handle.task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await handle.task
    assert (await store.get_run(run.id)).status == "interrupted"
    stored = [e.event for e in await store.list_events(run.id)]
    assert types(stored) == ["RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"]
    assert adapter.closed
    assert [item async for item in stream] == []  # the stream ends


class FlakyStore(SqliteStore):
    def __init__(self, failures):
        super().__init__(":memory:")
        self.failures = failures

    async def append_events(self, run_id, events):
        if self.failures:
            self.failures -= 1
            raise OSError("disk unavailable")
        await super().append_events(run_id, events)


async def test_transient_append_failure_loses_no_events(caplog):
    s = FlakyStore(failures=1)
    await s.init()
    try:
        run, handle = await begin(s, FakeAdapter(gen_of(text("a1", "x"))))
        live = [item async for item in handle.stream()]
        await handle.task
        stored = await s.list_events(run.id)
        assert [(e.seq, e.event) for e in stored] == live
        assert (await s.get_run(run.id)).status == "succeeded"
    finally:
        await s.close()


async def test_persistent_append_failure_marks_run_failed_without_hanging():
    s = FlakyStore(failures=10**9)
    await s.init()
    try:
        run, handle = await begin(s, FakeAdapter(gen_of(text("a1", "x"))))
        live = await asyncio.wait_for(_collect(handle), 2)
        await asyncio.wait_for(handle.task, 2)
        assert live[-1][1]["type"] == "RUN_FINISHED"
        assert (await s.get_run(run.id)).status == "failed"
    finally:
        await s.close()


async def _collect(handle):
    return [item async for item in handle.stream()]
