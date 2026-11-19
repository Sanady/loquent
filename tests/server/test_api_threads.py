from srv import (
    add_user,
    login,
    make_client,
    new_client,
    password_settings,
    run_message,
    sse_events,
    started,
)


def widget_agent(messages, ctx):
    from loquent import ui

    if ctx.answer is None:
        return _ask(ui)
    return f"answered {ctx.answer.value}"


async def _ask(ui):
    yield ui.ask(ui.Confirm("Proceed?"))


async def test_thread_list_rename_delete_and_title():
    async with make_client() as c:
        long = "  " + "word " * 30
        ev = sse_events(await run_message(c, long))
        tid = started(ev)["threadId"]
        threads = (await c.get("/api/threads")).json()
        assert len(threads) == 1
        assert set(threads[0]) == {"id", "title", "updated_at"}
        assert threads[0]["id"] == tid
        assert threads[0]["title"] == long.strip()[:60]
        assert len(threads[0]["title"]) == 60

        r = await c.patch(f"/api/threads/{tid}", json={"title": "Renamed"})
        assert r.status_code == 200
        assert r.json()["title"] == "Renamed"
        assert (await c.get("/api/threads")).json()[0]["title"] == "Renamed"

        for bad in ({"title": ""}, {"title": "   "}, {"title": 3}, {}, {"title": "x" * 201}):
            r = await c.patch(f"/api/threads/{tid}", json=bad)
            assert r.status_code == 400, bad
            assert r.json() == {"error": "invalid_input"}

        r = await c.delete(f"/api/threads/{tid}")
        assert r.status_code == 204
        assert (await c.get("/api/threads")).json() == []
        assert (await c.get(f"/api/threads/{tid}")).status_code == 404
        assert (await c.get(f"/api/threads/{tid}")).json() == {"error": "not_found"}


async def test_thread_view_shape():
    async with make_client() as c:
        ev = sse_events(await run_message(c, "hello"))
        tid, rid = started(ev)["threadId"], started(ev)["runId"]
        r = await c.get(f"/api/threads/{tid}")
        assert r.status_code == 200
        body = r.json()
        assert body["thread"]["id"] == tid
        assert body["thread"]["title"] == "hello"
        assert body["last_run"] == {"id": rid, "status": "succeeded", "last_seq": len(ev)}
        assert body["events"] == ev  # plain event dicts, same as streamed


async def test_other_users_thread_run_file_are_404():
    """Review Focus 1: another signed-in user's ids are 404 everywhere (file case: Task 10)."""
    async with make_client(widget_agent, settings=password_settings()) as a:
        await add_user(a, "alice")
        await add_user(a, "bob")
        csrf_a = await login(a, "alice")
        async with new_client(a.app) as b:
            csrf_b = await login(b, "bob")
            hb = {"X-Loquent-CSRF": csrf_b}
            ev = sse_events(await run_message(b, "bob's secret", headers=hb))
            tid, rid = started(ev)["threadId"], started(ev)["runId"]
            call_id = next(e["toolCallId"] for e in ev if e["type"] == "TOOL_CALL_START")

            ha = {"X-Loquent-CSRF": csrf_a}
            checks = [
                ("GET", f"/api/threads/{tid}", None),
                ("PATCH", f"/api/threads/{tid}", {"title": "pwned"}),
                ("DELETE", f"/api/threads/{tid}", None),
                ("GET", f"/api/runs/{rid}/events", None),
                ("GET", f"/api/runs/{rid}/events?after=0", None),
                ("POST", f"/api/runs/{rid}/cancel", None),
                ("POST", "/api/runs",
                 {"thread_id": tid, "input": {"type": "message", "content": "hi"}}),
                ("POST", "/api/runs", {"thread_id": tid, "input": {"type": "regenerate"}}),
                ("POST", "/api/runs", {
                    "thread_id": tid,
                    "input": {"type": "tool_result", "tool_call_id": call_id,
                              "answer": {"confirmed": True}},
                }),
            ]  # fmt: skip
            for method, path, body in checks:
                r = await a.request(method, path, json=body, headers=ha)
                assert r.status_code == 404, (method, path, r.status_code)
                assert r.json() == {"error": "not_found"}, (method, path)
                assert "secret" not in r.text

            # unknown ids look exactly the same
            for path in ("/api/threads/nope", "/api/runs/nope/events"):
                r = await a.get(path)
                assert r.status_code == 404
                assert r.json() == {"error": "not_found"}
            for inp in ({"type": "message", "content": "hi"}, {"type": "regenerate"}):
                r = await a.post("/api/runs", json={"thread_id": "nope", "input": inp}, headers=ha)
                assert r.status_code == 404  # not 409, and no orphan run is created
                assert r.json() == {"error": "not_found"}
                assert await a.store.list_runs("nope") == []

            # alice sees nothing of bob's, and bob's data is untouched
            assert (await a.get("/api/threads")).json() == []
            view = (await b.get(f"/api/threads/{tid}")).json()
            assert view["thread"]["title"] == "bob's secret"
            assert len(await a.store.list_runs(tid)) == 1
            run = await a.store.get_run(rid)
            assert not run.cancel_requested
            assert not run.superseded


async def test_thread_view_events_match_last_seq_while_run_is_live():
    """Events persisted between the view's reads must not make `events` overshoot last_seq."""
    import asyncio

    from loquent.store.models import StoredEvent

    gate = asyncio.Event()
    entered = asyncio.Event()

    async def slow(messages):
        entered.set()
        await gate.wait()
        return "done"

    async with make_client(slow) as c:
        first = asyncio.create_task(run_message(c, "slow"))
        await asyncio.wait_for(entered.wait(), 5)
        (thread,) = (await c.get("/api/threads")).json()
        (run,) = await c.store.list_runs(thread["id"])
        await asyncio.sleep(0.1)  # let the runner flush RUN_STARTED + the user message

        real = c.store.thread_events

        async def racing_thread_events(thread_id):
            # simulate the runner flushing another event between the view's two reads
            stored = await c.store.list_events(run.id)
            extra = {"type": "TEXT_MESSAGE_START", "messageId": "late", "role": "assistant"}
            await c.store.append_events(run.id, [StoredEvent(seq=stored[-1].seq + 1, event=extra)])
            return await real(thread_id)

        c.store.thread_events = racing_thread_events
        view = (await c.get(f"/api/threads/{thread['id']}")).json()
        c.store.thread_events = real
        assert view["last_run"]["status"] == "running"
        n = view["last_run"]["last_seq"]
        assert n >= 1
        assert len(view["events"]) == n  # only this run so far, seq 1..n
        assert all(e.get("messageId") != "late" for e in view["events"])
        polled = (await c.get(f"/api/runs/{run.id}/events", params={"after": n})).json()
        assert [x["event"].get("messageId") for x in polled["events"]][:1] == ["late"]

        gate.set()
        await asyncio.wait_for(first, 5)


async def test_delete_thread_while_run_is_live_is_409():
    """R19: deleting would erase the cancel flag with the run row; the client must Stop first."""
    import asyncio

    gate = asyncio.Event()
    entered = asyncio.Event()

    async def slow(messages):
        entered.set()
        await gate.wait()
        return "done"

    async with make_client(slow) as c:
        first = asyncio.create_task(run_message(c, "slow"))
        await asyncio.wait_for(entered.wait(), 5)
        (thread,) = (await c.get("/api/threads")).json()
        tid = thread["id"]

        r = await c.delete(f"/api/threads/{tid}")
        assert r.status_code == 409
        assert r.json() == {"error": "run_in_progress"}
        assert (await c.get(f"/api/threads/{tid}")).status_code == 200
        (run,) = await c.store.list_runs(tid)
        assert not run.cancel_requested  # refused outright, the run is untouched

        gate.set()
        await asyncio.wait_for(first, 5)
        r = await c.delete(f"/api/threads/{tid}")
        assert r.status_code == 204
        assert (await c.get(f"/api/threads/{tid}")).status_code == 404
        assert await c.store.list_runs(tid) == []
