"""Per-run context handed to adapters and developer functions."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from ag_ui.core import AssistantMessage, Message, ToolMessage

from loquent.store.models import User
from loquent.ui import is_widget_tool


@dataclass
class FileRef:
    id: str
    name: str
    content_type: str
    size: int
    read: Callable[[], Awaitable[bytes]]


@dataclass
class WidgetAnswer:
    key: str | None
    tool: str
    value: Any


def _loads(text: Any) -> Any:
    try:
        return json.loads(text) if isinstance(text, str) else text
    except ValueError:
        return text


@dataclass
class RunContext:
    thread_id: str
    run_id: str
    user: User | None = None
    messages: list[Message] = field(default_factory=list)
    forwarded_props: dict = field(default_factory=dict)
    files: list[FileRef] = field(default_factory=list)

    @property
    def answer(self) -> WidgetAnswer | None:
        if not self.messages or not isinstance(self.messages[-1], ToolMessage):
            return None
        last = self.messages[-1]
        for m in reversed(self.messages[:-1]):
            if not isinstance(m, AssistantMessage):
                continue
            for call in m.tool_calls or []:
                if call.id == last.tool_call_id:
                    if not is_widget_tool(call.function.name):
                        return None
                    args = _loads(call.function.arguments)
                    key = args.get("key") if isinstance(args, dict) else None
                    return WidgetAnswer(
                        key=key, tool=call.function.name, value=_loads(last.content)
                    )
        return None
