"""SQLite backend: one shared aiosqlite connection, writes serialised by a lock."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta

import aiosqlite

from ..protocol import new_id
from .models import FileMeta, Run, RunInProgress, RunStatus, StoredEvent, Thread, User

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS threads_owner ON threads(owner_id, updated_at);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, finished_at TEXT, error TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0, superseded INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS runs_thread ON runs(thread_id, created_at);
CREATE TABLE IF NOT EXISTS events (
    run_id TEXT NOT NULL, seq INTEGER NOT NULL, is_input INTEGER NOT NULL, json TEXT NOT NULL,
    PRIMARY KEY (run_id, seq));
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    content_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
"""


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def _dt(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s) if s else None


def _run(r: aiosqlite.Row) -> Run:
    return Run(
        id=r["id"], thread_id=r["thread_id"], status=r["status"],
        created_at=_dt(r["created_at"]), heartbeat_at=_dt(r["heartbeat_at"]),
        finished_at=_dt(r["finished_at"]), error=r["error"],
        cancel_requested=bool(r["cancel_requested"]), superseded=bool(r["superseded"]),
    )  # fmt: skip


def _thread(r: aiosqlite.Row) -> Thread:
    return Thread(
        id=r["id"], owner_id=r["owner_id"], title=r["title"],
        created_at=_dt(r["created_at"]), updated_at=_dt(r["updated_at"]),
    )  # fmt: skip


def _user(r: aiosqlite.Row) -> User:
    return User(
        id=r["id"], username=r["username"], password_hash=r["password_hash"],
        created_at=_dt(r["created_at"]),
    )  # fmt: skip


class SqliteStore:
    def __init__(self, path: str) -> None:
        self._path = path
        self._db: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    @property
    def db(self) -> aiosqlite.Connection:
        assert self._db is not None, "store not initialised; call init()"
        return self._db

    async def init(self) -> None:
        self._db = await aiosqlite.connect(self._path, isolation_level=None)
        self._db.row_factory = aiosqlite.Row
        if self._path != ":memory:":
            await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.executescript(_SCHEMA)

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    async def ping(self) -> bool:
        try:
            await (await self.db.execute("SELECT 1")).close()
            return True
        except Exception:  # noqa: BLE001
            return False

    async def _one(self, sql: str, args: tuple = ()) -> aiosqlite.Row | None:
        async with self.db.execute(sql, args) as cur:
            return await cur.fetchone()

    async def _all(self, sql: str, args: tuple = ()) -> list[aiosqlite.Row]:
        async with self.db.execute(sql, args) as cur:
            return list(await cur.fetchall())

    async def _write(self, sql: str, args: tuple = ()) -> None:
        async with self._lock:
            await self.db.execute(sql, args)

    # users
    async def create_user(self, username: str, password_hash: str) -> User:
        u = User(id=new_id(), username=username, password_hash=password_hash, created_at=_now())
        try:
            await self._write(
                "INSERT INTO users VALUES (?,?,?,?)",
                (u.id, u.username, u.password_hash, _iso(u.created_at)),
            )
        except aiosqlite.IntegrityError as e:
            raise ValueError(f"username already exists: {username}") from e
        return u

    async def get_user(self, user_id: str) -> User | None:
        r = await self._one("SELECT * FROM users WHERE id=?", (user_id,))
        return _user(r) if r else None

    async def get_user_by_username(self, username: str) -> User | None:
        r = await self._one("SELECT * FROM users WHERE username=?", (username,))
        return _user(r) if r else None

    # threads
    async def create_thread(self, owner_id: str, title: str) -> Thread:
        now = _now()
        t = Thread(id=new_id(), owner_id=owner_id, title=title, created_at=now, updated_at=now)
        await self._write(
            "INSERT INTO threads VALUES (?,?,?,?,?)",
            (t.id, owner_id, title, _iso(now), _iso(now)),
        )
        return t

    async def get_thread(self, thread_id: str) -> Thread | None:
        r = await self._one("SELECT * FROM threads WHERE id=?", (thread_id,))
        return _thread(r) if r else None

    async def list_threads(self, owner_id: str, limit: int = 50) -> list[Thread]:
        rows = await self._all(
            "SELECT * FROM threads WHERE owner_id=? ORDER BY updated_at DESC, rowid DESC LIMIT ?",
            (owner_id, limit),
        )
        return [_thread(r) for r in rows]

    async def rename_thread(self, thread_id: str, title: str) -> None:
        await self._write(
            "UPDATE threads SET title=?, updated_at=? WHERE id=?",
            (title, _iso(_now()), thread_id),
        )

    async def delete_thread(self, thread_id: str) -> None:
        async with self._lock:
            await self.db.execute("BEGIN IMMEDIATE")
            try:
                run_ids = "SELECT id FROM runs WHERE thread_id=?"
                await self.db.execute(
                    f"DELETE FROM events WHERE run_id IN ({run_ids})", (thread_id,)
                )
                await self.db.execute("DELETE FROM runs WHERE thread_id=?", (thread_id,))
                await self.db.execute("DELETE FROM threads WHERE id=?", (thread_id,))
                await self.db.execute("COMMIT")
            except BaseException:
                await self.db.execute("ROLLBACK")
                raise

    # runs
    async def create_run(self, thread_id: str, *, stale_after_s: float = 30) -> Run:
        now = _now()
        cutoff = _iso(now - timedelta(seconds=stale_after_s))
        async with self._lock:
            await self.db.execute("BEGIN IMMEDIATE")
            try:
                live = await self._one(
                    "SELECT 1 FROM runs WHERE thread_id=? AND status='running' "
                    "AND heartbeat_at >= ?",
                    (thread_id, cutoff),
                )
                if live:
                    await self.db.execute("ROLLBACK")
                    raise RunInProgress(thread_id)
                run = Run(
                    id=new_id(), thread_id=thread_id, status="running",
                    created_at=now, heartbeat_at=now,
                )  # fmt: skip
                await self.db.execute(
                    "INSERT INTO runs (id, thread_id, status, created_at, heartbeat_at) "
                    "VALUES (?,?,?,?,?)",
                    (run.id, thread_id, "running", _iso(now), _iso(now)),
                )
                await self.db.execute(
                    "UPDATE threads SET updated_at=? WHERE id=?", (_iso(now), thread_id)
                )
                await self.db.execute("COMMIT")
            except RunInProgress:
                raise
            except BaseException:
                await self.db.execute("ROLLBACK")
                raise
        return run

    async def get_run(self, run_id: str) -> Run | None:
        r = await self._one("SELECT * FROM runs WHERE id=?", (run_id,))
        return _run(r) if r else None

    async def list_runs(self, thread_id: str) -> list[Run]:
        rows = await self._all(
            "SELECT * FROM runs WHERE thread_id=? ORDER BY created_at, rowid", (thread_id,)
        )
        return [_run(r) for r in rows]

    async def heartbeat(self, run_id: str) -> None:
        await self._write("UPDATE runs SET heartbeat_at=? WHERE id=?", (_iso(_now()), run_id))

    async def finish_run(self, run_id: str, status: RunStatus, error: str | None = None) -> None:
        await self._write(
            "UPDATE runs SET status=?, error=?, finished_at=? WHERE id=? AND status='running'",
            (status, error, _iso(_now()), run_id),
        )

    async def request_cancel(self, run_id: str) -> None:
        await self._write("UPDATE runs SET cancel_requested=1 WHERE id=?", (run_id,))

    async def is_cancel_requested(self, run_id: str) -> bool:
        r = await self._one("SELECT cancel_requested FROM runs WHERE id=?", (run_id,))
        return r is None or bool(r["cancel_requested"])  # a deleted run must stop

    async def mark_superseded(self, run_id: str) -> None:
        await self._write("UPDATE runs SET superseded=1 WHERE id=?", (run_id,))

    # events
    async def append_events(self, run_id: str, events: list[StoredEvent]) -> None:
        if not events:
            return
        async with self._lock:
            await self.db.executemany(
                "INSERT OR REPLACE INTO events VALUES (?,?,?,?)",
                [(run_id, e.seq, int(e.is_input), json.dumps(e.event)) for e in events],
            )

    async def list_events(self, run_id: str, after_seq: int = 0) -> list[StoredEvent]:
        rows = await self._all(
            "SELECT seq, is_input, json FROM events WHERE run_id=? AND seq>? ORDER BY seq",
            (run_id, after_seq),
        )
        return [
            StoredEvent(seq=r["seq"], event=json.loads(r["json"]), is_input=bool(r["is_input"]))
            for r in rows
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
        await self._write(
            "INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?)",
            (meta.id, meta.owner_id, meta.name, meta.content_type, meta.size,
             _iso(meta.created_at)),
        )  # fmt: skip

    async def get_file_meta(self, file_id: str) -> FileMeta | None:
        r = await self._one("SELECT * FROM files WHERE id=?", (file_id,))
        if not r:
            return None
        return FileMeta(
            id=r["id"], owner_id=r["owner_id"], name=r["name"],
            content_type=r["content_type"], size=r["size"], created_at=_dt(r["created_at"]),
        )  # fmt: skip
