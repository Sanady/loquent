"""Login, logout and the current user."""

from __future__ import annotations

import functools

from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from loquent.auth import SESSION_COOKIE, SESSION_MAX_AGE_S, hash_password, verify_password

from .deps import ApiError, Deps, json_body, not_found, public_user


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    password: str


@functools.cache
def _dummy_hash() -> str:
    """A real argon2 hash to verify against for unknown users, so timing matches."""
    return hash_password("loquent-dummy-password")


async def _dummy() -> str:
    return await run_in_threadpool(_dummy_hash)


def routes(deps: Deps) -> list[Route]:
    async def login(request: Request) -> JSONResponse:
        if not deps.password_mode:
            raise not_found()
        body = await json_body(request, LoginBody)
        user = await deps.store.get_user_by_username(body.username)
        # argon2 is slow on purpose; keep it off the event loop
        if user is None or not user.password_hash.startswith("$argon2"):
            await run_in_threadpool(verify_password, await _dummy(), body.password)
            raise ApiError(401, "unauthorized")
        if not await run_in_threadpool(verify_password, user.password_hash, body.password):
            raise ApiError(401, "unauthorized")
        cookie, csrf = deps.sessions.issue(user.id)
        response = JSONResponse({"user": public_user(user), "csrf": csrf})
        response.set_cookie(
            SESSION_COOKIE,
            cookie,
            max_age=SESSION_MAX_AGE_S,
            path=deps.cookie_path,
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
        )
        return response

    async def logout(request: Request) -> JSONResponse:
        await deps.user(request)
        response = JSONResponse({"ok": True})
        response.delete_cookie(
            SESSION_COOKIE,
            path=deps.cookie_path,
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
        )
        return response

    async def me(request: Request) -> JSONResponse:
        user = await deps.user(request)
        csrf = (deps.session_csrf(request) or "") if deps.password_mode else ""
        return JSONResponse({"user": public_user(user), "csrf": csrf})

    return [
        Route("/api/auth/login", login, methods=["POST"]),
        Route("/api/auth/logout", logout, methods=["POST"]),
        Route("/api/auth/me", me, methods=["GET"]),
    ]
