"""Adapter for any OpenAI-compatible /chat/completions endpoint."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
from ag_ui.core import (
    AssistantMessage,
    BaseEvent,
    RunAgentInput,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
    ToolMessage,
)

from loquent.adapters.base import AgentError
from loquent.context import RunContext
from loquent.protocol import new_id

_TEXT_ROLES = ("user", "system", "developer")


def _text(content: Any) -> str:
    """Flatten AG-UI message content (a string or a list of parts) into plain text."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    parts = []
    for part in content:
        t = part.get("text") if isinstance(part, dict) else getattr(part, "text", None)
        if isinstance(t, str):
            parts.append(t)
    return "".join(parts)


def _to_openai_messages(messages: list[Any]) -> list[dict[str, Any]]:
    """Convert AG-UI history to OpenAI messages.

    OpenAI rejects tool calls that have no tool result, so unanswered calls (and tool
    results with no matching call) are dropped, as are assistant messages left empty.
    """
    result_positions: dict[str, int] = {}
    for i, m in enumerate(messages):
        if isinstance(m, ToolMessage):
            result_positions.setdefault(m.tool_call_id, i)

    out: list[dict[str, Any]] = []
    kept_ids: set[str] = set()
    for i, m in enumerate(messages):
        role = getattr(m, "role", None)
        if role in _TEXT_ROLES:
            out.append({"role": role, "content": _text(m.content)})
        elif isinstance(m, AssistantMessage):
            calls = [
                {
                    "id": c.id,
                    "type": "function",
                    "function": {"name": c.function.name, "arguments": c.function.arguments},
                }
                for c in (m.tool_calls or [])
                if result_positions.get(c.id, -1) > i
            ]
            content = _text(m.content)
            if not content and not calls:
                continue
            msg: dict[str, Any] = {"role": "assistant", "content": content or None}
            if calls:
                msg["tool_calls"] = calls
                kept_ids.update(c["id"] for c in calls)
            out.append(msg)
        elif isinstance(m, ToolMessage) and m.tool_call_id in kept_ids:
            out.append(
                {"role": "tool", "tool_call_id": m.tool_call_id, "content": _text(m.content)}
            )
    return out


def _to_openai_tools(tools: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            },
        }
        for t in tools
    ]


class OpenAICompatAdapter:
    supports_widgets = True
    supports_attachments = False

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10))

    async def run(self, input: RunAgentInput, ctx: RunContext) -> AsyncIterator[BaseEvent]:
        body: dict[str, Any] = {
            "model": self._model,
            "stream": True,
            "messages": _to_openai_messages(ctx.messages),
        }
        if input.tools:
            body["tools"] = _to_openai_tools(input.tools)
        headers = {"Accept": "text/event-stream"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        text_id: str | None = None
        text_open = False
        calls: dict[int, dict[str, str]] = {}
        try:
            async with self._client.stream(
                "POST", self._url, json=body, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    raise AgentError(f"Upstream model returned HTTP {resp.status_code}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    for choice in chunk.get("choices") or []:
                        d = choice.get("delta") or {}
                        content = d.get("content")
                        if content:
                            if not text_open:
                                text_id = new_id()
                                text_open = True
                                yield TextMessageStartEvent(message_id=text_id, role="assistant")
                            yield TextMessageContentEvent(message_id=text_id, delta=content)
                        for tc in d.get("tool_calls") or []:
                            slot = calls.setdefault(
                                tc.get("index", 0), {"id": "", "name": "", "args": ""}
                            )
                            fn = tc.get("function") or {}
                            slot["id"] = tc.get("id") or slot["id"]
                            slot["name"] += fn.get("name") or ""
                            slot["args"] += fn.get("arguments") or ""
        except httpx.TransportError:
            raise AgentError("Could not reach the model endpoint") from None

        if text_open:
            yield TextMessageEndEvent(message_id=text_id)
        for _, call in sorted(calls.items()):
            if not call["name"]:
                continue
            call_id = call["id"] or new_id()
            yield ToolCallStartEvent(
                tool_call_id=call_id, tool_call_name=call["name"], parent_message_id=text_id
            )
            yield ToolCallArgsEvent(tool_call_id=call_id, delta=call["args"] or "{}")
            yield ToolCallEndEvent(tool_call_id=call_id)
