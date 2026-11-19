import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest
from ag_ui.core import ToolCallArgsEvent, ToolCallEndEvent, ToolCallStartEvent
from srv import make_client, parse_sse, run_message, sse_events, started

from loquent import ui
from loquent.settings import Settings
from loquent.store.models import StoredEvent


def texts(events, role=None):
    """Concatenated text per message id, in order."""
    out, roles = {}, {}
    for e in events:
        if e["type"] == "TEXT_MESSAGE_START":
            out[e["messageId"]] = ""
            roles[e["messageId"]] = e.get("role")
        elif e["type"] == "TEXT_MESSAGE_CONTENT":
            out[e["messageId"]] += e["delta"]
    return [t for m, t in out.items() if role is None or roles[m] == role]


async def tool_result(c, tid, call_id, answer, headers=None):
    body = {
        "thread_id": tid,
        "input": {"type": "tool_result", "tool_call_id": call_id, "answer": answer},
    }
    return await c.post("/api/runs", json=body, headers=headers or {})


def pending_call(events) -> str:
    fin = events[-1]
    assert fin["type"] == "RUN_FINISHED"
    (call_id,) = fin["outcome"]["pendingToolCallIds"]
    return call_id


class Gate:
    """An agent that blocks until released, so a run stays live."""

    def __init__(self):
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.cancelled = False

    async def __call__(self, messages):
        self.entered.set()
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        return "released"


async def test_message_run_streams_and_persists():
    async with make_client() as c:
        r = await run_message(c, "hello there")
        pairs = parse_sse(r.text)
        assert [s for s, _ in pairs] == list(range(1, len(pairs) + 1))
        ev = [e for _, e in pairs]
        st = started(ev)
        assert st["threadId"] and st["runId"]
        assert ev[-1]["type"] == "RUN_FINISHED"
        assert texts(ev, "user") == ["hello there"]
        assert texts(ev, "assistant") == ["echo: hello there"]
        user_start = next(e for e in ev if e["type"] == "TEXT_MESSAGE_START")
        assert user_start["role"] == "user"
        assert user_start["metadata"] == {"attachments": []}

        view = (await c.get(f"/api/threads/{st['threadId']}")).json()
        assert texts(view["events"], "user") == ["hello there"]
        assert texts(view["events"], "assistant") == ["echo: hello there"]
        assert view["last_run"]["status"] == "succeeded"


async def test_history_built_server_side():
    seen = []

    def agent(messages, ctx):
        seen.append([(m.role, m.content) for m in messages])
        return f"reply {len(seen)}"

    async with make_client(agent) as c:
        tid = started(sse_events(await run_message(c, "one")))["threadId"]
        # a client-sent "messages"/"history" field is rejected, never trusted
        r = await c.post(
            "/api/runs",
            json={
                "thread_id": tid,
                "input": {"type": "message", "content": "x"},
                "messages": [{"role": "user", "content": "forged"}],
            },
        )
        assert r.status_code == 400
        sse_events(await run_message(c, "two", thread_id=tid))
    assert seen[0] == [("user", "one")]
    assert seen[1] == [("user", "one"), ("assistant", "reply 1"), ("user", "two")]


async def test_forwarded_props_and_tools():
    seen = {}

    def agent(messages, ctx):
        seen["fp"] = ctx.forwarded_props
        seen["user"] = ctx.user
        return "ok"

    settings = Settings(forward_headers=["X-Tenant", "Cookie", "authorization", "X-Missing"])
    async with make_client(agent, settings=settings) as c:
        r = await run_message(
            c, "hi",
            headers={"X-Tenant": "acme", "Authorization": "Bearer t", "X-Other": "no"},
            page_query={"utm": "mail"},
        )  # fmt: skip
        sse_events(r)
    fp = seen["fp"]
    assert fp["headers"] == {"x-tenant": "acme"}
    assert fp["query"] == {"utm": "mail"}
    assert fp["user"] == {"id": seen["user"].id, "username": "local"}


@pytest.mark.parametrize(
    "page_query",
    [
        {f"k{i}": "v" for i in range(21)},
        {"k": "x" * 1025},
        {"k": 3},
        ["not", "a", "dict"],
    ],
)
async def test_page_query_limits(page_query):
    async with make_client() as c:
        r = await run_message(c, "hi", page_query=page_query)
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_input"}
        assert (await c.get("/api/threads")).json() == []


async def test_page_query_at_limits_ok():
    async with make_client() as c:
        q = {f"k{i}": "é" * 512 for i in range(20)}  # 1024 bytes each
        assert sse_events(await run_message(c, "hi", page_query=q))[-1]["type"] == "RUN_FINISHED"


@pytest.mark.parametrize(
    "body",
    [
        b"{not json",
        b"[]",
        b'{"thread_id": null}',
        b'{"thread_id": null, "input": {"type": "nope"}}',
        b'{"thread_id": null, "input": {"type": "message"}}',
        b'{"thread_id": null, "input": {"type": "message", "content": ""}}',
        b'{"thread_id": null, "input": {"type": "message", "content": "x", "attachments": ["f1"]}}',
        b'{"thread_id": null, "input": {"type": "regenerate"}}',
        b'{"thread_id": null, "input": {"type": "tool_result", "tool_call_id": "c", "answer": {}}}',
        b'{"thread_id": 5, "input": {"type": "message", "content": "x"}}',
        b'{"thread_id": null, "input": {"type": "message", "content": "x"}, "page_query": {"a": NaN}}',
    ],
)
async def test_invalid_run_bodies_are_400(body):
    async with make_client() as c:
        r = await c.post("/api/runs", content=body, headers={"content-type": "application/json"})
        assert r.status_code == 400, body
        assert r.json() == {"error": "invalid_input"}
        assert (await c.get("/api/threads")).json() == []


def confirm_agent(messages, ctx):
    if ctx.answer is None:
        return _yield(ui.ask(ui.Confirm("Proceed?", key="go")))
    return f"got {json.dumps(ctx.answer.value)} for {ctx.answer.key}"


async def _yield(*items):
    for i in items:
        yield i


async def test_widget_round_trip():
    answers = []

    def agent(messages, ctx):
        if ctx.answer is not None:
            answers.append(ctx.answer)
        return confirm_agent(messages, ctx)

    async with make_client(agent) as c:
        ev1 = sse_events(await run_message(c, "do it"))
        tid = started(ev1)["threadId"]
        call_id = pending_call(ev1)
        start = next(e for e in ev1 if e["type"] == "TOOL_CALL_START")
        assert start["toolCallName"] == "loquent_confirm"

        r = await tool_result(c, tid, call_id, {"confirmed": True})
        ev2 = sse_events(r)
        assert started(ev2)["threadId"] == tid
        result = next(e for e in ev2 if e["type"] == "TOOL_CALL_RESULT")
        assert result["toolCallId"] == call_id
        assert json.loads(result["content"]) == {"confirmed": True}
        assert ev2[-1]["type"] == "RUN_FINISHED"
        assert "pendingToolCallIds" not in ev2[-1]["outcome"]
        assert texts(ev2, "assistant") == ['got {"confirmed": true} for go']
    assert len(answers) == 1
    assert answers[0].value == {"confirmed": True}
    assert answers[0].tool == "loquent_confirm"


async def _assert_rejected(c, tid, call_id, answer):
    before = len(await c.store.list_runs(tid))
    r = await tool_result(c, tid, call_id, answer)
    assert r.status_code == 400, (call_id, answer, r.text)
    assert r.json() == {"error": "invalid_answer"}
    assert len(await c.store.list_runs(tid)) == before  # no run started


async def test_tool_result_for_unknown_or_answered_call_is_400():
    """Review Focus 2: only a pending loquent_* call of the last run can be answered."""

    def agent(messages, ctx):
        last = messages[-1]
        if last.role == "user" and last.content == "plain":
            return "just text"
        if last.role == "user" and last.content == "unfinished":
            # a widget call that never ends: the run finishes without it pending
            return _yield(
                ToolCallStartEvent(tool_call_id="half", tool_call_name="loquent_confirm"),
                ToolCallArgsEvent(tool_call_id="half", delta='{"message": "ok?"}'),
                "moving on",
            )
        if last.role == "user" and last.content == "nonwidget":
            return _yield(
                ToolCallStartEvent(tool_call_id="srv-tool", tool_call_name="search"),
                ToolCallArgsEvent(tool_call_id="srv-tool", delta="{}"),
                ToolCallEndEvent(tool_call_id="srv-tool"),
                "done",
            )
        return confirm_agent(messages, ctx)

    async with make_client(agent) as c:
        ev1 = sse_events(await run_message(c, "ask me"))
        tid = started(ev1)["threadId"]
        call_id = pending_call(ev1)

        await _assert_rejected(c, tid, "made-up-id", {"confirmed": True})
        await _assert_rejected(c, tid, "", {"confirmed": True})

        # answer it once: fine
        sse_events(await tool_result(c, tid, call_id, {"confirmed": False}))
        # answering again: already answered, and no longer in the last run
        await _assert_rejected(c, tid, call_id, {"confirmed": True})

        # a newer run without a pending call: the old call is not answerable
        ev3 = sse_events(await run_message(c, "ask me", thread_id=tid))
        call3 = pending_call(ev3)
        sse_events(await run_message(c, "plain", thread_id=tid))  # user moved on
        await _assert_rejected(c, tid, call3, {"confirmed": True})

        # regenerate after answering: the answer run is superseded but its TOOL_CALL_RESULT
        # input is kept, so the call stays answered
        ev5 = sse_events(await run_message(c, "ask me", thread_id=tid))
        call5 = pending_call(ev5)
        sse_events(await tool_result(c, tid, call5, {"confirmed": True}))
        r = await c.post("/api/runs", json={"thread_id": tid, "input": {"type": "regenerate"}})
        rid7 = started(sse_events(r))["runId"]
        await _assert_rejected(c, tid, call5, {"confirmed": True})
        # even if the pending run becomes the last non-superseded one again, the stored
        # answer still blocks a second answer
        await c.store.mark_superseded(rid7)
        await _assert_rejected(c, tid, call5, {"confirmed": True})
        await c.store.db.execute("UPDATE runs SET superseded=0 WHERE id=?", (rid7,))

        # a non-widget tool call can never be answered by the client
        ev6 = sse_events(await run_message(c, "nonwidget", thread_id=tid))
        assert any(e.get("toolCallId") == "srv-tool" for e in ev6)
        await _assert_rejected(c, tid, "srv-tool", {"confirmed": True})

        # a widget call in the last run that is not listed as pending
        ev7 = sse_events(await run_message(c, "unfinished", thread_id=tid))
        assert "pendingToolCallIds" not in ev7[-1]["outcome"]
        await _assert_rejected(c, tid, "half", {"confirmed": True})

        # a call from another thread of the same user is unknown here
        other = sse_events(await run_message(c, "ask me"))
        other_call = pending_call(other)
        await _assert_rejected(c, tid, other_call, {"confirmed": True})


async def test_tool_result_for_forged_non_widget_pending_call_is_400():
    """Defense in depth: even a log listing a non-widget call as pending can't be answered."""
    async with make_client() as c:
        tid = started(sse_events(await run_message(c, "hi")))["threadId"]
        run = await c.store.create_run(tid)
        log = [
            {"type": "RUN_STARTED", "threadId": tid, "runId": run.id},
            {"type": "TOOL_CALL_START", "toolCallId": "srv", "toolCallName": "search"},
            {"type": "TOOL_CALL_ARGS", "toolCallId": "srv", "delta": "{}"},
            {"type": "TOOL_CALL_END", "toolCallId": "srv"},
            {"type": "RUN_FINISHED", "threadId": tid, "runId": run.id,
             "outcome": {"type": "success", "pendingToolCallIds": ["srv"]}},
        ]  # fmt: skip
        await c.store.append_events(
            run.id, [StoredEvent(seq=i + 1, event=e) for i, e in enumerate(log)]
        )
        await c.store.finish_run(run.id, "succeeded")
        await _assert_rejected(c, tid, "srv", {"confirmed": True})


async def test_tool_result_invalid_shape_is_400():
    def agent(messages, ctx):
        last = messages[-1]
        if last.role == "user" and last.content == "select":
            return _yield(ui.ask(ui.Select("Pick", ["red", "blue"])))
        if last.role == "user" and last.content == "badargs":
            return _yield(
                ToolCallStartEvent(tool_call_id="bad", tool_call_name="loquent_confirm"),
                ToolCallArgsEvent(tool_call_id="bad", delta="{not json"),
                ToolCallEndEvent(tool_call_id="bad"),
            )
        if last.role == "user" and last.content == "listargs":
            return _yield(
                ToolCallStartEvent(tool_call_id="lst", tool_call_name="loquent_confirm"),
                ToolCallArgsEvent(tool_call_id="lst", delta="[1, 2]"),
                ToolCallEndEvent(tool_call_id="lst"),
            )
        return confirm_agent(messages, ctx)

    async with make_client(agent) as c:
        ev = sse_events(await run_message(c, "confirm"))
        tid = started(ev)["threadId"]
        call_id = pending_call(ev)
        for bad in ({"confirmed": "yes"}, {}, "true", None, [True], {"value": "x"}):
            await _assert_rejected(c, tid, call_id, bad)
        # still answerable with a valid answer afterwards
        sse_events(await tool_result(c, tid, call_id, {"confirmed": True}))

        ev = sse_events(await run_message(c, "select", thread_id=tid))
        call_id = pending_call(ev)
        for bad in ({"value": "green"}, {"value": 1}, {"values": ["red"]}):
            await _assert_rejected(c, tid, call_id, bad)
        sse_events(await tool_result(c, tid, call_id, {"value": "blue"}))

        for content, cid in (("badargs", "bad"), ("listargs", "lst")):
            ev = sse_events(await run_message(c, content, thread_id=tid))
            assert pending_call(ev) == cid
            await _assert_rejected(c, tid, cid, {"confirmed": True})


async def test_second_concurrent_run_on_thread_is_409():
    """Review Focus 4: two runs on one thread at once → exactly one run, the other 409."""
    gate = Gate()
    async with make_client(gate) as c:
        # ASGITransport buffers the whole response, so the first POST runs as a task
        first = asyncio.create_task(run_message(c, "slow"))
        await asyncio.wait_for(gate.entered.wait(), 5)
        (thread,) = (await c.get("/api/threads")).json()
        tid = thread["id"]

        r = await run_message(c, "again", thread_id=tid)
        assert r.status_code == 409
        assert r.json() == {"error": "run_in_progress"}
        r = await c.post("/api/runs", json={"thread_id": tid, "input": {"type": "regenerate"}})
        assert r.status_code == 409
        assert r.json() == {"error": "run_in_progress"}
        # a burst of simultaneous POSTs also all lose
        rs = await asyncio.gather(*(run_message(c, f"m{i}", thread_id=tid) for i in range(5)))
        assert [x.status_code for x in rs] == [409] * 5
        assert len(await c.store.list_runs(tid)) == 1

        view = (await c.get(f"/api/threads/{tid}")).json()
        assert view["last_run"]["status"] == "running"

        gate.release.set()
        ev = sse_events(await asyncio.wait_for(first, 5))
        assert ev[-1]["type"] == "RUN_FINISHED"
        assert texts(ev, "assistant") == ["released"]
        assert len(await c.store.list_runs(tid)) == 1


async def test_simultaneous_first_runs_on_existing_thread_yield_one_run():
    gate = Gate()
    async with make_client(gate) as c:
        gate.release.set()
        tid = started(sse_events(await run_message(c, "seed")))["threadId"]
        gate.release.clear()
        gate.entered.clear()
        rs = await asyncio.gather(
            *(asyncio.create_task(run_message(c, f"m{i}", thread_id=tid)) for i in range(2)),
            _release_after(gate),
        )
        codes = sorted(r.status_code for r in rs[:2])
        assert codes == [200, 409]
        assert len(await c.store.list_runs(tid)) == 2


async def _release_after(gate):
    await asyncio.wait_for(gate.entered.wait(), 5)
    await asyncio.sleep(0.05)
    gate.release.set()


async def test_regenerate_supersedes_last_output_keeps_user_message():
    n = 0

    def agent(messages):
        nonlocal n
        n += 1
        return f"reply {n} to {[m.content for m in messages if m.role == 'user']}"

    async with make_client(agent) as c:
        ev1 = sse_events(await run_message(c, "question"))
        tid, rid1 = started(ev1)["threadId"], started(ev1)["runId"]
        r = await c.post("/api/runs", json={"thread_id": tid, "input": {"type": "regenerate"}})
        ev2 = sse_events(r)
        rid2 = started(ev2)["runId"]
        assert rid2 != rid1
        assert texts(ev2, "user") == []  # regenerate adds no input
        assert texts(ev2, "assistant") == ["reply 2 to ['question']"]

        view = (await c.get(f"/api/threads/{tid}")).json()
        assert texts(view["events"], "user") == ["question"]
        assert texts(view["events"], "assistant") == ["reply 2 to ['question']"]
        assert view["last_run"]["id"] == rid2
        assert (await c.store.get_run(rid1)).superseded


async def test_regenerate_after_interrupted_run():
    """R6: a stale 'running' run counts as terminal (interrupted), so Retry works."""

    def agent(messages):
        return "fresh"

    async with make_client(agent) as c:
        tid = started(sse_events(await run_message(c, "q")))["threadId"]
        # simulate a crashed replica: a running run whose heartbeat went stale
        stale = await c.store.create_run(tid)
        old = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
        await c.store.db.execute("UPDATE runs SET heartbeat_at=? WHERE id=?", (old, stale.id))

        # no read flips it first: the regenerate route itself must see it as interrupted
        r = await c.post("/api/runs", json={"thread_id": tid, "input": {"type": "regenerate"}})
        ev = sse_events(r)
        assert texts(ev, "assistant") == ["fresh"]
        assert (await c.store.get_run(stale.id)).superseded


async def test_regenerate_on_empty_thread_is_400():
    async with make_client() as c:
        await c.get("/api/auth/me")  # creates the local user
        local = await c.store.get_user_by_username("local")
        thread = await c.store.create_thread(local.id, "t")
        r = await c.post(
            "/api/runs", json={"thread_id": thread.id, "input": {"type": "regenerate"}}
        )
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_input"}


async def test_replay_events_after_seq():
    async with make_client() as c:
        pairs = parse_sse((await run_message(c, "replay me")).text)
        rid = pairs[0][1]["runId"]
        r = await c.get(f"/api/runs/{rid}/events", params={"after": 2})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "succeeded"
        assert body["events"] == [{"seq": s, "event": e} for s, e in pairs if s > 2]
        full = (await c.get(f"/api/runs/{rid}/events")).json()
        assert [x["seq"] for x in full["events"]] == [s for s, _ in pairs]
        for bad in ("-1", "abc", "1.5"):
            r = await c.get(f"/api/runs/{rid}/events", params={"after": bad})
            assert r.status_code == 400
            assert r.json() == {"error": "invalid_input"}


async def test_replay_without_terminal_event_uses_run_status():
    """A persisted log may lack a terminal event (interrupted); status comes from the run."""
    async with make_client() as c:
        tid = started(sse_events(await run_message(c, "q")))["threadId"]
        stale = await c.store.create_run(tid)
        old = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
        await c.store.db.execute("UPDATE runs SET heartbeat_at=? WHERE id=?", (old, stale.id))
        view = (await c.get(f"/api/threads/{tid}")).json()
        assert view["last_run"] == {"id": stale.id, "status": "interrupted", "last_seq": 0}
        r = await c.get(f"/api/runs/{stale.id}/events")
        assert r.json() == {"status": "interrupted", "events": []}


async def test_cancel_endpoint_stops_run():
    gate = Gate()
    async with make_client(gate) as c:
        first = asyncio.create_task(run_message(c, "slow"))
        await asyncio.wait_for(gate.entered.wait(), 5)
        (thread,) = (await c.get("/api/threads")).json()
        rid = (await c.store.list_runs(thread["id"]))[0].id

        live = (await c.get(f"/api/runs/{rid}/events")).json()
        assert live["status"] == "running"

        r = await c.post(f"/api/runs/{rid}/cancel")
        assert r.status_code == 202
        ev = sse_events(await asyncio.wait_for(first, 5))
        assert ev[-1]["type"] == "RUN_FINISHED"
        assert ev[-1]["outcome"] == {"type": "cancelled"}
        assert gate.cancelled
        final = (await c.get(f"/api/runs/{rid}/events")).json()
        assert final["status"] == "cancelled"
        assert final["events"][-1]["event"]["outcome"] == {"type": "cancelled"}
        assert c.app.state.live_runs == {}


async def test_client_disconnect_does_not_stop_run():
    gate = Gate()
    async with make_client(gate) as c:
        first = asyncio.create_task(run_message(c, "slow"))
        await asyncio.wait_for(gate.entered.wait(), 5)
        (thread,) = (await c.get("/api/threads")).json()
        rid = (await c.store.list_runs(thread["id"]))[0].id
        first.cancel()  # the listener goes away
        with pytest.raises(asyncio.CancelledError):
            await first
        gate.release.set()
        for _ in range(500):
            status = (await c.get(f"/api/runs/{rid}/events")).json()["status"]
            if status != "running":
                break
            await asyncio.sleep(0.01)
        assert status == "succeeded"
        view = (await c.get(f"/api/threads/{thread['id']}")).json()
        assert texts(view["events"], "assistant") == ["released"]


async def test_agent_exception_is_generic_run_error():
    def agent(messages):
        raise RuntimeError("internal db password is hunter2")

    async with make_client(agent) as c:
        r = await run_message(c, "hi")
        ev = sse_events(r)
        assert ev[-1]["type"] == "RUN_ERROR"
        assert ev[-1]["code"] == "agent_error"
        assert "hunter2" not in r.text


async def test_tool_result_answered_concurrently_elsewhere_is_400():
    """Check-then-act: another replica answers between our check and create_run."""
    async with make_client(confirm_agent) as c:
        ev = sse_events(await run_message(c, "ask"))
        tid = started(ev)["threadId"]
        call_id = pending_call(ev)
        real_create = c.store.create_run
        ours = []

        async def racing_create_run(thread_id, **kw):
            # the "other replica" wins: its run carries the answer as input
            other = await real_create(thread_id, **kw)
            result = {
                "type": "TOOL_CALL_RESULT", "messageId": "m", "toolCallId": call_id,
                "content": '{"confirmed":true}', "role": "tool",
            }  # fmt: skip
            await c.store.append_events(other.id, [StoredEvent(seq=1, event=result, is_input=True)])
            await c.store.finish_run(other.id, "succeeded")
            run = await real_create(thread_id, **kw)
            ours.append(run.id)
            return run

        c.store.create_run = racing_create_run
        r = await tool_result(c, tid, call_id, {"confirmed": True})
        c.store.create_run = real_create
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_answer"}
        (rid,) = ours
        run = await c.store.get_run(rid)
        assert run.superseded and run.status == "cancelled"
        assert await c.store.list_events(rid) == []
        # the thread view does not show the aborted run as the last one
        view = (await c.get(f"/api/threads/{tid}")).json()
        assert view["last_run"]["id"] != rid


async def test_oversized_json_body_is_400():
    async with make_client() as c:
        big = json.dumps(
            {"thread_id": None, "input": {"type": "message", "content": "x" * (1024 * 1024)}}
        )
        r = await c.post("/api/runs", content=big, headers={"content-type": "application/json"})
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_input"}

        async def chunks():  # no content-length: the cap applies while streaming
            yield b'{"thread_id": null, "input": {"type": "message", "content": "'
            for _ in range(2048):
                yield b"y" * 1024
            yield b'"}}'

        r = await c.post(
            "/api/runs", content=chunks(), headers={"content-type": "application/json"}
        )
        assert r.status_code == 400
        assert (await c.get("/api/threads")).json() == []


async def test_regenerate_raced_by_another_run_is_409():
    """Another request ran on the thread between our check and create_run."""
    async with make_client() as c:
        ev = sse_events(await run_message(c, "q"))
        tid, old = started(ev)["threadId"], started(ev)["runId"]
        real_create = c.store.create_run
        ours = []

        async def racing_create_run(thread_id, **kw):
            other = await real_create(thread_id, **kw)  # e.g. a regenerate on another replica
            await c.store.mark_superseded(old)
            await c.store.finish_run(other.id, "succeeded")
            run = await real_create(thread_id, **kw)
            ours.append(run.id)
            return run

        c.store.create_run = racing_create_run
        r = await c.post("/api/runs", json={"thread_id": tid, "input": {"type": "regenerate"}})
        c.store.create_run = real_create
        assert r.status_code == 409
        assert r.json() == {"error": "run_in_progress"}
        run = await c.store.get_run(ours[0])
        assert run.superseded and run.status == "cancelled"
        assert await c.store.list_events(run.id) == []


@pytest.mark.parametrize("kind", ["tool_result", "regenerate"])
async def test_recheck_failure_of_any_kind_discards_new_run(kind):
    async with make_client(confirm_agent) as c:
        ev = sse_events(await run_message(c, "ask"))
        tid = started(ev)["threadId"]
        call_id = pending_call(ev)
        if kind == "regenerate":
            body = {"thread_id": tid, "input": {"type": "regenerate"}}
        else:
            body = {
                "thread_id": tid,
                "input": {"type": "tool_result", "tool_call_id": call_id,
                          "answer": {"confirmed": True}},
            }  # fmt: skip
        real_create, real_list = c.store.create_run, c.store.list_runs
        ours = []

        async def create_run(thread_id, **kw):
            run = await real_create(thread_id, **kw)
            ours.append(run.id)
            return run

        async def list_runs(thread_id):
            if ours:
                raise RuntimeError("store hiccup during re-check")
            return await real_list(thread_id)

        c.store.create_run, c.store.list_runs = create_run, list_runs
        with pytest.raises(RuntimeError):
            await c.post("/api/runs", json=body)
        c.store.create_run, c.store.list_runs = real_create, real_list
        run = await c.store.get_run(ours[0])
        assert run.superseded and run.status == "cancelled"
        assert c.app.state.live_runs == {}
