"""Password hashing, signed sessions, pluggable authenticators, bind-safety guard."""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from typing import Protocol

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from itsdangerous import BadData, URLSafeTimedSerializer
from starlette.requests import Request

from .settings import Settings
from .store.base import Store
from .store.models import User

log = logging.getLogger("loquent.auth")

SESSION_COOKIE = "loquent_session"
SESSION_MAX_AGE_S = 7 * 24 * 3600
_SALT = "loquent.session"
LOCAL_USERNAME = "local"
UNUSABLE_HASH = "!"
LOCALHOSTS = frozenset({"127.0.0.1", "::1", "localhost"})

_hasher = PasswordHasher()


class InsecureConfigError(Exception):
    """Raised when the configuration would expose Loquent unsafely."""


def hash_password(pw: str) -> str:
    return _hasher.hash(pw)


def verify_password(hash: str, pw: str) -> bool:
    try:
        return _hasher.verify(hash, pw)
    except (VerificationError, InvalidHashError):
        return False


@dataclass
class Session:
    user_id: str
    csrf: str


class SessionManager:
    def __init__(self, secret: str) -> None:
        self._ser = URLSafeTimedSerializer(secret, salt=_SALT)

    def issue(self, user_id: str) -> tuple[str, str]:
        csrf = secrets.token_urlsafe(32)
        return self._ser.dumps({"uid": user_id, "csrf": csrf}), csrf

    def read(self, cookie_value: str) -> Session | None:
        try:
            data = self._ser.loads(cookie_value, max_age=SESSION_MAX_AGE_S)
            return Session(user_id=str(data["uid"]), csrf=str(data["csrf"]))
        except (BadData, KeyError, TypeError, ValueError):
            return None


class Authenticator(Protocol):
    mode: str

    async def current_user(self, request: Request, store: Store) -> User | None: ...


class NoAuth:
    mode = "none"

    async def current_user(self, request: Request, store: Store) -> User | None:
        user = await store.get_user_by_username(LOCAL_USERNAME)
        if user is None:
            user = await store.create_user(LOCAL_USERNAME, UNUSABLE_HASH)
        return user


class PasswordAuth:
    mode = "password"

    def __init__(self, sessions: SessionManager) -> None:
        self.sessions = sessions

    async def current_user(self, request: Request, store: Store) -> User | None:
        cookie = request.cookies.get(SESSION_COOKIE)
        if not cookie:
            return None
        session = self.sessions.read(cookie)
        if session is None:
            return None
        return await store.get_user(session.user_id)


def check_bind_safety(settings: Settings) -> None:
    if settings.auth == "password":
        if settings.secret_key is None:
            raise InsecureConfigError("auth='password' requires LOQUENT_SECRET_KEY to be set")
        return
    if settings.host not in LOCALHOSTS and not settings.insecure_no_auth:
        raise InsecureConfigError(
            f"Refusing to bind {settings.host!r} with auth='none'. Use auth='password' "
            "or set insecure_no_auth=True to override."
        )
    if settings.secret_key is None:
        log.warning("No secret_key set; using a random per-process key (sessions reset on restart)")
