"""MongoDB backend (pymongo async client). Timestamps are stored with millisecond precision."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

from pymongo import DESCENDING, AsyncMongoClient, ReplaceOne
from pymongo.errors import DuplicateKeyError

from ..protocol import new_id
from .models import FileMeta, Run, RunInProgress, RunStatus, StoredEvent, Thread, User

_last_ord = 0


def _now() -> datetime:
    """UTC now truncated to milliseconds (Mongo's datetime precision)."""
    n = datetime.now(UTC)
    return n.replace(microsecond=n.microsecond // 1000 * 1000)


def _ord() -> int:
    """Process-monotonic tiebreaker for rows created/updated within the same millisecond."""
    global _last_ord
    _last_ord = max(_last_ord + 1, time.time_ns())
    return _last_ord


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _ms(dt: datetime) -> datetime:
    dt = _utc(dt)
    return dt.replace(microsecond=dt.microsecond // 1000 * 1000)


def _user(d: dict) -> User:
    return User(
        id=d["_id"], username=d["username"], password_hash=d["password_hash"],
        created_at=_utc(d["created_at"]),
    )  # fmt: skip


def _thread(d: dict) -> Thread:
    return Thread(
        id=d["_id"], owner_id=d["owner_id"], title=d["title"],
        created_at=_utc(d["created_at"]), updated_at=_utc(d["updated_at"]),
    )  # fmt: skip


def _run(d: dict) -> Run:
    return Run(
        id=d["_id"], thread_id=d["thread_id"], status=d["status"],
        created_at=_utc(d["created_at"]), heartbeat_at=_utc(d["heartbeat_at"]),
        finished_at=_utc(d.get("finished_at")), error=d.get("error"),
        cancel_requested=bool(d.get("cancel_requested", False)),
        superseded=bool(d.get("superseded", False)),
    )  # fmt: skip


class MongoStore:
    def __init__(self, url: str, db_name: str = "loquent") -> None:
        self._url = url
        self._db_name = db_name
        self._client: AsyncMongoClient | None = None
        self._db = None

    async def init(self) -> None:
        self._client = AsyncMongoClient(self._url, tz_aware=True, tzinfo=UTC)
        self._db = self._client[self._db_name]
        await self._db.users.create_index("username", unique=True)
        await self._db.threads.create_index([("owner_id", 1), ("updated_at", -1)])
        await self._db.threads.create_index("active_run_id")  # heartbeat/finish look runs up
        await self._db.runs.create_index([("thread_id", 1), ("created_at", 1)])
        await self._db.events.create_index([("run_id", 1), ("seq", 1)], unique=True)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def ping(self) -> bool:
        try:
            await self._client.admin.command("ping")
            return True
        except Exception:  # noqa: BLE001
            return False

    # users
    async def create_user(self, username: str, password_hash: str) -> User:
        u = User(id=new_id(), username=username, password_hash=password_hash, created_at=_now())
        try:
            await self._db.users.insert_one(
                {"_id": u.id, "username": username, "password_hash": password_hash,
                 "created_at": u.created_at}
            )  # fmt: skip
        except DuplicateKeyError as e:
            raise ValueError(f"username already exists: {username}") from e
        return u

    async def get_user(self, user_id: str) -> User | None:
        d = await self._db.users.find_one({"_id": user_id})
        return _user(d) if d else None

    async def get_user_by_username(self, username: str) -> User | None:
        d = await self._db.users.find_one({"username": username})
        return _user(d) if d else None

    # threads
    async def create_thread(self, owner_id: str, title: str) -> Thread:
        now = _now()
        t = Thread(id=new_id(), owner_id=owner_id, title=title, created_at=now, updated_at=now)
        await self._db.threads.insert_one(
            {"_id": t.id, "owner_id": owner_id, "title": title, "created_at": now,
             "updated_at": now, "ord": _ord(), "active_run_id": None,
             "active_heartbeat_at": None}
        )  # fmt: skip
        return t

    async def get_thread(self, thread_id: str) -> Thread | None:
        d = await self._db.threads.find_one({"_id": thread_id})
        return _thread(d) if d else None

    async def list_threads(self, owner_id: str, limit: int = 50) -> list[Thread]:
        cur = (
            self._db.threads.find({"owner_id": owner_id})
            .sort([("updated_at", DESCENDING), ("ord", DESCENDING)])
            .limit(limit)
        )
        return [_thread(d) async for d in cur]

    async def rename_thread(self, thread_id: str, title: str) -> None:
        await self._db.threads.update_one(
            {"_id": thread_id}, {"$set": {"title": title, "updated_at": _now(), "ord": _ord()}}
        )

    async def delete_thread(self, thread_id: str) -> None:
        run_ids = [d["_id"] async for d in self._db.runs.find({"thread_id": thread_id}, {"_id": 1})]
        if run_ids:
            await self._db.events.delete_many({"run_id": {"$in": run_ids}})
            await self._db.runs.delete_many({"thread_id": thread_id})
        await self._db.threads.delete_one({"_id": thread_id})

    # runs
    async def create_run(self, thread_id: str, *, stale_after_s: float = 30) -> Run:
        now = _now()
        cutoff = now - timedelta(seconds=stale_after_s)
        run = Run(
            id=new_id(), thread_id=thread_id, status="running",
            created_at=now, heartbeat_at=now,
        )  # fmt: skip
        claimed = await self._db.threads.find_one_and_update(
            {
                "_id": thread_id,
                "$or": [
                    {"active_run_id": None},
                    {"active_heartbeat_at": {"$lte": cutoff}},
                ],
            },
            {"$set": {"active_run_id": run.id, "active_heartbeat_at": now,
                      "updated_at": now, "ord": _ord()}},
        )  # fmt: skip
        if claimed is None:
            raise RunInProgress(thread_id)
        await self._db.runs.insert_one(
            {"_id": run.id, "thread_id": thread_id, "status": "running", "created_at": now,
             "heartbeat_at": now, "finished_at": None, "error": None,
             "cancel_requested": False, "superseded": False, "ord": _ord()}
        )  # fmt: skip
        return run

    async def get_run(self, run_id: str) -> Run | None:
        d = await self._db.runs.find_one({"_id": run_id})
        return _run(d) if d else None

    async def list_runs(self, thread_id: str) -> list[Run]:
        cur = self._db.runs.find({"thread_id": thread_id}).sort([("created_at", 1), ("ord", 1)])
        return [_run(d) async for d in cur]

    async def heartbeat(self, run_id: str) -> None:
        now = _now()
        await self._db.runs.update_one({"_id": run_id}, {"$set": {"heartbeat_at": now}})
        await self._db.threads.update_one(
            {"active_run_id": run_id}, {"$set": {"active_heartbeat_at": now}}
        )

    async def finish_run(self, run_id: str, status: RunStatus, error: str | None = None) -> None:
        res = await self._db.runs.update_one(
            {"_id": run_id, "status": "running"},
            {"$set": {"status": status, "error": error, "finished_at": _now()}},
        )
        if res.modified_count:
            await self._db.threads.update_one(
                {"active_run_id": run_id},
                {"$set": {"active_run_id": None, "active_heartbeat_at": None}},
            )

    async def request_cancel(self, run_id: str) -> None:
        await self._db.runs.update_one({"_id": run_id}, {"$set": {"cancel_requested": True}})

    async def is_cancel_requested(self, run_id: str) -> bool:
        d = await self._db.runs.find_one({"_id": run_id}, {"cancel_requested": 1})
        return d is None or bool(d.get("cancel_requested"))  # a deleted run must stop

    async def mark_superseded(self, run_id: str) -> None:
        await self._db.runs.update_one({"_id": run_id}, {"$set": {"superseded": True}})

    # events
    async def append_events(self, run_id: str, events: list[StoredEvent]) -> None:
        if not events:
            return
        await self._db.events.bulk_write(
            [
                ReplaceOne(
                    {"run_id": run_id, "seq": e.seq},
                    {"run_id": run_id, "seq": e.seq, "is_input": e.is_input, "event": e.event},
                    upsert=True,
                )
                for e in events
            ],
            ordered=True,
        )

    async def list_events(self, run_id: str, after_seq: int = 0) -> list[StoredEvent]:
        cur = self._db.events.find({"run_id": run_id, "seq": {"$gt": after_seq}}).sort("seq", 1)
        return [
            StoredEvent(seq=d["seq"], event=d["event"], is_input=bool(d["is_input"]))
            async for d in cur
        ]

    async def thread_events(self, thread_id: str) -> list[dict]:
        out: list[dict] = []
        for run in await self.list_runs(thread_id):
            for e in await self.list_events(run.id):
                if e.is_input or not run.superseded:
                    out.append(e.event)
        return out

    # files
    async def save_file_meta(self, meta: FileMeta) -> None:
        await self._db.files.replace_one(
            {"_id": meta.id},
            {"_id": meta.id, "owner_id": meta.owner_id, "name": meta.name,
             "content_type": meta.content_type, "size": meta.size,
             "created_at": _ms(meta.created_at),
             "created_at_us": _utc(meta.created_at).microsecond % 1000},
            upsert=True,
        )  # fmt: skip

    async def get_file_meta(self, file_id: str) -> FileMeta | None:
        d = await self._db.files.find_one({"_id": file_id})
        if not d:
            return None
        return FileMeta(
            id=d["_id"], owner_id=d["owner_id"], name=d["name"],
            content_type=d["content_type"], size=d["size"],
            created_at=_utc(d["created_at"]) + timedelta(microseconds=d.get("created_at_us", 0)),
        )  # fmt: skip
