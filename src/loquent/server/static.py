"""Serve the prebuilt UI (index.html + assets) and the branding files."""

from __future__ import annotations

import html
from importlib.resources import files
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from starlette.routing import Match, Route
from starlette.types import Scope

from loquent.settings import Settings

# Module-level so tests can point it at a temp dir.
STATIC_DIR: Path = Path(str(files("loquent.server") / "static"))

MISSING_UI = "UI assets missing: build with `npm run build` in frontend/"


def _normalize(root_path: str) -> str:
    rp = root_path.strip().rstrip("/")
    return ("/" + rp.lstrip("/")) if rp else ""


class _Fallback(Route):
    """GET/HEAD catch-all for non-API paths only.

    Anything else reports no match, so unknown ``/api/*`` paths and wrong methods keep the
    router's own 404/405 JSON handling instead of being swallowed by the UI fallback.
    """

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        match, child = super().matches(scope)
        if match is not Match.FULL:
            return Match.NONE, {}
        path = child["path_params"].get("path", "")
        if path == "api" or path.startswith("api/"):
            return Match.NONE, {}
        return match, child


def routes(settings: Settings) -> list[Route]:
    def base_prefix(request: Request) -> str:
        return _normalize(request.scope.get("root_path", "")) or _normalize(settings.root_path)

    async def index(request: Request) -> Response:
        index_file = STATIC_DIR / "index.html"
        if not index_file.is_file():
            return PlainTextResponse(MISSING_UI, status_code=503)
        page = index_file.read_text(encoding="utf-8")
        tag = f'<base href="{html.escape(base_prefix(request), quote=True)}/">'
        if "<head>" in page:
            page = page.replace("<head>", "<head>" + tag, 1)
        else:
            page = tag + page
        return HTMLResponse(page, headers={"Cache-Control": "no-cache"})

    async def asset(request: Request) -> Response:
        root = (STATIC_DIR / "assets").resolve()
        target = (root / request.path_params["path"]).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise HTTPException(404)
        return FileResponse(
            target, headers={"Cache-Control": "public, max-age=31536000, immutable"}
        )

    async def logo(request: Request) -> Response:
        p = settings.logo_path
        if p is None or not Path(p).is_file():
            raise HTTPException(404)
        return FileResponse(p)

    async def custom_css(request: Request) -> Response:
        p = settings.custom_css_path
        if p is None or not Path(p).is_file():
            raise HTTPException(404)
        return FileResponse(p, media_type="text/css")

    return [
        Route("/assets/{path:path}", asset, methods=["GET", "HEAD"]),
        Route("/branding/logo", logo, methods=["GET", "HEAD"]),
        Route("/branding/custom.css", custom_css, methods=["GET", "HEAD"]),
        _Fallback("/", index),
        _Fallback("/{path:path}", index),
    ]
