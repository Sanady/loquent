"""Security headers added to every HTTP response."""

from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def _frame_ancestors(sources: list[str]) -> str:
    for s in sources:
        if not s or any(ch in s for ch in ";,'\"") or any(ch.isspace() for ch in s):
            raise ValueError(f"invalid frame_ancestors source: {s!r}")
    return " ".join(sources) if sources else "'none'"


class SecurityHeadersMiddleware:
    """Pure ASGI middleware, so streaming responses are not buffered."""

    def __init__(self, app: ASGIApp, frame_ancestors: list[str] | None = None) -> None:
        self.app = app
        csp = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; connect-src 'self'; "
            f"frame-ancestors {_frame_ancestors(list(frame_ancestors or []))}"
        )
        self.headers = {
            "Content-Security-Policy": csp,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin",
        }

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in self.headers.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
