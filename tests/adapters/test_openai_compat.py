import json

import httpx
import pytest
from ag_ui.core import (
    AssistantMessage,
    FunctionCall,
    RunAgentInput,
    ToolCall,
    ToolMessage,
    UserMessage,
)

from loquent.adapters.base import AgentError
from loquent.adapters.openai_compat import OpenAICompatAdapter
from loquent.context import RunContext
from loquent.ui import WIDGET_TOOLS


def sse(*chunks) -> bytes:
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return body.encode()


def delta(**d):
    return {"choices": [{"index": 0, "delta": d}]}


def make(handler, **kw):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    kw.setdefault("api_key", "k")
    return OpenAICompatAdapter("https://api.x.com/v1", "gpt-4o", client=client, **kw)


def ok(*chunks, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(request)
        return httpx.Response(
            200, content=sse(*chunks), headers={"content-type": "text/event-stream"}
        )

    return handler


async def run(adapter, messages=None, tools=None):
    messages = messages or [UserMessage(id="u1", role="user", content="hi")]
    inp = RunAgentInput(
        thread_id="t",
        run_id="r",
        state={},
        messages=messages,
        tools=tools or [],
        context=[],
        forwarded_props={},
    )
    ctx = RunContext(thread_id="t", run_id="r", messages=messages)
    return [e async for e in adapter.run(inp, ctx)]


def types(events):
    return [e.type.value for e in events]


async def test_posts_to_chat_completions_with_stream_and_bearer():
    seen = []
    await run(make(ok(delta(content="x"), seen=seen), api_key="k"))
    req = seen[0]
    assert str(req.url) == "https://api.x.com/v1/chat/completions"
    assert req.headers["authorization"] == "Bearer k"
    body = json.loads(req.content)
    assert body["stream"] is True
    assert body["model"] == "gpt-4o"
    assert body["messages"] == [{"role": "user", "content": "hi"}]
    assert "tools" not in body


async def test_no_authorization_header_without_key():
    seen = []
    await run(make(ok(delta(content="x"), seen=seen), api_key=None))
    assert "authorization" not in seen[0].headers


async def test_trailing_slash_in_base_url():
    seen = []
    client = httpx.AsyncClient(transport=httpx.MockTransport(ok(delta(content="x"), seen=seen)))
    await run(OpenAICompatAdapter("https://api.x.com/v1/", "m", None, client=client))
    assert str(seen[0].url) == "https://api.x.com/v1/chat/completions"


async def test_content_deltas_become_text_events():
    ev = await run(make(ok(delta(role="assistant", content=""), delta(content="Hel"),
                           delta(content="lo"))))
    assert types(ev) == [
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
    ]
    assert [e.delta for e in ev[1:3]] == ["Hel", "lo"]
    assert len({e.message_id for e in ev}) == 1


async def test_tool_call_deltas_become_tool_call_events():
    ev = await run(
        make(
            ok(
                delta(content="Sure"),
                delta(tool_calls=[{"index": 0, "id": "call_1", "type": "function",
                                   "function": {"name": "loquent_confirm", "arguments": ""}}]),
                delta(tool_calls=[{"index": 0, "function": {"arguments": '{"title":'}}]),
                delta(tool_calls=[{"index": 0, "function": {"arguments": ' "Ok?"}'}}]),
            )
        )
    )
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
    assert start.tool_call_id == "call_1"
    assert start.parent_message_id == ev[0].message_id
    assert json.loads(args.delta) == {"title": "Ok?"}


async def test_multiple_tool_calls_by_index():
    ev = await run(
        make(
            ok(
                delta(tool_calls=[{"index": 0, "id": "a", "function": {"name": "f", "arguments": "{}"}},
                                  {"index": 1, "id": "b", "function": {"name": "g", "arguments": "{}"}}]),
            )
        )
    )
    assert [e.tool_call_name for e in ev if e.type.value == "TOOL_CALL_START"] == ["f", "g"]


async def test_widget_tools_sent_as_function_tools_only_when_input_has_tools():
    seen = []
    await run(make(ok(delta(content="x"), seen=seen)), tools=WIDGET_TOOLS)
    tools = json.loads(seen[0].content)["tools"]
    assert len(tools) == len(WIDGET_TOOLS)
    t = tools[0]
    assert t["type"] == "function"
    assert t["function"]["name"] == WIDGET_TOOLS[0].name
    assert t["function"]["description"] == WIDGET_TOOLS[0].description
    assert t["function"]["parameters"] == WIDGET_TOOLS[0].parameters

    seen.clear()
    await run(make(ok(delta(content="x"), seen=seen)), tools=[])
    assert "tools" not in json.loads(seen[0].content)


def _call(id, name="loquent_confirm"):
    return ToolCall(id=id, type="function", function=FunctionCall(name=name, arguments="{}"))


async def test_history_drops_tool_calls_without_results():
    seen = []
    msgs = [
        UserMessage(id="1", role="user", content="a"),
        AssistantMessage(id="2", role="assistant", content="thinking",
                         tool_calls=[_call("answered"), _call("orphan")]),
        ToolMessage(id="3", role="tool", content='"yes"', tool_call_id="answered"),
        ToolMessage(id="4", role="tool", content="stray", tool_call_id="nope"),
        AssistantMessage(id="5", role="assistant", content=None, tool_calls=[_call("lonely")]),
        UserMessage(id="6", role="user", content="b"),
    ]
    await run(make(ok(delta(content="x"), seen=seen)), messages=msgs)
    out = json.loads(seen[0].content)["messages"]
    assert out == [
        {"role": "user", "content": "a"},
        {
            "role": "assistant",
            "content": "thinking",
            "tool_calls": [
                {"id": "answered", "type": "function",
                 "function": {"name": "loquent_confirm", "arguments": "{}"}}
            ],
        },
        {"role": "tool", "tool_call_id": "answered", "content": '"yes"'},
        {"role": "user", "content": "b"},
    ]


async def test_roles_mapped_and_unknown_skipped():
    from ag_ui.core import ActivityMessage, DeveloperMessage, SystemMessage

    seen = []
    msgs = [
        SystemMessage(id="1", role="system", content="s"),
        DeveloperMessage(id="2", role="developer", content="d"),
        ActivityMessage(id="3", role="activity", activity_type="x", content={}),
        UserMessage(id="4", role="user", content="u"),
    ]
    await run(make(ok(delta(content="x"), seen=seen)), messages=msgs)
    out = json.loads(seen[0].content)["messages"]
    assert [m["role"] for m in out] == ["system", "developer", "user"]


async def test_http_error_raises_agent_error_without_key():
    def handler(request):
        return httpx.Response(401, json={"error": "bad key sk-secret"})

    with pytest.raises(AgentError) as ei:
        await run(make(handler, api_key="sk-secret"))
    assert str(ei.value) == "Upstream model returned HTTP 401"
    assert "sk-secret" not in str(ei.value)


async def test_connection_error_becomes_agent_error():
    def handler(request):
        raise httpx.ConnectError("boom sk-secret", request=request)

    with pytest.raises(AgentError) as ei:
        await run(make(handler, api_key="sk-secret"))
    assert str(ei.value) == "Could not reach the model endpoint"
    assert "sk-secret" not in repr(ei.value)


async def test_timeout_becomes_agent_error():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(AgentError, match="Could not reach"):
        await run(make(handler))


async def test_injected_client_not_closed():
    adapter = make(ok(delta(content="x")))
    await run(adapter)
    assert not adapter._client.is_closed


def test_capabilities():
    a = OpenAICompatAdapter("https://x/v1", "m", None)
    assert a.supports_widgets is True
    assert a.supports_attachments is False
