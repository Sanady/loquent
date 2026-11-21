"""Loquent configuration, read from LOQUENT_* environment variables."""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Literal

from pydantic import Field, PrivateAttr, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Copies of THEMES and COLOR_TOKENS in frontend/src/themes.ts (tests/test_settings.py keeps
# them in sync).
THEME_IDS = ("graphite", "graphite-dark", "editorial", "midnight")
COLOR_TOKENS = (
    "bg",
    "bg-subtle",
    "surface",
    "surface-raised",
    "border",
    "border-strong",
    "text",
    "text-muted",
    "text-subtle",
    "accent",
    "accent-hover",
    "accent-text",
    "accent-soft",
    "user-bubble",
    "user-bubble-text",
    "code-bg",
    "focus-ring",
    "success",
    "warning",
    "danger",
    "scrim",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LOQUENT_")

    # server
    host: str = "127.0.0.1"
    port: int = 8000
    root_path: str = ""
    forwarded_allow_ips: list[str] = ["127.0.0.1"]

    # storage
    store_url: str = "sqlite:///./loquent.db"
    files_dir: str = "./loquent-files"

    # auth
    auth: Literal["none", "password"] = "none"
    insecure_no_auth: bool = False
    secret_key: SecretStr | None = None

    # embedding
    cors_origins: list[str] = []
    frame_ancestors: list[str] = []

    # uploads
    max_upload_mb: int = 20
    allowed_upload_types: list[str] = [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/json",
    ]

    # branding
    app_name: str = "Chat"
    logo_path: Path | None = None
    theme: dict[str, str] = {}
    custom_css_path: Path | None = None
    hide: list[Literal["thread_list"]] = []

    # themes and user appearance
    default_theme: Literal["system", "graphite", "graphite-dark", "editorial", "midnight"] = (
        "system"
    )
    themes: list[str] = list(THEME_IDS)
    allow_user_css: bool = True
    allow_user_prefs: bool = True
    lock_tokens: list[str] = []
    max_user_css_kb: int = Field(default=64, gt=0)

    # agent
    widgets: bool = True  # advertise the widget tools to the agent
    forward_headers: list[str] = []
    model: str | None = None
    api_key: SecretStr | None = None

    _random_key: str | None = PrivateAttr(default=None)

    @field_validator("themes")
    @classmethod
    def _known_themes(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("themes must list at least one theme")
        unknown = [t for t in v if t not in THEME_IDS]
        if unknown:
            raise ValueError(f"unknown themes {unknown}; known: {list(THEME_IDS)}")
        if len(set(v)) != len(v):
            raise ValueError("themes must not repeat a theme")
        return v

    @field_validator("lock_tokens")
    @classmethod
    def _known_tokens(cls, v: list[str]) -> list[str]:
        unknown = [t for t in v if t not in COLOR_TOKENS]
        if unknown:
            raise ValueError(
                f"unknown color tokens {unknown}; use names without the --lq- prefix, "
                f"one of: {', '.join(COLOR_TOKENS)}"
            )
        return v

    @model_validator(mode="after")
    def _default_theme_allowed(self) -> Settings:
        if self.default_theme != "system" and self.default_theme not in self.themes:
            raise ValueError(
                f"default_theme {self.default_theme!r} is not in themes {self.themes}; "
                'add it to themes or use "system"'
            )
        return self

    def effective_secret(self) -> str:
        """The configured secret key, or one random key per Settings instance."""
        if self.secret_key is not None and self.secret_key.get_secret_value():
            return self.secret_key.get_secret_value()
        if self._random_key is None:
            self._random_key = secrets.token_urlsafe(32)
        return self._random_key
