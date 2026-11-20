"""Thread list, thread view, rename and delete."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from loquent.runner import effective_status
from loquent.store.models import Thread

from .deps import ApiError, Deps, json_body
from .routes_runs import last_visible_run

MAX_TITLE = 200


class RenameBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TITLE)
    ]


def thread_json(t: Thread) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat(),
    }


def _last_index(events: list[dict], run_id: str) -> int | None:
    for i in range(len(events) - 1, -1, -1):
        e = events[i]
        if e.get("type") == "RUN_STARTED" and e.get("runId") == run_id:
            return i
    return None


def routes(deps: Deps) -> list[Route]:
    store = deps.store

    async def list_threads(request: Request) -> JSONResponse:
        user = await deps.user(request)
        threads = await store.list_threads(user.id)
        return JSONResponse(
            [
                {"id": t.id, "title": t.title, "updated_at": t.updated_at.isoformat()}
                for t in threads
            ]
        )

    async def get_thread(request: Request) -> JSONResponse:
        user = await deps.user(request)
        thread = await deps.owned_thread(user, request.path_params["thread_id"])
        last = await last_visible_run(deps, thread.id)
        last_run = None
        tail: list[dict] | None = None
        if last is not None:
            # Status first, then events: a terminal status read before the events guarantees
            # the events are complete (the runner flushes before it finishes the run). Never
            # infer the status from a terminal event; the log may not have one.
            status = await effective_status(store, last)
            stored = await store.list_events(last.id)
            last_run = {
                "id": last.id,
                "status": status,
                "last_seq": stored[-1].seq if stored else 0,
            }
            tail = [e.event for e in stored]
        events = await store.thread_events(thread.id)
        if tail is not None:
            # A live run may have persisted more events since `stored` was read. Replace its
            # part of the log with `stored`, so `events` matches `last_seq` exactly and a
            # client polling from `last_seq` neither misses nor repeats events.
            i = _last_index(events, last.id)
            events = (events if i is None else events[:i]) + tail
        return JSONResponse({"thread": thread_json(thread), "events": events, "last_run": last_run})

    async def rename_thread(request: Request) -> JSONResponse:
        user = await deps.user(request)
        thread = await deps.owned_thread(user, request.path_params["thread_id"])
        body = await json_body(request, RenameBody)
        await store.rename_thread(thread.id, body.title)
        fresh = await store.get_thread(thread.id)
        return JSONResponse(thread_json(fresh or thread))

    async def delete_thread(request: Request) -> Response:
        user = await deps.user(request)
        thread = await deps.owned_thread(user, request.path_params["thread_id"])
        # Refuse while a run is live; the client stops it first. (Deleting would erase the
        # cancel flag with the run row; stores treat a missing run as cancelled anyway.)
        last = await last_visible_run(deps, thread.id)
        if last is not None and await effective_status(store, last) == "running":
            raise ApiError(409, "run_in_progress")
        await store.delete_thread(thread.id)
        return Response(status_code=204)

    return [
        Route("/api/threads", list_threads, methods=["GET"]),
        Route("/api/threads/{thread_id}", get_thread, methods=["GET"]),
        Route("/api/threads/{thread_id}", rename_thread, methods=["PATCH"]),
        Route("/api/threads/{thread_id}", delete_thread, methods=["DELETE"]),
    ]
