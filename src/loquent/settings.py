"""Loquent configuration, read from LOQUENT_* environment variables."""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Literal

from pydantic import PrivateAttr, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # agent
    widgets: bool = True  # advertise the widget tools to the agent
    forward_headers: list[str] = []
    model: str | None = None
    api_key: SecretStr | None = None

    _random_key: str | None = PrivateAttr(default=None)

    def effective_secret(self) -> str:
        """The configured secret key, or one random key per Settings instance."""
        if self.secret_key is not None and self.secret_key.get_secret_value():
            return self.secret_key.get_secret_value()
        if self._random_key is None:
            self._random_key = secrets.token_urlsafe(32)
        return self._random_key
