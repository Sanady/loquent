"""The public API: ``App`` (an ASGI callable) and ``serve``."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from loquent.adapters.resolve import resolve_agent
from loquent.auth import (
    Authenticator,
    NoAuth,
    PasswordAuth,
    SessionManager,
    check_bind_safety,
)
from loquent.files import FileStore, LocalFileStore
from loquent.server.app import create_app
from loquent.server.deps import RateLimiter
from loquent.settings import Settings
from loquent.store.base import Store
from loquent.store.factory import open_store


def _checked(overrides: dict[str, Any]) -> dict[str, Any]:
    unknown = sorted(set(overrides) - set(Settings.model_fields))
    if unknown:
        raise TypeError(f"unknown setting(s): {', '.join(unknown)}")
    return overrides


class _LifecycleStore:
    """Makes ``init``/``close`` idempotent and reference-counted.

    ``Mount`` does not run a sub-app's lifespan, so ``App`` also initialises the store
    lazily on the first request; this keeps that from clashing with a real lifespan.
    """

    def __init__(self, store: Store) -> None:
        self._store = store
        self._users = 0
        self._ready = False
        self._lock = asyncio.Lock()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._store, name)

    async def init(self) -> None:
        async with self._lock:
            self._users += 1
            if not self._ready:
                await self._store.init()
                self._ready = True

    async def ensure(self) -> None:
        async with self._lock:
            if not self._ready:
                await self._store.init()
                self._ready = True

    async def close(self) -> None:
        async with self._lock:
            self._users = max(0, self._users - 1)
            if self._users == 0 and self._ready:
                await self._store.close()
                self._ready = False


class App:
    def __init__(
        self,
        agent: Any,
        *,
        settings: Settings | None = None,
        store: Store | None = None,
        file_store: FileStore | None = None,
        authenticator: Authenticator | None = None,
        rate_limiter: RateLimiter | None = None,
        **overrides: Any,
    ) -> None:
        if settings is None:
            settings = Settings(**_checked(overrides))
        elif overrides:
            _checked(overrides)
            settings = Settings.model_validate({**settings.model_dump(), **overrides})
        self.settings = settings
        adapter = resolve_agent(
            agent,
            model=settings.model,
            api_key=settings.api_key.get_secret_value() if settings.api_key else None,
        )
        if store is None:
            store = open_store(settings.store_url)
        if file_store is None:
            file_store = LocalFileStore(Path(settings.files_dir))
        if authenticator is None:
            authenticator = (
                NoAuth()
                if settings.auth == "none"
                else PasswordAuth(SessionManager(settings.effective_secret()))
            )
        self._store = _LifecycleStore(store)
        self._app = create_app(
            adapter,
            settings,
            self._store,
            file_store,
            authenticator,
            rate_limiter,  # type: ignore[arg-type]
        )

    @asynccontextmanager
    async def lifespan(self) -> AsyncIterator[None]:
        """Run startup/shutdown by hand, for hosts that don't forward lifespan events."""
        async with self._app.router.lifespan_context(self._app):
            yield

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] in ("http", "websocket"):
            await self._store.ensure()
        await self._app(scope, receive, send)


def prepare(agent: Any, **overrides: Any) -> tuple[App, Settings]:
    """Validate settings and bind safety and build the ``App``, without starting a server."""
    settings = Settings(**_checked(overrides))
    check_bind_safety(settings)
    return App(agent, settings=settings), settings


def run(app: App, settings: Settings) -> None:
    import uvicorn

    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        proxy_headers=True,
        forwarded_allow_ips=",".join(settings.forwarded_allow_ips),
    )


def serve(agent: Any, **overrides: Any) -> None:
    """Build an ``App`` from ``agent`` and run it with uvicorn."""
    run(*prepare(agent, **overrides))
