"""Agent for the screenshots (e2e/screenshot.mjs and the per-theme shots in e2e/themes.spec.ts).

- "refund" in the text: asks a Confirm widget
- "snippet" in the text: a markdown reply with a fenced code block
- "crash" in the text: starts a tool call, then fails the run (a stopped tool row and an error)
- anything else: a short tool call, then a markdown reply with inline code
"""

import asyncio

from ag_ui.core import (
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)

from loquent import AgentError, ui
from loquent.ui import Confirm

SNIPPET = """Here is a retry helper with backoff:

```python
import time

def retry(fn, attempts=3, delay=0.5):
    \"\"\"Call fn, retrying with exponential backoff.\"\"\"
    for i in range(attempts):
        try:
            return fn()
        except TimeoutError as e:  # only transient errors
            last = e
            time.sleep(delay * 2**i)
    raise last
```
"""


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
    if "snippet" in text:
        yield SNIPPET
        return
    if "crash" in text:
        yield ToolCallStartEvent(tool_call_id="c2", tool_call_name="sync_ledger")
        yield ToolCallArgsEvent(tool_call_id="c2", delta='{"account": "acme"}')
        yield ToolCallEndEvent(tool_call_id="c2")
        await asyncio.sleep(0.2)
        raise AgentError("The ledger service is unavailable. Try again in a minute.")
    yield ToolCallStartEvent(tool_call_id="c1", tool_call_name="lookup_order")
    yield ToolCallArgsEvent(tool_call_id="c1", delta='{"order": 1042}')
    yield ToolCallEndEvent(tool_call_id="c1")
    await asyncio.sleep(0.2)
    yield ToolCallResultEvent(message_id="r1", tool_call_id="c1", content="2 charges found")
    yield "Happy to help. I looked at order `#1042`:\n\n"
    yield "- **Two charges** of $42.00, a minute apart\n- Only one shipment\n\n"
    yield "I can refund the duplicate for you."
