from __future__ import annotations

from .base import Store


def open_store(url: str) -> Store:
    if url.startswith("sqlite:///"):
        from .sqlite import SqliteStore

        return SqliteStore(url[len("sqlite:///") :])
    if url.startswith(("mongodb://", "mongodb+srv://")):
        try:
            from .mongo import MongoStore
        except ImportError as e:
            raise ImportError(
                "MongoDB support requires the extra: pip install 'loquent[mongo]'"
            ) from e
        return MongoStore(url)
    raise ValueError(f"unsupported store url: {url!r}")
