"""The Starlette application: routes, middleware, lifespan."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import BaseRoute, Mount

from loquent.adapters.base import Adapter
from loquent.auth import Authenticator, SessionManager
from loquent.files import FileStore
from loquent.settings import Settings
from loquent.store.base import Store

from . import routes_auth, routes_files, routes_meta, routes_runs, routes_threads
from .deps import (
    CSRF_HEADER,
    ApiError,
    Deps,
    RateLimiter,
    api_error_handler,
    http_error_handler,
)
from .security import SecurityHeadersMiddleware

log = logging.getLogger("loquent.server")

SHUTDOWN_TIMEOUT_S = 10


def _normalize_root_path(root_path: str) -> str:
    rp = root_path.strip().rstrip("/")
    if rp and not rp.startswith("/"):
        rp = "/" + rp
    return rp


def create_app(
    adapter: Adapter,
    settings: Settings,
    store: Store,
    file_store: FileStore | None,
    authenticator: Authenticator,
    rate_limiter: RateLimiter | None = None,
) -> Starlette:
    root_path = _normalize_root_path(settings.root_path)
    sessions = getattr(authenticator, "sessions", None)
    if not isinstance(sessions, SessionManager):
        sessions = SessionManager(settings.effective_secret())
    deps = Deps(
        adapter=adapter,
        settings=settings,
        store=store,
        file_store=file_store,
        authenticator=authenticator,
        sessions=sessions,
        rate_limiter=rate_limiter,
        cookie_path=root_path or "/",
    )

    routes: list[BaseRoute] = [
        *routes_meta.routes(deps),
        *routes_auth.routes(deps),
        *routes_threads.routes(deps),
        *routes_runs.routes(deps),
    ]
    if file_store is not None:
        routes.extend(routes_files.routes(deps))  # without a store: 404 not_found
    if root_path:
        routes = [Mount(root_path, routes=routes)]

    middleware = [Middleware(SecurityHeadersMiddleware, frame_ancestors=settings.frame_ancestors)]
    if settings.cors_origins:
        middleware.append(
            Middleware(
                CORSMiddleware,
                allow_origins=list(settings.cors_origins),
                allow_credentials=True,
                allow_methods=["GET", "POST", "PATCH", "DELETE"],
                allow_headers=["Content-Type", CSRF_HEADER],
            )
        )

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        await store.init()
        if deps.password_mode:
            await run_in_threadpool(routes_auth._dummy_hash)  # warm, so logins time evenly
        try:
            yield
        finally:
            tasks = [h.task for h in list(deps.live_runs.values())]
            for task in tasks:
                task.cancel()
            if tasks:
                _, pending = await asyncio.wait(tasks, timeout=SHUTDOWN_TIMEOUT_S)
                if pending:
                    log.warning("%d run(s) did not stop within %ss", len(pending),
                                SHUTDOWN_TIMEOUT_S)  # fmt: skip
            await store.close()

    app = Starlette(
        routes=routes,
        middleware=middleware,
        exception_handlers={ApiError: api_error_handler, HTTPException: http_error_handler},
        lifespan=lifespan,
    )
    app.state.live_runs = deps.live_runs
    return app
