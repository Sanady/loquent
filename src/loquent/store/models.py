"""Persistence models shared by every Store backend."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

RunStatus = Literal["running", "succeeded", "failed", "cancelled", "interrupted"]


class User(BaseModel):
    id: str
    username: str
    password_hash: str
    created_at: datetime


class Thread(BaseModel):
    id: str
    owner_id: str
    title: str
    created_at: datetime
    updated_at: datetime


class Run(BaseModel):
    id: str
    thread_id: str
    status: RunStatus
    created_at: datetime
    heartbeat_at: datetime
    finished_at: datetime | None = None
    error: str | None = None
    cancel_requested: bool = False
    superseded: bool = False


class StoredEvent(BaseModel):
    seq: int
    event: dict
    is_input: bool = False


class FileMeta(BaseModel):
    id: str
    owner_id: str
    name: str
    content_type: str
    size: int
    created_at: datetime


class RunInProgress(Exception):
    """Raised when a thread already has a live (non-stale) running run."""
