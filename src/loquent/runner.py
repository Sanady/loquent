"""Background run executor.

Each chat reply runs as an ``asyncio.Task`` that is independent of any HTTP listener. It
persists every event to the store in batches, keeps a heartbeat, polls the store's cancel
flag, and always ends with a terminal status. Housekeeping (flush, heartbeat, cancel poll)
runs inside the main loop by timestamp, including while the adapter is slow to yield.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from ag_ui.core import (
    PROTOCOL_VERSION,
    BaseEvent,
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageEndEvent,
)

from loquent.adapters.base import Adapter, AgentError
from loquent.context import RunContext
from loquent.protocol import event_to_dict
from loquent.store.base import Store
from loquent.store.models import Run, RunStatus, StoredEvent
from loquent.ui import is_widget_tool

HEARTBEAT_INTERVAL_S = 5
STALE_AFTER_S = 30
CANCEL_POLL_S = 0.5
FLUSH_INTERVAL_S = 0.25
FLUSH_MAX_EVENTS = 50
ADAPTER_CLOSE_TIMEOUT_S = 5
FINAL_FLUSH_ATTEMPTS = 3

GENERIC_ERROR = "The agent ran into an error."

log = logging.getLogger("loquent.runner")

_LIFECYCLE = {EventType.RUN_STARTED, EventType.RUN_FINISHED, EventType.RUN_ERROR}
_END = object()  # stream sentinel
_DONE = object()  # adapter exhausted

# Strong references so a run survives even if every handle to it is dropped.
_LIVE_TASKS: set[asyncio.Task] = set()


class RunHandle:
    """A live view of one run: a replay buffer plus one queue per listener."""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.task: asyncio.Task[None]
        self._buffer: list[tuple[int, dict]] = []
        self._listeners: set[asyncio.Queue] = set()
        self._closed = False

    def _publish(self, seq: int, event: dict) -> None:
        item = (seq, event)
        self._buffer.append(item)
        for q in self._listeners:
            q.put_nowait(item)

    def _close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for q in self._listeners:
            q.put_nowait(_END)

    async def stream(self) -> AsyncIterator[tuple[int, dict]]:
        """Yield ``(seq, event)`` from seq 1; ends after the run's last event."""
        q: asyncio.Queue = asyncio.Queue()
        # Snapshot and subscribe with no await in between, so nothing is missed or doubled.
        for item in self._buffer:
            q.put_nowait(item)
        if self._closed:
            q.put_nowait(_END)
        else:
            self._listeners.add(q)
        try:
            while True:
                item = await q.get()
                if item is _END:
                    return
                yield item
        finally:
            self._listeners.discard(q)


class _CancelRequested(Exception):
    pass


class _AdapterPump:
    """Drives the adapter's generator in one dedicated task, one event per request.

    Pulling happens only on request, so nothing is read past the point where the runner
    stops. Keeping the generator in a single task preserves its context and cancel scopes.
    """

    def __init__(self, gen: AsyncIterator[BaseEvent]) -> None:
        self._gen = gen
        self._requests: asyncio.Queue[asyncio.Future | None] = asyncio.Queue()
        self.task = asyncio.create_task(self._produce())
        self.task.add_done_callback(_consume_result)
        self._closed = False

    async def _produce(self) -> None:
        try:
            while True:
                fut = await self._requests.get()
                if fut is None:
                    return
                try:
                    event = await anext(self._gen)
                except StopAsyncIteration:
                    fut.set_result(_DONE)
                    return
                except Exception as e:  # noqa: BLE001 - handed to the runner via the future
                    fut.set_exception(e)
                    return
                fut.set_result(event)
        finally:
            aclose = getattr(self._gen, "aclose", None)
            if aclose is not None:
                await aclose()

    def request(self) -> asyncio.Future:
        fut = asyncio.get_running_loop().create_future()
        self._requests.put_nowait(fut)
        return fut

    async def close(self, *, cancel: bool) -> None:
        if self._closed:
            return
        self._closed = True
        self._requests.put_nowait(None)
        if cancel:
            self.task.cancel()
        await asyncio.wait({self.task}, timeout=ADAPTER_CLOSE_TIMEOUT_S)
        if not self.task.done():
            log.warning("adapter did not stop within %ss; abandoning it", ADAPTER_CLOSE_TIMEOUT_S)
        elif not self.task.cancelled() and self.task.exception() is not None:
            log.error("adapter raised while closing", exc_info=self.task.exception())


def _consume_result(task: asyncio.Task) -> None:
    if not task.cancelled():
        task.exception()  # mark retrieved; reported by whoever awaits/inspects the task


class _Runner:
    def __init__(
        self,
        *,
        store: Store,
        adapter: Adapter,
        run: Run,
        input: RunAgentInput,
        ctx: RunContext,
        input_events: list[BaseEvent],
        handle: RunHandle,
        clock: Callable[[], float],
    ) -> None:
        self.store = store
        self.adapter = adapter
        self.run = run
        self.input = input
        self.ctx = ctx
        self.input_events = input_events
        self.handle = handle
        self.clock = clock
        self.seq = 0
        self.pending: list[StoredEvent] = []
        self.flush_failing = False
        self.open_texts: dict[str, None] = {}  # ordered set of unclosed text message ids
        self.tool_names: dict[str, str] = {}
        self.terminated = False
        now = clock()
        self.last_flush = now
        self.last_heartbeat = now
        self.last_cancel_check = -math.inf

    # persistence

    async def emit(self, event: BaseEvent, *, is_input: bool = False) -> None:
        data = event_to_dict(event)  # may raise for a malformed event; no seq consumed then
        self.seq += 1
        self.pending.append(StoredEvent(seq=self.seq, event=data, is_input=is_input))
        self.handle._publish(self.seq, data)
        if event.type == EventType.TEXT_MESSAGE_START and not is_input:
            self.open_texts[event.message_id] = None
        elif event.type == EventType.TEXT_MESSAGE_END:
            self.open_texts.pop(event.message_id, None)
        due = self.clock() - self.last_flush >= FLUSH_INTERVAL_S
        if due or (len(self.pending) >= FLUSH_MAX_EVENTS and not self.flush_failing):
            await self.flush()

    async def flush(self) -> bool:
        self.last_flush = self.clock()
        if not self.pending:
            return True
        batch, self.pending = self.pending, []
        try:
            await self.store.append_events(self.run.id, batch)
        except Exception:
            log.exception("could not persist events for run %s; will retry", self.run.id)
            self.pending = batch + self.pending
            self.flush_failing = True
            return False
        self.flush_failing = False
        return True

    async def final_flush(self) -> bool:
        for attempt in range(FINAL_FLUSH_ATTEMPTS):
            if attempt:
                await asyncio.sleep(FLUSH_INTERVAL_S)
            if await self.flush():
                return True
        return False

    # housekeeping

    def _next_deadline(self) -> float:
        deadlines = [
            self.last_heartbeat + HEARTBEAT_INTERVAL_S,
            self.last_cancel_check + CANCEL_POLL_S,
        ]
        if self.pending:
            deadlines.append(self.last_flush + FLUSH_INTERVAL_S)
        return min(deadlines)

    async def tick(self) -> bool:
        """Do whatever housekeeping is due. Returns True when cancellation was requested."""
        now = self.clock()
        if self.pending and now - self.last_flush >= FLUSH_INTERVAL_S:
            await self.flush()
        if now - self.last_heartbeat >= HEARTBEAT_INTERVAL_S:
            self.last_heartbeat = now
            try:
                await self.store.heartbeat(self.run.id)
            except Exception:
                log.exception("heartbeat failed for run %s", self.run.id)
        if now - self.last_cancel_check >= CANCEL_POLL_S:
            self.last_cancel_check = now
            try:
                return await self.store.is_cancel_requested(self.run.id)
            except Exception:
                log.exception("cancel check failed for run %s", self.run.id)
        return False

    async def next_event(self, pump: _AdapterPump) -> Any:
        """Wait for the adapter's next event, doing housekeeping while it is slow."""
        fut = pump.request()
        while True:
            timeout = max(0.0, self._next_deadline() - self.clock())
            await asyncio.wait({fut, pump.task}, timeout=timeout,
                               return_when=asyncio.FIRST_COMPLETED)  # fmt: skip
            if fut.done():
                return fut.result()
            if pump.task.done():
                raise RuntimeError("adapter stopped without producing a result")
            if await self.tick():
                raise _CancelRequested

    # terminal events

    async def close_open_texts(self) -> None:
        for message_id in list(self.open_texts):
            await self.emit(TextMessageEndEvent(message_id=message_id))

    async def finished(self, outcome: dict) -> None:
        await self.close_open_texts()
        await self.emit(
            RunFinishedEvent(thread_id=self.run.thread_id, run_id=self.run.id, outcome=outcome)
        )
        self.terminated = True

    async def errored(self, message: str) -> None:
        await self.close_open_texts()
        await self.emit(RunErrorEvent(message=message, code="agent_error"))
        self.terminated = True

    # main

    async def drive(self) -> tuple[RunStatus, str | None]:
        started = RunStartedEvent(
            thread_id=self.run.thread_id, run_id=self.run.id, protocol_version=PROTOCOL_VERSION
        )
        await self.emit(started)
        for event in self.input_events:
            await self.emit(event, is_input=True)

        pump: _AdapterPump | None = None
        try:
            if await self.tick():
                raise _CancelRequested
            pump = _AdapterPump(self.adapter.run(self.input, self.ctx))
            pending_call = await self.consume(pump)
            await pump.close(cancel=False)
            outcome: dict = {"type": "success"}
            if pending_call is not None:
                outcome["pendingToolCallIds"] = [pending_call]
            await self.finished(outcome)
            return "succeeded", None
        except _CancelRequested:
            if pump is not None:
                await pump.close(cancel=True)
            await self.finished({"type": "cancelled"})
            return "cancelled", None
        except Exception as e:
            log.exception("agent error in run %s", self.run.id)
            message = str(e) if isinstance(e, AgentError) and str(e) else GENERIC_ERROR
            if pump is not None:
                await pump.close(cancel=True)
            await self.errored(message)
            return "failed", message
        finally:
            if pump is not None:
                await pump.close(cancel=True)  # no-op unless leaving abnormally

    async def consume(self, pump: _AdapterPump) -> str | None:
        """Forward adapter events until it ends (None) or stops on a widget call (its id)."""
        while True:
            event = await self.next_event(pump)
            if event is _DONE:
                return None
            if not isinstance(event, BaseEvent):
                raise TypeError(f"adapter yielded a non-event: {type(event).__name__}")
            if event.type in _LIFECYCLE:
                log.warning("dropping %s yielded by adapter in run %s", event.type, self.run.id)
                continue
            await self.emit(event)
            if event.type == EventType.TOOL_CALL_START:
                self.tool_names[event.tool_call_id] = event.tool_call_name
            elif event.type == EventType.TOOL_CALL_END and is_widget_tool(
                self.tool_names.get(event.tool_call_id, "")
            ):
                return event.tool_call_id
            if await self.tick():
                raise _CancelRequested

    async def execute(self) -> None:
        status: RunStatus = "failed"
        error: str | None = GENERIC_ERROR
        try:
            try:
                status, error = await self.drive()
            except asyncio.CancelledError:
                status, error = "interrupted", None
                raise
            except Exception:
                log.exception("runner failed for run %s", self.run.id)
                if not self.terminated:
                    try:
                        await self.errored(GENERIC_ERROR)
                    except Exception:
                        log.exception("could not emit RUN_ERROR for run %s", self.run.id)
            finally:
                if not await self.final_flush() and status != "interrupted":
                    status, error = "failed", "Could not save the run's events."
                try:
                    await self.store.finish_run(self.run.id, status, error)
                except Exception:
                    log.exception("could not finish run %s as %s", self.run.id, status)
        finally:
            self.handle._close()


def start_run(
    *,
    store: Store,
    adapter: Adapter,
    run: Run,
    input: RunAgentInput,
    ctx: RunContext,
    input_events: list[BaseEvent],
    clock: Callable[[], float] = time.monotonic,
) -> RunHandle:
    """Start a run in the background. It runs to completion whether or not anyone listens."""
    handle = RunHandle(run.id)
    runner = _Runner(
        store=store, adapter=adapter, run=run, input=input, ctx=ctx,
        input_events=list(input_events), handle=handle, clock=clock,
    )  # fmt: skip
    task = asyncio.create_task(runner.execute(), name=f"loquent-run-{run.id}")
    _LIVE_TASKS.add(task)
    task.add_done_callback(_LIVE_TASKS.discard)
    handle.task = task
    return handle


async def effective_status(
    store: Store,
    run: Run,
    now: datetime | None = None,
    stale_after_s: float = STALE_AFTER_S,
) -> RunStatus:
    """The run's status, flipping a running run with a stale heartbeat to ``interrupted``."""
    if run.status != "running":
        return run.status
    now = now or datetime.now(UTC)
    heartbeat = run.heartbeat_at
    if heartbeat.tzinfo is None:
        heartbeat = heartbeat.replace(tzinfo=UTC)
    if now - heartbeat <= timedelta(seconds=stale_after_s):
        return "running"
    await store.finish_run(run.id, "interrupted")
    fresh = await store.get_run(run.id)
    return fresh.status if fresh is not None else "interrupted"
