"""AG-UI protocol helpers. Events travel as camelCase dicts (the wire form)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable
from typing import Any

from ag_ui.core import (
    AssistantMessage,
    BaseEvent,
    DeveloperMessage,
    Event,
    FunctionCall,
    Message,
    SystemMessage,
    ToolCall,
    ToolMessage,
    UserMessage,
)
from pydantic import TypeAdapter

_EVENT_ADAPTER: TypeAdapter[Any] = TypeAdapter(Event)

_TEXT_ROLES = {
    "user": UserMessage,
    "assistant": AssistantMessage,
    "system": SystemMessage,
    "developer": DeveloperMessage,
}


def new_id() -> str:
    return uuid.uuid4().hex


def parse_event(data: dict) -> BaseEvent:
    return _EVENT_ADAPTER.validate_python(data)


def event_to_dict(e: BaseEvent) -> dict:
    return e.model_dump(by_alias=True, exclude_none=True, mode="json")


def encode_sse(seq: int, event: BaseEvent | dict) -> str:
    data = event if isinstance(event, dict) else event_to_dict(event)
    return f"id: {seq}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def events_to_messages(events: Iterable[dict]) -> list[Message]:
    """Rebuild chat messages from a stored event log, in order of first appearance."""
    slots: list[dict] = []  # ordered message builders
    texts: dict[str, dict] = {}  # message id -> slot (text or assistant-for-tool-calls)
    calls: dict[str, dict] = {}  # tool call id -> in-flight call

    def assistant_slot(message_id: str) -> dict:
        slot = texts.get(message_id)
        if slot is None:
            slot = {"role": "assistant", "id": message_id, "content": None, "tool_calls": []}
            texts[message_id] = slot
            slots.append(slot)
        return slot

    for ev in events:
        t = ev.get("type")
        if t == "TEXT_MESSAGE_START":
            slot = {
                "role": ev.get("role") or "assistant",
                "id": ev["messageId"],
                "content": "",
                "tool_calls": [],
            }
            texts[ev["messageId"]] = slot
            slots.append(slot)
        elif t == "TEXT_MESSAGE_CONTENT":
            slot = texts.get(ev["messageId"])
            if slot is not None:
                slot["content"] = (slot["content"] or "") + ev["delta"]
        elif t == "TOOL_CALL_START":
            calls[ev["toolCallId"]] = {
                "id": ev["toolCallId"],
                "name": ev["toolCallName"],
                "args": "",
                "ended": False,
                "parent": ev.get("parentMessageId"),
            }
        elif t == "TOOL_CALL_ARGS":
            call = calls.get(ev["toolCallId"])
            if call is not None:
                call["args"] += ev["delta"]
        elif t == "TOOL_CALL_END":
            call = calls.get(ev["toolCallId"])
            if call is not None and not call["ended"]:
                call["ended"] = True
                parent = call["parent"] or f"asst-{call['id']}"
                assistant_slot(parent)["tool_calls"].append(
                    ToolCall(
                        id=call["id"],
                        function=FunctionCall(name=call["name"], arguments=call["args"]),
                    )
                )
        elif t == "TOOL_CALL_RESULT":
            slots.append(
                {
                    "role": "tool",
                    "id": ev["messageId"],
                    "content": ev["content"],
                    "tool_call_id": ev["toolCallId"],
                }
            )

    out: list[Message] = []
    for s in slots:
        if s["role"] == "tool":
            out.append(
                ToolMessage(id=s["id"], content=s["content"], tool_call_id=s["tool_call_id"])
            )
        elif s["role"] == "assistant":
            out.append(
                AssistantMessage(
                    id=s["id"], content=s["content"], tool_calls=s["tool_calls"] or None
                )
            )
        else:
            out.append(_TEXT_ROLES[s["role"]](id=s["id"], content=s["content"]))
    return out
