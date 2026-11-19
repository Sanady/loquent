"""Agent for the Playwright smoke tests (and the wheel check).

- any text: streams "Hello ", "from ", "Loquent"
- text containing "refund": asks a Confirm widget; an approved answer replies "Refunded."
- text containing "slow": streams 20 chunks 100 ms apart, then "Slow reply complete."
"""

import asyncio

from loquent import ui
from loquent.ui import Confirm


def _last_user_text(messages) -> str:
    for m in reversed(messages):
        if m.role != "user":
            continue
        if isinstance(m.content, str):
            return m.content
        return " ".join(getattr(p, "text", "") for p in m.content or [])
    return ""


async def agent(messages, ctx):
    answer = ctx.answer
    if answer is not None and answer.key == "refund":
        yield "Refunded." if answer.value == {"confirmed": True} else "Refund cancelled."
        return
    text = _last_user_text(messages).lower()
    if "refund" in text:
        yield ui.ask(Confirm("Refund $42?", key="refund"))
        return
    if "slow" in text:
        for i in range(1, 21):
            await asyncio.sleep(0.1)
            yield f"part{i} "
        yield "Slow reply complete."
        return
    for chunk in ("Hello ", "from ", "Loquent"):
        yield chunk
