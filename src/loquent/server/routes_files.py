"""File upload (multipart, streamed to the FileStore) and signed-URL download."""

from __future__ import annotations

import logging
import time
import unicodedata
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from urllib.parse import quote

from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import MultipartParser, parse_options_header
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from loquent.files import FileTooLarge, sign_file_url, verify_file_sig
from loquent.protocol import new_id
from loquent.store.models import FileMeta

from .deps import MAX_DIGITS, ApiError, Deps, invalid_input, not_found

log = logging.getLogger("loquent.server")

MAX_NAME_CHARS = 255
# Allowance for multipart framing and headers on top of the file itself.
FRAMING_SLACK = 64 * 1024
MAX_HEADER_BYTES = 8 * 1024
MAX_HEADERS = 16
INLINE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})


def sanitize_name(raw: str) -> str:
    """Basename only, no control characters, at most 255 chars, ``"file"`` if nothing is left."""
    base = raw.replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in base if unicodedata.category(ch) not in ("Cc", "Cf", "Cs"))
    base = base.strip()[:MAX_NAME_CHARS].strip()
    return base if base not in ("", ".", "..") else "file"


def too_large() -> ApiError:
    return ApiError(413, "payload_too_large")


def forbidden() -> ApiError:
    return ApiError(403, "forbidden")


class _Upload:
    """Pulls the one ``file`` part out of a multipart body, chunk by chunk."""

    def __init__(self, request: Request, allowed: set[str], max_bytes: int, boundary: bytes):
        self.request = request
        self.allowed = allowed
        self.max_bytes = max_bytes
        self.name = "file"
        self.content_type = ""
        self._parts = 0
        self._buf: list[bytes] = []
        self._hfield = b""
        self._hvalue = b""
        self._headers: dict[bytes, bytes] = {}
        self._in_file = False
        self._ended = False
        self._validated = False
        self._header_bytes = 0
        self._header_count = 0
        self._parser = MultipartParser(
            boundary,
            {
                "on_part_begin": self._part_begin,
                "on_header_field": lambda d, s, e: self._append("_hfield", d[s:e]),
                "on_header_value": lambda d, s, e: self._append("_hvalue", d[s:e]),
                "on_header_end": self._header_end,
                "on_headers_finished": self._headers_finished,
                "on_part_data": self._part_data,
                "on_part_end": self._part_end,
            },
        )

    def _append(self, attr: str, data: bytes) -> None:
        self._header_bytes += len(data)
        if self._header_bytes > MAX_HEADER_BYTES:
            raise invalid_input()
        setattr(self, attr, getattr(self, attr) + data)

    def _part_begin(self) -> None:
        self._parts += 1
        if self._parts > 1:
            raise invalid_input()  # exactly one part
        self._headers = {}

    def _header_end(self) -> None:
        self._header_count += 1
        if self._header_count > MAX_HEADERS:
            raise invalid_input()
        self._headers[self._hfield.lower()] = self._hvalue
        self._hfield = self._hvalue = b""

    def _headers_finished(self) -> None:
        disp = self._headers.get(b"content-disposition", b"")
        kind, params = parse_options_header(disp)
        if kind != b"form-data" or params.get(b"name") != b"file" or b"filename" not in params:
            raise invalid_input()
        self.name = sanitize_name(params[b"filename"].decode("utf-8", "replace"))
        raw_type = self._headers.get(b"content-type", b"").decode("latin-1")
        self.content_type = raw_type.split(";", 1)[0].strip().lower()
        if self.content_type not in self.allowed:
            raise ApiError(415, "unsupported_media_type")
        self._in_file = True
        self._validated = True

    def _part_data(self, data: bytes, start: int, end: int) -> None:
        if self._in_file:
            self._buf.append(data[start:end])

    def _part_end(self) -> None:
        self._in_file = False
        self._ended = True

    def _drain(self) -> list[bytes]:
        out, self._buf = self._buf, []
        return out

    async def chunks(self) -> AsyncIterator[bytes]:
        total = 0
        async for chunk in self.request.stream():
            total += len(chunk)
            if total > self.max_bytes + FRAMING_SLACK:
                raise too_large()
            try:
                self._parser.write(chunk)
            except MultipartParseError:
                raise invalid_input() from None
            for piece in self._drain():
                if piece:
                    yield piece
        try:
            self._parser.finalize()
        except MultipartParseError:
            raise invalid_input() from None
        # Exactly one part, validated, and closed by its boundary (not a truncated body).
        if self._parts != 1 or not self._validated or not self._ended:
            raise invalid_input()


def routes(deps: Deps) -> list[Route]:
    store = deps.store
    settings = deps.settings
    file_store = deps.file_store
    assert file_store is not None
    allowed = {t.lower() for t in settings.allowed_upload_types}
    max_bytes = settings.max_upload_mb * 1024 * 1024

    async def upload(request: Request) -> JSONResponse:
        user = await deps.user(request)
        if deps.rate_limiter is not None and not await deps.rate_limiter(request, user):
            raise ApiError(429, "rate_limited")
        ctype, params = parse_options_header(request.headers.get("content-type", "").encode())
        boundary = params.get(b"boundary")
        if ctype != b"multipart/form-data" or not boundary:
            raise ApiError(415, "unsupported_media_type")
        declared = request.headers.get("content-length", "")
        if declared.isascii() and declared.isdigit():
            if len(declared) > MAX_DIGITS:
                raise invalid_input()
            if int(declared) > max_bytes + FRAMING_SLACK:
                raise too_large()

        up = _Upload(request, allowed, max_bytes, boundary)
        file_id = new_id()
        try:
            size = await file_store.save(file_id, up.chunks(), max_bytes)
        except FileTooLarge:
            raise too_large() from None
        meta = FileMeta(
            id=file_id, owner_id=user.id, name=up.name, content_type=up.content_type,
            size=size, created_at=datetime.now(UTC),
        )  # fmt: skip
        try:
            await store.save_file_meta(meta)
        except BaseException:
            await file_store.delete(file_id)
            raise
        url = sign_file_url(file_id, settings.effective_secret(), int(time.time()))
        return JSONResponse(
            {
                "id": meta.id, "name": meta.name, "content_type": meta.content_type,
                "size": meta.size, "url": url,
            }
        )  # fmt: skip

    async def download(request: Request) -> Response:
        file_id = request.path_params["file_id"]
        exp_raw = request.query_params.get("exp", "")
        sig = request.query_params.get("sig", "")
        if not (exp_raw.isascii() and exp_raw.isdigit()) or len(exp_raw) > MAX_DIGITS or not sig:
            raise forbidden()
        if not verify_file_sig(
            file_id, int(exp_raw), sig, settings.effective_secret(), int(time.time())
        ):
            raise forbidden()
        meta = await store.get_file_meta(file_id)
        if meta is None:
            raise not_found()
        try:
            data = await file_store.read(file_id)
        except (FileNotFoundError, ValueError):
            raise not_found() from None
        kind = "inline" if meta.content_type in INLINE_TYPES else "attachment"
        return Response(
            data,
            media_type=meta.content_type,
            headers={
                "Content-Disposition": f"{kind}; filename*=UTF-8''{quote(meta.name, safe='')}",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, max-age=300",
            },
        )

    async def fresh_url(request: Request) -> JSONResponse:
        user = await deps.user(request)
        meta = await store.get_file_meta(request.path_params["file_id"])
        if meta is None or meta.owner_id != user.id:
            raise not_found()
        url = sign_file_url(meta.id, settings.effective_secret(), int(time.time()))
        return JSONResponse({"url": url})

    return [
        Route("/api/files", upload, methods=["POST"]),
        Route("/api/files/{file_id}/url", fresh_url, methods=["GET"]),
        Route("/api/files/{file_id}", download, methods=["GET"]),
    ]
