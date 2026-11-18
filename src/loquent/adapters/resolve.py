"""Turn whatever the developer passed to serve() into an Adapter."""

from __future__ import annotations

from typing import Any

from loquent.adapters.agui_http import AgUiHttpAdapter
from loquent.adapters.base import Adapter
from loquent.adapters.function import FunctionAdapter
from loquent.adapters.openai_compat import OpenAICompatAdapter


def _is_adapter(target: Any) -> bool:
    return (
        not isinstance(target, type)
        and callable(getattr(target, "run", None))
        and hasattr(target, "supports_widgets")
        and hasattr(target, "supports_attachments")
    )


def resolve_agent(target: Any, *, model: str | None = None, api_key: str | None = None) -> Adapter:
    if _is_adapter(target):
        return target
    if isinstance(target, str) and target.startswith(("http://", "https://")):
        if model:
            return OpenAICompatAdapter(target, model, api_key)
        return AgUiHttpAdapter(target)
    if callable(target):
        return FunctionAdapter(target)
    raise TypeError(
        f"Loquent can't serve {type(target).__name__}: pass a function, a URL, or an Adapter"
    )
