"""Smoke-test agent: echoes the last user message."""


async def echo(messages):
    yield f"echo: {messages[-1].content}"
