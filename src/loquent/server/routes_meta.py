"""Health check and public UI configuration."""

from __future__ import annotations

import logging

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .deps import Deps

log = logging.getLogger("loquent.server")


def routes(deps: Deps) -> list[Route]:
    async def healthz(request: Request) -> JSONResponse:
        try:
            ok = await deps.store.ping()
        except Exception:
            log.exception("store ping failed")
            ok = False
        if not ok:
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return JSONResponse({"status": "ok"})

    async def config(request: Request) -> JSONResponse:
        # Built from an explicit allowlist: never secrets, model names or backend URLs.
        s = deps.settings
        return JSONResponse(
            {
                "app_name": s.app_name,
                "logo_url": "branding/logo" if s.logo_path is not None else None,
                "theme": dict(s.theme),
                "hide": list(s.hide),
                "auth": deps.authenticator.mode,
                "widgets": bool(deps.adapter.supports_widgets),
                "attachments": bool(deps.adapter.supports_attachments)
                and deps.file_store is not None,
                "max_upload_mb": s.max_upload_mb,
            }
        )

    return [
        Route("/healthz", healthz, methods=["GET"]),
        Route("/api/config", config, methods=["GET"]),
    ]
