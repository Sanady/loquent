"""Adapter that proxies to a remote AG-UI agent over HTTP."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
from ag_ui.core import BaseEvent, RunAgentInput

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
        try:
            async with self._client.stream("POST", self._url, json=body, headers=headers) as resp:
                if resp.status_code >= 400:
                    raise AgentError(f"Upstream agent returned HTTP {resp.status_code}")
                data_lines: list[str] = []
                async for line in resp.aiter_lines():
                    if line == "":
                        pending, data_lines = data_lines, []
                    elif line.startswith("data:"):
                        value = line[5:]
                        data_lines.append(value.removeprefix(" "))
                        continue
                    else:
                        continue  # comments, id:, event:, retry:
                    if not pending:
                        continue
                    event = self._handle("\n".join(pending))
                    if event is not None:
                        yield event
                if data_lines:
                    event = self._handle("\n".join(data_lines))
                    if event is not None:
                        yield event
        except (httpx.HTTPError, httpx.InvalidURL):
            raise AgentError("Could not reach the agent endpoint") from None

    @staticmethod
    def _handle(data: str) -> BaseEvent | None:
        event = _decode(data)
        kind = event.type.value
        if kind in _LIFECYCLE:
            return None
        if kind == "RUN_ERROR":
            raise AgentError(str(getattr(event, "message", ""))[:_MAX_ERROR])
        return event
