"""Start runs (streamed as SSE), replay their events, and cancel them."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from functools import partial
from typing import Annotated, Any, Literal

from ag_ui.core import (
    BaseEvent,
    RunAgentInput,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallResultEvent,
)
from pydantic import BaseModel, ConfigDict, Field
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from loquent.context import FileRef, RunContext
from loquent.protocol import encode_sse, event_to_dict, events_to_messages, new_id
from loquent.runner import GENERIC_ERROR, STALE_AFTER_S, effective_status, start_run
from loquent.store.models import Run, RunInProgress, Thread, User
from loquent.ui import WIDGET_TOOLS, InvalidAnswer, is_widget_tool, validate_answer

from .deps import ApiError, Deps, invalid_input, json_body, not_found, public_user

log = logging.getLogger("loquent.server")

TITLE_CHARS = 60
MAX_ATTACHMENTS = 10
MAX_QUERY_KEYS = 20
MAX_QUERY_BYTES = 1024
# Never forwarded to the agent, even if an operator lists them.
_NEVER_FORWARD = frozenset({"cookie", "authorization", "x-loquent-csrf"})


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MessageInput(_Strict):
    type: Literal["message"]
    content: str
    attachments: list[str] = []


class ToolResultInput(_Strict):
    type: Literal["tool_result"]
    tool_call_id: str
    answer: Any


class RegenerateInput(_Strict):
    type: Literal["regenerate"]


class RunRequest(_Strict):
    thread_id: str | None = None
    input: Annotated[MessageInput | ToolResultInput | RegenerateInput, Field(discriminator="type")]
    page_query: dict[str, str] = {}


def invalid_answer() -> ApiError:
    return ApiError(400, "invalid_answer")


def _check_page_query(q: dict[str, str]) -> None:
    if len(q) > MAX_QUERY_KEYS:
        raise invalid_input()
    for k, v in q.items():
        if len(k.encode()) > MAX_QUERY_BYTES or len(v.encode()) > MAX_QUERY_BYTES:
            raise invalid_input()


def message_events(content: str, attachments: list[dict] | None = None) -> list[BaseEvent]:
    mid = new_id()
    return [
        TextMessageStartEvent(
            message_id=mid, role="user", metadata={"attachments": attachments or []}
        ),
        TextMessageContentEvent(message_id=mid, delta=content),
        TextMessageEndEvent(message_id=mid),
    ]


async def pending_widget_call(
    deps: Deps, thread_id: str, tool_call_id: str, *, ignore_run: str | None = None
) -> tuple[str, dict]:
    """The widget name and args of a call the user may answer now, from stored events only.

    The call must be a ``loquent_*`` TOOL_CALL_START in the thread's last non-superseded run,
    that run must have ended with RUN_FINISHED listing it in ``pendingToolCallIds``, and no
    TOOL_CALL_RESULT for it may exist yet. Anything else is ``invalid_answer``.
    """
    store = deps.store
    runs = [r for r in await store.list_runs(thread_id) if not r.superseded and r.id != ignore_run]
    if not runs or not tool_call_id:
        raise invalid_answer()
    events = [e.event for e in await store.list_events(runs[-1].id)]
    if not events or events[-1].get("type") != "RUN_FINISHED":
        raise invalid_answer()
    outcome = events[-1].get("outcome")
    pending = outcome.get("pendingToolCallIds") if isinstance(outcome, dict) else None
    if not isinstance(pending, list) or tool_call_id not in pending:
        raise invalid_answer()
    name: str | None = None
    parts: list[str] = []
    for e in events:
        if e.get("toolCallId") != tool_call_id:
            continue
        if e.get("type") == "TOOL_CALL_START":
            if name is not None:
                raise invalid_answer()  # ambiguous: the same id started twice
            name = e.get("toolCallName")
        elif e.get("type") == "TOOL_CALL_ARGS" and name is not None:
            delta = e.get("delta")
            if not isinstance(delta, str):
                raise invalid_answer()
            parts.append(delta)
    if not isinstance(name, str) or not is_widget_tool(name):
        raise invalid_answer()
    try:
        args = json.loads("".join(parts))
    except ValueError:
        raise invalid_answer() from None
    if not isinstance(args, dict):
        raise invalid_answer()
    for e in await store.thread_events(thread_id):
        if e.get("type") == "TOOL_CALL_RESULT" and e.get("toolCallId") == tool_call_id:
            raise invalid_answer()
    return name, args


async def last_visible_run(
    deps: Deps, thread_id: str, *, ignore_run: str | None = None
) -> Run | None:
    """The thread's last run that is not superseded (optionally ignoring one run)."""
    runs = [
        r for r in await deps.store.list_runs(thread_id) if not r.superseded and r.id != ignore_run
    ]
    return runs[-1] if runs else None


async def discard_run(deps: Deps, run: Run) -> None:
    """Hide and close a run that was created but will never start."""
    try:
        await deps.store.mark_superseded(run.id)
        await deps.store.finish_run(run.id, "cancelled")
    except Exception:
        log.exception("could not discard run %s", run.id)


def routes(deps: Deps) -> list[Route]:
    store = deps.store
    adapter = deps.adapter
    settings = deps.settings
    allowed_headers = {h.lower() for h in settings.forward_headers} - _NEVER_FORWARD

    def forwarded_props(request: Request, user: User, page_query: dict[str, str]) -> dict:
        headers = {
            name: request.headers[name]
            for name in sorted(allowed_headers)
            if name in request.headers
        }
        return {"user": public_user(user), "headers": headers, "query": dict(page_query)}

    def track(handle) -> None:
        deps.live_runs[handle.run_id] = handle
        handle.task.add_done_callback(lambda _t, rid=handle.run_id: deps.live_runs.pop(rid, None))

    async def create_run(thread_id: str) -> Run:
        try:
            return await store.create_run(thread_id, stale_after_s=STALE_AFTER_S)
        except RunInProgress:
            raise ApiError(409, "run_in_progress") from None

    async def resolve_attachments(user: User, ids: list[str]) -> tuple[list[dict], list[FileRef]]:
        """Public metadata and FileRefs for the message's attachments; all must be the user's."""
        if not ids:
            return [], []
        file_store = deps.file_store
        if file_store is None or not adapter.supports_attachments or len(ids) > MAX_ATTACHMENTS:
            raise invalid_input()
        public: list[dict] = []
        refs: list[FileRef] = []
        for file_id in dict.fromkeys(ids):  # in order, without duplicates
            meta = await store.get_file_meta(file_id)
            if meta is None or meta.owner_id != user.id:
                raise not_found()
            public.append(
                {"id": meta.id, "name": meta.name, "content_type": meta.content_type,
                 "size": meta.size}
            )  # fmt: skip
            refs.append(
                FileRef(
                    id=meta.id, name=meta.name, content_type=meta.content_type, size=meta.size,
                    read=partial(file_store.read, meta.id),
                )
            )  # fmt: skip
        return public, refs

    async def start(request: Request) -> StreamingResponse:
        user = await deps.user(request)
        if deps.rate_limiter is not None and not await deps.rate_limiter(request, user):
            raise ApiError(429, "rate_limited")
        body = await json_body(request, RunRequest)
        _check_page_query(body.page_query)
        inp = body.input

        # The thread must exist and be ours before any run is created (404 otherwise).
        thread: Thread | None = None
        if body.thread_id is not None:
            thread = await deps.owned_thread(user, body.thread_id)

        input_events: list[BaseEvent] = []
        files: list[FileRef] = []
        supersede: Run | None = None
        if isinstance(inp, MessageInput):
            if not inp.content.strip():
                raise invalid_input()
            attachments, files = await resolve_attachments(user, inp.attachments)
            input_events = message_events(inp.content, attachments)
            if thread is None:
                title = inp.content.strip()[:TITLE_CHARS]
                thread = await store.create_thread(user.id, title)
        elif thread is None:
            raise invalid_input()  # tool results and regenerate need an existing thread
        elif isinstance(inp, ToolResultInput):
            name, args = await pending_widget_call(deps, thread.id, inp.tool_call_id)
            try:
                validate_answer(name, args, inp.answer)
            except InvalidAnswer:
                raise invalid_answer() from None
            input_events = [
                ToolCallResultEvent(
                    message_id=new_id(),
                    tool_call_id=inp.tool_call_id,
                    content=json.dumps(inp.answer, separators=(",", ":")),
                    role="tool",
                )
            ]
        else:  # regenerate
            last = await last_visible_run(deps, thread.id)
            if last is None:
                raise invalid_input()
            # A stale "running" run counts as terminal (interrupted), so Retry works.
            if await effective_status(store, last) == "running":
                raise ApiError(409, "run_in_progress")
            supersede = last

        run = await create_run(thread.id)
        # Check again now that our run holds the thread: another request (maybe on another
        # replica) may have answered the call, or run, between our first check and
        # create_run. On any failure here the new run is discarded, never left running.
        try:
            if isinstance(inp, ToolResultInput):
                await pending_widget_call(deps, thread.id, inp.tool_call_id, ignore_run=run.id)
            elif supersede is not None:
                latest = await last_visible_run(deps, thread.id, ignore_run=run.id)
                if latest is None or latest.id != supersede.id:
                    raise ApiError(409, "run_in_progress")
        except BaseException:
            await discard_run(deps, run)
            raise
        try:
            if supersede is not None:
                await store.mark_superseded(supersede.id)
            history = await store.thread_events(thread.id)
            messages = events_to_messages(history + [event_to_dict(e) for e in input_events])
            fp = forwarded_props(request, user, body.page_query)
            agent_input = RunAgentInput(
                thread_id=thread.id, run_id=run.id, state={}, messages=messages,
                tools=list(WIDGET_TOOLS) if adapter.supports_widgets else [], context=[],
                forwarded_props=fp,
            )  # fmt: skip
            ctx = RunContext(
                thread_id=thread.id, run_id=run.id, user=user, messages=messages,
                forwarded_props=fp, files=files,
            )  # fmt: skip
            handle = start_run(
                store=store, adapter=adapter, run=run, input=agent_input, ctx=ctx,
                input_events=input_events,
            )  # fmt: skip
        except BaseException:
            log.exception("could not start run %s", run.id)
            try:
                await store.finish_run(run.id, "failed", GENERIC_ERROR)
            except Exception:
                log.exception("could not mark run %s failed", run.id)
            raise
        track(handle)

        async def sse() -> AsyncIterator[str]:
            # A client disconnect only abandons this iterator; the run keeps going.
            async for seq, event in handle.stream():
                yield encode_sse(seq, event)

        return StreamingResponse(
            sse(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def events(request: Request) -> JSONResponse:
        user = await deps.user(request)
        run = await deps.owned_run(user, request.path_params["run_id"])
        raw = request.query_params.get("after", "0")
        if not (raw.isascii() and raw.isdigit()):
            raise invalid_input()
        # Status first, then events: once a terminal status is read the log is complete.
        # The status never comes from the presence of a terminal event.
        status = await effective_status(store, run)
        stored = await store.list_events(run.id, after_seq=int(raw))
        return JSONResponse(
            {"status": status, "events": [{"seq": e.seq, "event": e.event} for e in stored]}
        )

    async def cancel(request: Request) -> JSONResponse:
        user = await deps.user(request)
        run = await deps.owned_run(user, request.path_params["run_id"])
        # Through the store, so whichever replica runs it sees the flag.
        await store.request_cancel(run.id)
        return JSONResponse({"ok": True}, status_code=202)

    return [
        Route("/api/runs", start, methods=["POST"]),
        Route("/api/runs/{run_id}/events", events, methods=["GET"]),
        Route("/api/runs/{run_id}/cancel", cancel, methods=["POST"]),
    ]
