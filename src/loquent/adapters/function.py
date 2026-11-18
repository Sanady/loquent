"""Adapter for plain Python functions."""

from __future__ import annotations

import inspect
from collections.abc import AsyncIterator, Callable
from typing import Any

from ag_ui.core import (
    BaseEvent,
    RunAgentInput,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)

from loquent.context import RunContext
from loquent.protocol import new_id
from loquent.ui import WidgetRequest

_POSITIONAL = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)


def _arity(fn: Callable) -> int:
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError) as e:
        raise TypeError(f"cannot inspect signature of {fn!r}") from e
    n = sum(1 for p in params if p.kind in _POSITIONAL)
    if n not in (1, 2):
        raise TypeError(
            f"agent function must take 1 (messages) or 2 (messages, ctx) positional "
            f"parameters, got {n}"
        )
    return n


async def _aclose(gen: Any) -> None:
    if hasattr(gen, "aclose"):
        await gen.aclose()
    elif hasattr(gen, "close"):
        gen.close()


class FunctionAdapter:
    supports_widgets = True
    supports_attachments = True

    def __init__(self, fn: Callable) -> None:
        self._arity = _arity(fn)
        self._fn = fn

    async def _items(self, input: RunAgentInput, ctx: RunContext) -> AsyncIterator[Any]:
        result = self._fn(ctx.messages) if self._arity == 1 else self._fn(ctx.messages, ctx)
        if inspect.isawaitable(result):
            result = await result
        if result is None:
            return
        if isinstance(result, str):
            yield result
        elif hasattr(result, "__aiter__"):
            try:
                async for item in result:
                    yield item
            finally:
                await _aclose(result)
        else:
            try:
                for item in result:
                    yield item
            finally:
                await _aclose(result)

    async def run(self, input: RunAgentInput, ctx: RunContext) -> AsyncIterator[BaseEvent]:
        open_id: str | None = None
        last_text_id: str | None = None
        items = self._items(input, ctx)
        try:
            async for item in items:
                if isinstance(item, str):
                    if not item:
                        continue
                    if open_id is None:
                        open_id = last_text_id = new_id()
                        yield TextMessageStartEvent(message_id=open_id, role="assistant")
                    yield TextMessageContentEvent(message_id=open_id, delta=item)
                    continue
                if open_id is not None:
                    yield TextMessageEndEvent(message_id=open_id)
                    open_id = None
                if isinstance(item, WidgetRequest):
                    call_id = new_id()
                    yield ToolCallStartEvent(
                        tool_call_id=call_id,
                        tool_call_name=item.tool_name,
                        parent_message_id=last_text_id,
                    )
                    yield ToolCallArgsEvent(tool_call_id=call_id, delta=item.args_json())
                    yield ToolCallEndEvent(tool_call_id=call_id)
                    return  # a widget request ends the run; the finally closes the generator
                if isinstance(item, BaseEvent):
                    yield item
                else:
                    raise TypeError(f"unsupported value yielded by agent function: {item!r}")
            if open_id is not None:
                yield TextMessageEndEvent(message_id=open_id)
                open_id = None
        finally:
            await items.aclose()
