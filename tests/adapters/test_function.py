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
