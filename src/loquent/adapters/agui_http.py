"""Adapter that proxies to a remote AG-UI agent over HTTP."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
from ag_ui.core import (
    BaseEvent,
    RunAgentInput,
    TextMessageChunkEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallChunkEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)

from loquent.adapters.base import AgentError
from loquent.context import RunContext
from loquent.protocol import parse_event

_INVALID = "Upstream agent returned an invalid response"
_MAX_ERROR = 500
_LIFECYCLE = ("RUN_STARTED", "RUN_FINISHED")


def _decode(data: str) -> BaseEvent:
    try:
        payload = json.loads(data)
        if not isinstance(payload, dict):
            raise AgentError(_INVALID)
        return parse_event(payload)
    except (ValueError, TypeError):
        raise AgentError(_INVALID) from None


class _ChunkExpander:
    """Expands AG-UI chunk events into START/CONTENT|ARGS/END, per the protocol's rules.

    The first chunk for a new id opens a message (role defaults to assistant) or a tool call
    (name and parent come from that first chunk); later chunks with the same id, or with no
    id, append to it. A chunk with another id, any other event, or the end of the stream
    closes it. Only one message or call is open at a time.
    """

    def __init__(self) -> None:
        self._open: tuple[str, str] | None = None  # ("text" | "tool", id)

    def close(self) -> list[BaseEvent]:
        if self._open is None:
            return []
        kind, id_ = self._open
        self._open = None
        if kind == "text":
            return [TextMessageEndEvent(message_id=id_)]
        return [ToolCallEndEvent(tool_call_id=id_)]

    def _continue_or_open(self, kind: str, id_: str | None) -> tuple[list[BaseEvent], str, bool]:
        """Returns (events closing the previous one, the id to use, whether it is new)."""
        if self._open is not None and self._open[0] == kind and id_ in (None, self._open[1]):
            return [], self._open[1], False
        if not id_:
            raise AgentError(_INVALID)  # nothing open to continue
        return self.close(), id_, True

    def feed(self, event: BaseEvent) -> list[BaseEvent]:
        if isinstance(event, TextMessageChunkEvent):
            out, mid, new = self._continue_or_open("text", event.message_id)
            if new:
                out.append(TextMessageStartEvent(message_id=mid, role=event.role or "assistant"))
                self._open = ("text", mid)
            if event.delta:
                out.append(TextMessageContentEvent(message_id=mid, delta=event.delta))
            return out
        if not isinstance(event, ToolCallChunkEvent):
            raise TypeError(f"not a chunk event: {event.type}")
        out, cid, new = self._continue_or_open("tool", event.tool_call_id)
        if new:
            if not event.tool_call_name:
                raise AgentError(_INVALID)
            out.append(
                ToolCallStartEvent(
                    tool_call_id=cid,
                    tool_call_name=event.tool_call_name,
                    parent_message_id=event.parent_message_id,
                )
            )
            self._open = ("tool", cid)
        if event.delta:
            out.append(ToolCallArgsEvent(tool_call_id=cid, delta=event.delta))
        return out


class AgUiHttpAdapter:
    supports_widgets = True
    supports_attachments = False

    def __init__(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._url = url
        self._headers = dict(headers or {})
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10))

    async def run(self, input: RunAgentInput, ctx: RunContext) -> AsyncIterator[BaseEvent]:
        body = input.model_dump(by_alias=True, exclude_none=True, mode="json")
        headers = {**self._headers, "Accept": "text/event-stream"}
        chunks = _ChunkExpander()
        seen_any = False  # any content event, or RUN_FINISHED
        try:
            # 307/308 keep the POST and its body (e.g. FastAPI's /agent -> /agent/).
            async with self._client.stream(
                "POST", self._url, json=body, headers=headers, follow_redirects=True
            ) as resp:
                if not 200 <= resp.status_code < 300:
                    raise AgentError(f"Upstream agent returned HTTP {resp.status_code}")
                async for data in _sse_data(resp):
                    event = _decode(data)
                    kind = event.type.value
                    if kind == "RUN_ERROR":
                        raise AgentError(str(getattr(event, "message", ""))[:_MAX_ERROR])
                    if kind in ("TEXT_MESSAGE_CHUNK", "TOOL_CALL_CHUNK"):
                        out = chunks.feed(event)
                    else:
                        out = chunks.close()
                        if kind == "RUN_FINISHED":
                            seen_any = True
                        if kind not in _LIFECYCLE:
                            out.append(event)
                    for e in out:
                        seen_any = True
                        yield e
                for e in chunks.close():
                    yield e
        except (httpx.HTTPError, httpx.InvalidURL):
            raise AgentError("Could not reach the agent endpoint") from None
        if not seen_any:
            raise AgentError(_INVALID)


async def _sse_data(resp: httpx.Response) -> AsyncIterator[str]:
    """The ``data`` payload of each SSE event (multi-line data joined with newlines)."""
    data_lines: list[str] = []
    async for line in resp.aiter_lines():
        if line == "":
            if data_lines:
                yield "\n".join(data_lines)
            data_lines = []
        elif line.startswith("data:"):
            data_lines.append(line[5:].removeprefix(" "))
        # comments, id:, event:, retry: are ignored
    if data_lines:
        yield "\n".join(data_lines)
