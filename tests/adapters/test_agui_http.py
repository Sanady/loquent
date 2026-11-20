import json

import httpx
import pytest
from ag_ui.core import RunAgentInput, UserMessage

from loquent.adapters.agui_http import AgUiHttpAdapter
from loquent.adapters.base import AgentError
from loquent.context import RunContext

SECRET = "sekret-token-123"


def sse(*events) -> bytes:
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events).encode()


def ev(type_, **kw):
    return {"type": type_, **kw}


def make(handler, **kw):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return AgUiHttpAdapter("https://agent.x.com/run", client=client, **kw)


def ok(body: bytes, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(request)
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    return handler


async def run(adapter):
    messages = [UserMessage(id="u1", role="user", content="hi")]
    inp = RunAgentInput(
        thread_id="t",
        run_id="r",
        state={},
        messages=messages,
        tools=[],
        context=[],
        forwarded_props={},
    )
    ctx = RunContext(thread_id="t", run_id="r", messages=messages)
    return [e async for e in adapter.run(inp, ctx)]


def types(events):
    return [e.type.value for e in events]


async def test_proxy_sends_run_agent_input_camelcase():
    seen = []
    body = sse(ev("TEXT_MESSAGE_START", messageId="m", role="assistant"))
    await run(make(ok(body, seen), headers={"Authorization": f"Bearer {SECRET}"}))
    req = seen[0]
    assert req.method == "POST"
    assert str(req.url) == "https://agent.x.com/run"
    assert req.headers["accept"] == "text/event-stream"
    assert req.headers["authorization"] == f"Bearer {SECRET}"
    payload = json.loads(req.content)
    assert payload["threadId"] == "t"
    assert payload["runId"] == "r"
    assert payload["forwardedProps"] == {}
    assert payload["messages"][0]["content"] == "hi"
    assert "thread_id" not in payload


async def test_proxy_strips_run_lifecycle_events():
    body = sse(
        ev("RUN_STARTED", threadId="t", runId="r"),
        ev("STEP_STARTED", stepName="s"),
        ev("TEXT_MESSAGE_START", messageId="m", role="assistant"),
        ev("TEXT_MESSAGE_CONTENT", messageId="m", delta="hi"),
        ev("TEXT_MESSAGE_END", messageId="m"),
        ev("CUSTOM", name="n", value=1),
        ev("RUN_FINISHED", threadId="t", runId="r"),
    )
    events = await run(make(ok(body)))
    assert types(events) == [
        "STEP_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "CUSTOM",
    ]


async def test_proxy_tolerates_comments_fields_and_multiline_data():
    raw = (
        b": keepalive\n\n"
        b"id: 1\nevent: message\n"
        b'data: {"type":"TEXT_MESSAGE_START",\n'
        b'data: "messageId":"m","role":"assistant"}\n\n'
        b'data: {"type":"TEXT_MESSAGE_END","messageId":"m"}'  # no trailing blank line
    )
    events = await run(make(ok(raw)))
    assert types(events) == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_END"]


async def test_proxy_upstream_run_error_raises_agent_error():
    body = sse(ev("RUN_ERROR", message="agent exploded"))
    with pytest.raises(AgentError, match="agent exploded"):
        await run(make(ok(body)))


async def test_proxy_upstream_run_error_message_truncated():
    body = sse(ev("RUN_ERROR", message="x" * 2000))
    with pytest.raises(AgentError) as ei:
        await run(make(ok(body)))
    assert len(str(ei.value)) == 500


@pytest.mark.parametrize(
    "raw",
    [
        b"data: {not json\n\n",
        b'data: {"type":"NOPE"}\n\n',
        b"data: [1,2]\n\n",
        b'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m"}\n\n',
    ],
)
async def test_proxy_invalid_event_raises_agent_error(raw):
    with pytest.raises(AgentError) as ei:
        await run(make(ok(raw)))
    assert str(ei.value) == "Upstream agent returned an invalid response"


async def test_proxy_http_error_status_fixed_message():
    def handler(request):
        return httpx.Response(500, content=b"secret internal detail")

    with pytest.raises(AgentError) as ei:
        await run(make(handler, headers={"Authorization": SECRET}))
    assert str(ei.value) == "Upstream agent returned HTTP 500"


async def test_proxy_transport_failure_hides_details():
    def handler(request):
        raise httpx.ConnectError(f"boom {SECRET}")

    with pytest.raises(AgentError) as ei:
        await run(make(handler, headers={"Authorization": SECRET}))
    assert str(ei.value) == "Could not reach the agent endpoint"
    assert ei.value.__cause__ is None
    assert ei.value.__suppress_context__


async def test_proxy_does_not_close_injected_client():
    body = sse(ev("RUN_STARTED", threadId="t", runId="r"), ev("RUN_FINISHED", threadId="t", runId="r"))
    client = httpx.AsyncClient(transport=httpx.MockTransport(ok(body)))
    await run(AgUiHttpAdapter("https://agent.x.com/run", client=client))
    assert not client.is_closed
    await client.aclose()


def test_proxy_capabilities():
    a = AgUiHttpAdapter("https://agent.x.com/run")
    assert a.supports_widgets is True
    assert a.supports_attachments is False


# --- chunk events -----------------------------------------------------------------------


def brief(events):
    out = []
    for e in events:
        d = e.model_dump(by_alias=True, exclude_none=True, mode="json")
        d.pop("timestamp", None)
        out.append(d)
    return out


async def test_text_chunks_expand_to_start_content_end():
    body = sse(
        ev("RUN_STARTED", threadId="t", runId="r"),
        ev("TEXT_MESSAGE_CHUNK", messageId="m1", delta="Hel"),
        ev("TEXT_MESSAGE_CHUNK", messageId="m1", delta="lo"),
        ev("TEXT_MESSAGE_CHUNK", delta=" world"),  # no id: continues the open message
        ev("TEXT_MESSAGE_CHUNK", messageId="m2", role="assistant", delta="Second"),
        ev("RUN_FINISHED", threadId="t", runId="r"),
    )
    assert brief(await run(make(ok(body)))) == [
        {"type": "TEXT_MESSAGE_START", "messageId": "m1", "role": "assistant"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "Hel"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "lo"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": " world"},
        {"type": "TEXT_MESSAGE_END", "messageId": "m1"},
        {"type": "TEXT_MESSAGE_START", "messageId": "m2", "role": "assistant"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m2", "delta": "Second"},
        {"type": "TEXT_MESSAGE_END", "messageId": "m2"},
    ]


async def test_tool_call_chunks_expand_and_close_at_end_of_stream():
    body = sse(
        ev("TOOL_CALL_CHUNK", toolCallId="c1", toolCallName="search", parentMessageId="m0",
           delta='{"q":'),
        ev("TOOL_CALL_CHUNK", toolCallId="c1", delta='"x"}'),
        ev("TOOL_CALL_CHUNK", delta=""),  # empty delta adds nothing
    )  # fmt: skip
    assert brief(await run(make(ok(body)))) == [
        {"type": "TOOL_CALL_START", "toolCallId": "c1", "toolCallName": "search",
         "parentMessageId": "m0"},
        {"type": "TOOL_CALL_ARGS", "toolCallId": "c1", "delta": '{"q":'},
        {"type": "TOOL_CALL_ARGS", "toolCallId": "c1", "delta": '"x"}'},
        {"type": "TOOL_CALL_END", "toolCallId": "c1"},
    ]  # fmt: skip


async def test_chunks_interleave_with_other_events():
    body = sse(
        ev("TEXT_MESSAGE_CHUNK", messageId="m1", delta="Looking"),
        ev("TOOL_CALL_CHUNK", toolCallId="c1", toolCallName="search", delta="{}"),
        ev("TOOL_CALL_RESULT", messageId="r1", toolCallId="c1", content="found"),
        ev("TEXT_MESSAGE_CHUNK", messageId="m2", delta="Done"),
        ev("STEP_STARTED", stepName="s"),
        ev("TEXT_MESSAGE_START", messageId="m3", role="assistant"),
        ev("TEXT_MESSAGE_END", messageId="m3"),
    )
    assert types(await run(make(ok(body)))) == [
        "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END",
        "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END",
        "TOOL_CALL_RESULT",
        "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END",
        "STEP_STARTED",
        "TEXT_MESSAGE_START", "TEXT_MESSAGE_END",
    ]  # fmt: skip


@pytest.mark.parametrize(
    "chunk",
    [
        ev("TEXT_MESSAGE_CHUNK", delta="orphan"),  # no id and nothing open
        ev("TOOL_CALL_CHUNK", delta="{}"),
        ev("TOOL_CALL_CHUNK", toolCallId="c1", delta="{}"),  # first chunk without a name
    ],
)
async def test_chunk_that_cannot_open_is_invalid(chunk):
    with pytest.raises(AgentError, match="invalid response"):
        await run(make(ok(sse(chunk))))


# --- redirects, statuses, empty streams ----------------------------------------------------


async def test_redirect_is_followed_keeping_the_post():
    seen = []
    body = sse(ev("TEXT_MESSAGE_START", messageId="m", role="assistant"))

    def handler(request):
        seen.append((request.method, request.url.path, request.content))
        if request.url.path == "/agent":
            return httpx.Response(307, headers={"location": "/agent/"})
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    events = await run(AgUiHttpAdapter("https://agent.x.com/agent", client=client))
    assert types(events) == ["TEXT_MESSAGE_START"]
    assert [(m, p) for m, p, _ in seen] == [("POST", "/agent"), ("POST", "/agent/")]
    assert seen[0][2] == seen[1][2]


@pytest.mark.parametrize("status", [300, 304, 101])
async def test_final_non_2xx_status_is_an_error(status):
    def handler(request):
        return httpx.Response(status)

    with pytest.raises(AgentError) as ei:
        await run(make(handler))
    assert str(ei.value) == f"Upstream agent returned HTTP {status}"


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b": keepalive only\n\n",
        sse(ev("RUN_STARTED", threadId="t", runId="r")),
    ],
)
async def test_stream_without_any_events_is_invalid(raw):
    def handler(request):
        return httpx.Response(200, content=raw, headers={"content-type": "text/event-stream"})

    with pytest.raises(AgentError) as ei:
        await run(make(handler))
    assert str(ei.value) == "Upstream agent returned an invalid response"


async def test_finished_run_with_no_content_is_a_valid_empty_reply():
    body = sse(ev("RUN_STARTED", threadId="t", runId="r"), ev("RUN_FINISHED", threadId="t", runId="r"))
    assert await run(make(ok(body))) == []
