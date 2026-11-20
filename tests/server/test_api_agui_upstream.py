"""An AG-UI upstream that streams chunk events, end to end through the runner."""

import json

import httpx
from srv import make_client, run_message, sse_events

from loquent.adapters.agui_http import AgUiHttpAdapter


def sse(*events) -> bytes:
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events).encode()


def ev(type_, **kw):
    return {"type": type_, **kw}


def upstream(body: bytes) -> AgUiHttpAdapter:
    def handler(request):
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return AgUiHttpAdapter("https://agent.x.com/run", client=client)


async def test_widget_sent_as_tool_call_chunks_stops_the_run():
    body = sse(
        ev("RUN_STARTED", threadId="t", runId="r"),
        ev("TEXT_MESSAGE_CHUNK", messageId="m1", delta="Please confirm"),
        ev("TOOL_CALL_CHUNK", toolCallId="w1", toolCallName="loquent_confirm",
           parentMessageId="m1", delta='{"message":"Refund?"'),
        ev("TOOL_CALL_CHUNK", toolCallId="w1", delta="}"),
        ev("TEXT_MESSAGE_CHUNK", messageId="m2", delta="never shown"),
        ev("RUN_FINISHED", threadId="t", runId="r"),
    )  # fmt: skip
    async with make_client(adapter=upstream(body)) as c:
        events = sse_events(await run_message(c, "hi"))
    kinds = [e["type"] for e in events]
    assert kinds[-5:] == [
        "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_ARGS", "TOOL_CALL_END", "RUN_FINISHED",
    ]  # fmt: skip
    assert events[-1]["outcome"] == {"type": "success", "pendingToolCallIds": ["w1"]}
    start = next(e for e in events if e["type"] == "TOOL_CALL_START")
    assert start["toolCallName"] == "loquent_confirm" and start["parentMessageId"] == "m1"
    assert "never shown" not in json.dumps(events)
