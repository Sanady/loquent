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
    client = httpx.AsyncClient(transport=httpx.MockTransport(ok(sse())))
    await run(AgUiHttpAdapter("https://agent.x.com/run", client=client))
    assert not client.is_closed
    await client.aclose()


def test_proxy_capabilities():
    a = AgUiHttpAdapter("https://agent.x.com/run")
    assert a.supports_widgets is True
    assert a.supports_attachments is False
