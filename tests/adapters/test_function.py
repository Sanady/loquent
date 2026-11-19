import pytest
from ag_ui.core import RunAgentInput, StepStartedEvent

from loquent.adapters import FunctionAdapter
from loquent.context import RunContext
from loquent.ui import Confirm, ask


def _run(adapter, messages=None):
    inp = RunAgentInput(
        thread_id="t", run_id="r", state={}, messages=[], tools=[], context=[], forwarded_props={}
    )
    ctx = RunContext(thread_id="t", run_id="r", messages=messages or [])
    return adapter.run(inp, ctx)


async def collect(adapter):
    return [e async for e in _run(adapter)]


def types(events):
    return [e.type.value for e in events]


def test_arity_validation():
    with pytest.raises(TypeError, match="positional"):
        FunctionAdapter(lambda: "x")
    with pytest.raises(TypeError):
        FunctionAdapter(lambda a, b, c: "x")


async def test_function_str_return_becomes_one_text_message():
    ev = await collect(FunctionAdapter(lambda messages: "hello"))
    assert types(ev) == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]
    assert ev[1].delta == "hello"


async def test_async_and_ctx_signature():
    seen = {}

    async def fn(messages, ctx):
        seen["ctx"] = ctx
        return "hi"

    ev = await collect(FunctionAdapter(fn))
    assert ev[1].delta == "hi" and seen["ctx"].thread_id == "t"


async def test_async_generator_streams_deltas_in_order():
    async def fn(messages):
        for p in ["a", "b", "c"]:
            yield p

    ev = await collect(FunctionAdapter(fn))
    assert types(ev) == ["TEXT_MESSAGE_START"] + ["TEXT_MESSAGE_CONTENT"] * 3 + ["TEXT_MESSAGE_END"]
    assert [e.delta for e in ev[1:4]] == ["a", "b", "c"]
    assert len({e.message_id for e in ev}) == 1


async def test_sync_generator():
    def fn(messages):
        yield "x"
        yield "y"

    ev = await collect(FunctionAdapter(fn))
    assert [e.delta for e in ev if e.type.value == "TEXT_MESSAGE_CONTENT"] == ["x", "y"]


async def test_yielding_ask_emits_tool_call_and_closes_generator():
    state = {"after": False, "finally": False}

    async def fn(messages):
        try:
            yield "Checking. "
            yield ask(Confirm("Refund?", key="refund"))
            state["after"] = True
        finally:
            state["finally"] = True

    ev = await collect(FunctionAdapter(fn))
    assert types(ev) == [
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
    ]
    start, args = ev[3], ev[4]
    assert start.tool_call_name == "loquent_confirm"
    assert start.parent_message_id == ev[0].message_id
    assert '"key":"refund"' in args.delta
    assert state == {"after": False, "finally": True}


async def test_sync_generator_ask_closes():
    state = {"after": False}

    def fn(messages):
        yield ask(Confirm("ok?"))
        state["after"] = True

    ev = await collect(FunctionAdapter(fn))
    assert ev[0].parent_message_id is None
    assert not state["after"]


async def test_passthrough_base_events():
    step = StepStartedEvent(step_name="s")

    async def fn(messages):
        yield "a"
        yield step
        yield "b"

    ev = await collect(FunctionAdapter(fn))
    assert step in ev
    assert types(ev).count("TEXT_MESSAGE_START") == 2
    assert types(ev)[:3] == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]


async def _ticks_while(coro_fn):
    """Run ``coro_fn()`` while a 10 ms ticker counts how often the event loop got to run."""
    import asyncio

    ticks = 0
    done = False

    async def ticker():
        nonlocal ticks
        while not done:
            await asyncio.sleep(0.01)
            ticks += 1

    t = asyncio.create_task(ticker())
    try:
        result = await coro_fn()
    finally:
        done = True
        await t
    return result, ticks


async def test_sync_function_does_not_block_the_event_loop():
    import time

    def slow(messages):
        time.sleep(0.3)
        return "done"

    ev, ticks = await _ticks_while(lambda: collect(FunctionAdapter(slow)))
    assert ev[1].delta == "done"
    assert ticks >= 10  # a blocked loop would tick at most once or twice


async def test_sync_generator_steps_do_not_block_the_event_loop():
    import threading
    import time

    threads = set()

    def slow_gen(messages):
        for part in ("a", "b", "c"):
            threads.add(threading.get_ident())
            time.sleep(0.1)
            yield part

    ev, ticks = await _ticks_while(lambda: collect(FunctionAdapter(slow_gen)))
    assert [e.delta for e in ev if e.type.value == "TEXT_MESSAGE_CONTENT"] == ["a", "b", "c"]
    assert ticks >= 10
    assert threading.get_ident() not in threads


async def test_async_function_runs_on_the_loop_thread():
    import threading

    seen = {}

    async def fn(messages):
        seen["thread"] = threading.get_ident()
        return "x"

    await collect(FunctionAdapter(fn))
    assert seen["thread"] == threading.get_ident()
