"""Uploaded-file storage and HMAC-signed download URLs."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Protocol

from loquent.protocol import new_id

SIGNED_URL_TTL_S = 300
_ID_RE = re.compile(r"[0-9a-f]{32}")


class FileTooLarge(Exception):
    """The file is bigger than the allowed size."""


class FileStore(Protocol):
    async def save(self, file_id: str, chunks: AsyncIterator[bytes], max_bytes: int) -> int:
        """Store the chunks; return the size. Raises ``FileTooLarge``, leaving no partial file."""
        ...

    async def read(self, file_id: str) -> bytes: ...

    async def delete(self, file_id: str) -> None: ...


def _check_id(file_id: str) -> None:
    if not _ID_RE.fullmatch(file_id):
        raise ValueError("invalid file id")


class LocalFileStore:
    """Files in one directory, named by their id only (never by a user-supplied name)."""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)

    async def save(self, file_id: str, chunks: AsyncIterator[bytes], max_bytes: int) -> int:
        _check_id(file_id)
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.root / f".{file_id}.{new_id()}.tmp"
        size = 0
        try:
            f = await asyncio.to_thread(open, tmp, "wb")
            try:
                async for chunk in chunks:
                    size += len(chunk)
                    if size > max_bytes:
                        raise FileTooLarge
                    await asyncio.to_thread(f.write, chunk)
            finally:
                await asyncio.to_thread(f.close)
            os.replace(tmp, self.root / file_id)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return size

    async def read(self, file_id: str) -> bytes:
        _check_id(file_id)
        return await asyncio.to_thread((self.root / file_id).read_bytes)

    async def delete(self, file_id: str) -> None:
        _check_id(file_id)
        await asyncio.to_thread((self.root / file_id).unlink, True)


def _mac(file_id: str, exp: int, secret: str) -> str:
    msg = f"loquent-file:{file_id}:{exp}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def sign_file_url(file_id: str, secret: str, now: int, ttl_s: int = SIGNED_URL_TTL_S) -> str:
    """A relative download URL (``api/files/<id>?exp=..&sig=..``) valid for ``ttl_s`` seconds."""
    exp = now + ttl_s
    return f"api/files/{file_id}?exp={exp}&sig={_mac(file_id, exp, secret)}"


def verify_file_sig(file_id: str, exp: int, sig: str, secret: str, now: int) -> bool:
    if now > exp:
        return False
    return hmac.compare_digest(_mac(file_id, exp, secret).encode(), sig.encode())
