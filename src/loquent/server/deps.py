"""Shared server state, error type and request helpers (auth, CSRF, JSON bodies, ownership)."""

from __future__ import annotations

import hmac
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from loquent.adapters.base import Adapter
from loquent.auth import SESSION_COOKIE, Authenticator, SessionManager
from loquent.files import FileStore
from loquent.runner import RunHandle
from loquent.settings import Settings
from loquent.store.base import Store
from loquent.store.models import Run, Thread, User

RateLimiter = Callable[[Request, User | None], Awaitable[bool]]

CSRF_HEADER = "X-Loquent-CSRF"
MAX_JSON_BYTES = 1024 * 1024
MAX_DIGITS = 12  # longest numeric header/query value parsed with int()
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

M = TypeVar("M", bound=BaseModel)


class ApiError(Exception):
    """Turned into ``{"error": code}`` with the given HTTP status."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def not_found() -> ApiError:
    return ApiError(404, "not_found")


def invalid_input() -> ApiError:
    return ApiError(400, "invalid_input")


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return JSONResponse({"error": exc.code}, status_code=exc.status)


_HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


async def http_error_handler(request: Request, exc: Exception) -> Response:
    """Starlette's own errors (unknown route, wrong method) as ``{"error": code}`` too."""
    assert isinstance(exc, HTTPException)
    if exc.status_code in (204, 304):
        return Response(status_code=exc.status_code, headers=exc.headers)
    code = _HTTP_CODES.get(exc.status_code, "http_error")
    return JSONResponse({"error": code}, status_code=exc.status_code, headers=exc.headers)


@dataclass
class Deps:
    adapter: Adapter
    settings: Settings
    store: Store
    file_store: FileStore | None
    authenticator: Authenticator
    sessions: SessionManager
    rate_limiter: RateLimiter | None
    cookie_path: str
    # In-flight runs, kept only so shutdown can cancel them. Entries leave when the task ends.
    live_runs: dict[str, RunHandle] = field(default_factory=dict)

    @property
    def password_mode(self) -> bool:
        return self.authenticator.mode == "password"

    def session_csrf(self, request: Request) -> str | None:
        session = self.sessions.read(request.cookies.get(SESSION_COOKIE, ""))
        return session.csrf if session is not None else None

    async def user(self, request: Request) -> User:
        """The signed-in user (401 if none); non-GET requests in password mode need CSRF."""
        user = await self.authenticator.current_user(request, self.store)
        if user is None:
            raise ApiError(401, "unauthorized")
        # Without sessions there is no token to check, but a custom header can't be sent
        # cross-site without a CORS preflight, so requiring it (any value) blocks such posts.
        if (
            not self.password_mode
            and request.method not in _SAFE_METHODS
            and CSRF_HEADER not in request.headers
        ):
            raise ApiError(403, "csrf")
        if self.password_mode and request.method not in _SAFE_METHODS:
            expected = self.session_csrf(request)
            given = request.headers.get(CSRF_HEADER, "")
            if (
                not expected
                or not given
                or not hmac.compare_digest(expected.encode(), given.encode())
            ):
                raise ApiError(403, "csrf")
        return user

    async def owned_thread(self, user: User, thread_id: str) -> Thread:
        thread = await self.store.get_thread(thread_id)
        if thread is None or thread.owner_id != user.id:
            raise not_found()
        return thread

    async def owned_run(self, user: User, run_id: str) -> Run:
        run = await self.store.get_run(run_id)
        if run is None:
            raise not_found()
        await self.owned_thread(user, run.thread_id)
        return run


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-standard JSON constant {name}")


async def json_body(request: Request, model: type[M]) -> M:
    """Parse a JSON request body into ``model``.

    Requires ``Content-Type: application/json`` (415 otherwise): a cross-site form or
    ``text/plain`` post can't carry it without a CORS preflight, which blocks simple-request
    CSRF when there's no session to check (auth ``none``). Bad bodies are 400.
    """
    ctype = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if ctype != "application/json":
        raise ApiError(415, "unsupported_media_type")
    declared = request.headers.get("content-length", "")
    if (
        declared.isascii()
        and declared.isdigit()
        and (len(declared) > MAX_DIGITS or int(declared) > MAX_JSON_BYTES)
    ):
        raise invalid_input()
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_JSON_BYTES:
            raise invalid_input()
        chunks.append(chunk)
    raw = b"".join(chunks)
    try:
        data = json.loads(raw, parse_constant=_reject_constant)
        return model.model_validate(data)
    except (ValueError, ValidationError):
        raise invalid_input() from None


def public_user(user: User) -> dict[str, str]:
    return {"id": user.id, "username": user.username}
