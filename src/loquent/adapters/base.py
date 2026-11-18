"""The Adapter protocol every backend implements."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from ag_ui.core import BaseEvent, RunAgentInput

from loquent.context import RunContext


class AgentError(Exception):
    """An error whose message is safe to show to end users."""


class Adapter(Protocol):
    """Adapters yield content events only; the runner emits RUN_STARTED/FINISHED/ERROR."""

    supports_widgets: bool
    supports_attachments: bool

    def run(self, input: RunAgentInput, ctx: RunContext) -> AsyncIterator[BaseEvent]: ...
