"""Agent for the README screenshot (e2e/screenshot.mjs): a tool step, a markdown reply, a widget.

- "refund" in the text: asks a Confirm widget
- anything else: a short tool call, then a markdown reply
"""

import asyncio

from ag_ui.core import (
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)

from loquent import ui
from loquent.ui import Confirm


def _last_user_text(messages) -> str:
    for m in reversed(messages):
        if m.role == "user":
            return m.content if isinstance(m.content, str) else ""
    return ""


async def agent(messages, ctx):
    if ctx.answer is not None:
        yield "Refunded. You will see the credit in 3 to 5 days."
        return
    text = _last_user_text(messages).lower()
    if "refund" in text:
        yield "I found the duplicate charge. I need your approval to refund it."
        yield ui.ask(Confirm("Refund $42?", key="refund"))
        return
    yield ToolCallStartEvent(tool_call_id="c1", tool_call_name="lookup_order")
    yield ToolCallArgsEvent(tool_call_id="c1", delta='{"order": 1042}')
    yield ToolCallEndEvent(tool_call_id="c1")
    await asyncio.sleep(0.2)
    yield ToolCallResultEvent(message_id="r1", tool_call_id="c1", content="2 charges found")
    yield "Happy to help. I looked at order `#1042`:\n\n"
    yield "- **Two charges** of $42.00, a minute apart\n- Only one shipment\n\n"
    yield "I can refund the duplicate for you."
