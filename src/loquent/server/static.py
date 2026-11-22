"""Serve the prebuilt UI (index.html + assets) and the branding files."""

from __future__ import annotations

import html
import logging
import re
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

_HEAD_RE = re.compile(r"<head(\s[^>]*)?>", re.IGNORECASE)

MISSING_UI = "UI assets missing: build with `npm run build` in frontend/"

log = logging.getLogger("loquent.server")


def warn_missing_branding(settings: Settings) -> None:
    """At startup: a configured branding file that does not exist is served as a 404."""
    for name in ("custom_css_path", "logo_path"):
        p = getattr(settings, name)
        if p is not None and not Path(p).is_file():
            log.warning("%s is set but %s is not a file; it will be served as a 404", name, p)


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
        page, n = _HEAD_RE.subn(lambda m: m.group(0) + tag, page, count=1)
        if not n:
            page = tag + page
        return HTMLResponse(page, headers={"Cache-Control": "no-cache"})

    async def asset(request: Request) -> Response:
        root = (STATIC_DIR / "assets").resolve()
        try:
            target = (root / request.path_params["path"]).resolve()
            ok = target.is_relative_to(root) and target.is_file()
        except (ValueError, OSError):  # e.g. a NUL byte in the path
            ok = False
        if not ok:
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
        if p is None:
            # The page always links this stylesheet: when none is configured, an empty one
            # keeps the console clean.
            return Response("", media_type="text/css")
        if not Path(p).is_file():
            # Configured but missing is a deployment error: keep it visible as a 404 (startup
            # also logs a warning, see warn_missing_branding).
            raise HTTPException(404)
        return FileResponse(p, media_type="text/css")

    return [
        Route("/assets/{path:path}", asset, methods=["GET", "HEAD"]),
        Route("/branding/logo", logo, methods=["GET", "HEAD"]),
        Route("/branding/custom.css", custom_css, methods=["GET", "HEAD"]),
        _Fallback("/", index),
        _Fallback("/{path:path}", index),
    ]
