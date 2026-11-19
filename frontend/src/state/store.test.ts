import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError, type Api, type RunBody, type RunEvents, type RunStatus, type StreamedEvent } from "../api/client";
import type { AgUiEvent } from "./reducer";
import { createAppStore, trimPageQuery } from "./store";

const started = (runId = "r1", threadId = "t1"): AgUiEvent => ({ type: "RUN_STARTED", threadId, runId });
const text = (id: string, t: string): AgUiEvent[] => [
  { type: "TEXT_MESSAGE_START", messageId: id },
  { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: t },
  { type: "TEXT_MESSAGE_END", messageId: id },
];
const seqd = (events: AgUiEvent[], from = 1): StreamedEvent[] => events.map((event, i) => ({ seq: from + i, event }));

function stream(items: StreamedEvent[], then?: "drop"): AsyncIterable<StreamedEvent> {
  return (async function* () {
    for (const i of items) yield i;
    if (then === "drop") throw new TypeError("network error");
  })();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeApi = Api & { [K in keyof Api]: Mock<any> };

function fakeApi(over: Partial<Record<keyof Api, unknown>> = {}): FakeApi {
  const base = {
    config: vi.fn(async () => ({ app_name: "L", auth: "none" })),
    login: vi.fn(async () => ({ user: { id: "u" }, csrf: "c" })),
    logout: vi.fn(async () => ({ ok: true })),
    me: vi.fn(async () => ({ user: { id: "u" }, csrf: "" })),
    threads: vi.fn(async () => []),
    thread: vi.fn(),
    renameThread: vi.fn(async () => ({})),
    deleteThread: vi.fn(async () => undefined),
    runEvents: vi.fn(),
    cancel: vi.fn(async () => ({ ok: true })),
    upload: vi.fn(),
    fileUrl: vi.fn(),
    startRun: vi.fn(),
  };
  return { ...base, ...over } as never;
}

const polled = (status: RunEvents["status"], events: StreamedEvent[]): RunEvents => ({ status, events });

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, "", "/"); // the open thread is mirrored into location.hash
});
afterEach(() => vi.useRealTimers());

describe("store", () => {
  it("send streams events into the view and refreshes the thread list", async () => {
    const api = fakeApi({
      startRun: vi.fn(() => stream(seqd([started(), ...text("m1", "hi"), { type: "RUN_FINISHED" }]))),
      threads: vi.fn(async () => [{ id: "t1", title: "hi", updated_at: "" }]),
    });
    const s = createAppStore(api);
    await s.getState().send("hello", []);
    const st = s.getState();
    expect(api.startRun.mock.calls[0][0]).toEqual({
      thread_id: null,
      input: { type: "message", content: "hello", attachments: [] },
      page_query: {},
    } satisfies RunBody);
    expect(st.currentThreadId).toBe("t1");
    expect(st.view.run).toBe("idle");
    expect(st.view.items[0]).toMatchObject({ kind: "message", text: "hi" });
    expect(st.threads).toHaveLength(1);
  });

  it("resets lastSeq before consuming a new run's stream", async () => {
    const api = fakeApi({
      startRun: vi.fn(() => stream(seqd([started("r2"), ...text("m2", "b"), { type: "RUN_FINISHED" }]))),
      thread: vi.fn(async () => ({
        thread: { id: "t1", title: "x", updated_at: "" },
        events: [],
        last_run: { id: "r1", status: "succeeded", last_seq: 50 },
      })),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    expect(s.getState().view.lastSeq).toBe(50);
    await s.getState().send("again", []);
    expect(s.getState().view.items.some((i) => i.kind === "message" && i.text === "b")).toBe(true);
    expect(s.getState().view.lastSeq).toBe(5);
  });

  it("falls back to polling after stream drop and completes view", async () => {
    const all: AgUiEvent[] = [started(), ...text("m1", "Hello"), { type: "RUN_FINISHED" }];
    // stream delivers 2 events then drops: RUN_STARTED, TEXT_MESSAGE_START
    const runEvents = vi.fn(async (_id: string, after: number) =>
      polled("succeeded", seqd(all.slice(after), after + 1)),
    );
    const api = fakeApi({ startRun: vi.fn(() => stream(seqd(all.slice(0, 2)), "drop")), runEvents });
    const s = createAppStore(api);
    const p = s.getState().send("hi", []);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(runEvents).toHaveBeenCalledWith("r1", 2);
    const v = s.getState().view;
    expect(v.run).toBe("idle");
    expect(v.items).toHaveLength(1);
    expect(v.items[0]).toMatchObject({ text: "Hello", streaming: false });
  });

  it("polls every 1000ms until terminal and handles stream ending early", async () => {
    const runEvents = vi
      .fn()
      .mockResolvedValueOnce(polled("running", seqd([{ type: "TEXT_MESSAGE_START", messageId: "m" }], 2)))
      .mockResolvedValueOnce(polled("succeeded", seqd([{ type: "RUN_FINISHED" }], 3)));
    const api = fakeApi({ startRun: vi.fn(() => stream(seqd([started()]))), runEvents });
    const s = createAppStore(api);
    const p = s.getState().send("hi", []);
    await vi.advanceTimersByTimeAsync(999);
    expect(runEvents).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runEvents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(runEvents).toHaveBeenCalledTimes(2);
    expect(s.getState().view.run).toBe("idle");
  });

  it("openThread on running run starts polling", async () => {
    const runEvents = vi.fn(async () =>
      polled("succeeded", seqd([...text("m1", "rest"), { type: "RUN_FINISHED" }], 4)),
    );
    const api = fakeApi({
      thread: vi.fn(async () => ({
        thread: { id: "t1", title: "x", updated_at: "" },
        events: [started()],
        last_run: { id: "r1", status: "running", last_seq: 3 },
      })),
      runEvents,
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    expect(s.getState().view).toMatchObject({ run: "running", runId: "r1", lastSeq: 3 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runEvents).toHaveBeenCalledWith("r1", 3);
    expect(s.getState().view.run).toBe("idle");
    expect(s.getState().view.items[0]).toMatchObject({ text: "rest" });
  });

  it.each([
    ["interrupted", "interrupted"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["succeeded", "idle"],
  ] as const)("openThread maps last_run %s to %s", async (status, run) => {
    const api = fakeApi({
      thread: vi.fn(async () => ({
        thread: { id: "t1", title: "x", updated_at: "" },
        events: [],
        last_run: { id: "r1", status, last_seq: 2 },
      })),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    expect(s.getState().view.run).toBe(run);
    expect(api.runEvents).not.toHaveBeenCalled();
  });

  it("polling ending interrupted with no terminal event sets interrupted", async () => {
    const api = fakeApi({
      startRun: vi.fn(() => stream(seqd([started()]), "drop")),
      runEvents: vi.fn(async () => polled("interrupted", [])),
    });
    const s = createAppStore(api);
    const p = s.getState().send("hi", []);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(s.getState().view.run).toBe("interrupted");
  });

  it("polling ending failed with no RUN_ERROR pushes an error item", async () => {
    const api = fakeApi({
      startRun: vi.fn(() => stream(seqd([started()]), "drop")),
      runEvents: vi.fn(async () => polled("failed", [])),
    });
    const s = createAppStore(api);
    const p = s.getState().send("hi", []);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    const v = s.getState().view;
    expect(v.run).toBe("failed");
    expect(v.items.at(-1)).toEqual({ kind: "error", message: "The run failed." });
  });

  it('409 surfaces "already running" error item', async () => {
    const api = fakeApi({
      startRun: vi.fn(() => {
        throw new ApiError(409, "run_in_progress");
      }),
    });
    const s = createAppStore(api);
    await s.getState().send("hi", []);
    expect(s.getState().view.items).toEqual([
      { kind: "error", message: "A reply is already in progress.", code: "run_in_progress" },
    ]);
    expect(api.runEvents).not.toHaveBeenCalled();
  });

  it("maps other error codes to short messages, never raw text", async () => {
    const api = fakeApi({
      startRun: vi.fn(() => {
        throw new ApiError(429, "rate_limited");
      }),
    });
    const s = createAppStore(api);
    await s.getState().send("hi", []);
    const it = s.getState().view.items[0];
    expect(it).toMatchObject({ kind: "error", code: "rate_limited" });
    expect((it as { message: string }).message).not.toContain("rate_limited");
  });

  it("401 clears the user", async () => {
    const api = fakeApi({
      startRun: vi.fn(() => {
        throw new ApiError(401, "unauthorized");
      }),
    });
    const s = createAppStore(api);
    await s.getState().init();
    expect(s.getState().user).toMatchObject({ id: "u" });
    await s.getState().send("hi", []);
    expect(s.getState().user).toBeNull();
  });

  it("answer and regenerate send the right bodies", async () => {
    const startRun = vi.fn((_b: RunBody) => stream(seqd([started(), { type: "RUN_FINISHED" }])));
    const api = fakeApi({
      startRun,
      thread: vi.fn(async () => ({
        thread: { id: "t1", title: "x", updated_at: "" },
        events: [],
        last_run: { id: "r0", status: "succeeded", last_seq: 9 },
      })),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    await s.getState().answer("call1", { ok: true });
    expect(api.startRun.mock.calls[0][0]).toMatchObject({
      thread_id: "t1",
      input: { type: "tool_result", tool_call_id: "call1", answer: { ok: true } },
    });
    await s.getState().regenerate();
    expect(api.startRun.mock.calls[1][0]).toMatchObject({ thread_id: "t1", input: { type: "regenerate" } });
  });

  it("send uploads files first and passes their ids", async () => {
    const api = fakeApi({
      upload: vi.fn(async () => ({ id: "f1", name: "a", content_type: "x", size: 1 })),
      startRun: vi.fn(() => stream(seqd([started(), { type: "RUN_FINISHED" }]))),
    });
    const s = createAppStore(api);
    await s.getState().send("see", [new File(["x"], "a.txt")]);
    expect((api.startRun.mock.calls[0][0] as RunBody).input).toEqual({ type: "message", content: "see", attachments: ["f1"] });
  });

  it("stop cancels the run and keeps consuming until the terminal event", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = fakeApi({
      startRun: vi.fn(() =>
        (async function* () {
          yield* seqd([started()]);
          await gate;
          yield* seqd([{ type: "RUN_FINISHED", outcome: { type: "cancelled" } }], 2);
        })(),
      ),
    });
    const s = createAppStore(api);
    const p = s.getState().send("hi", []);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getState().view.run).toBe("running");
    await s.getState().stop();
    expect(api.cancel).toHaveBeenCalledWith("r1");
    expect(s.getState().view.run).toBe("running");
    release();
    await p;
    expect(s.getState().view.run).toBe("cancelled");
  });

  it("deleteThread on a running run stops first, waits, then deletes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const api = fakeApi({
      startRun: vi.fn(() =>
        (async function* () {
          yield* seqd([started()]);
          await gate;
          yield* seqd([{ type: "RUN_FINISHED", outcome: { type: "cancelled" } }], 2);
        })(),
      ),
      cancel: vi.fn(async () => {
        order.push("cancel");
        release();
        return { ok: true };
      }),
      deleteThread: vi.fn(async () => {
        order.push("delete");
      }),
    });
    const s = createAppStore(api);
    const p = s.getState().send("hi", []);
    await vi.advanceTimersByTimeAsync(0);
    await s.getState().deleteThread("t1");
    await p;
    expect(order).toEqual(["cancel", "delete"]);
    expect(s.getState().currentThreadId).toBeNull();
    expect(s.getState().view.items).toEqual([]);
  });

  it("delete 409 surfaces an error item and does not loop", async () => {
    const api = fakeApi({
      thread: vi.fn(async () => ({
        thread: { id: "t1", title: "x", updated_at: "" },
        events: [],
        last_run: { id: "r1", status: "succeeded", last_seq: 1 },
      })),
      deleteThread: vi.fn(async () => {
        throw new ApiError(409, "run_in_progress");
      }),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    await s.getState().deleteThread("t1");
    expect(api.deleteThread).toHaveBeenCalledTimes(1);
    expect(s.getState().currentThreadId).toBe("t1");
    expect(s.getState().view.items.at(-1)).toMatchObject({ kind: "error", code: "run_in_progress" });
  });

  it("switching threads abandons the old poll", async () => {
    const runEvents = vi.fn(async () => polled("running", []));
    const api = fakeApi({
      thread: vi.fn(async (id: string) => ({
        thread: { id, title: "x", updated_at: "" },
        events: [],
        last_run: { id: "r" + id, status: id === "a" ? "running" : "succeeded", last_seq: 0 },
      })),
      runEvents,
    });
    const s = createAppStore(api);
    await s.getState().openThread("a");
    await s.getState().openThread("b");
    await vi.advanceTimersByTimeAsync(5000);
    expect(runEvents).not.toHaveBeenCalled();
    s.getState().newThread();
    expect(s.getState().currentThreadId).toBeNull();
  });

  const threadWith = (status: RunStatus, id = "r1", seq = 9) =>
    vi.fn(async (tid: string = "t1") => ({
      thread: { id: tid, title: "x", updated_at: "" },
      events: [],
      last_run: { id, status, last_seq: seq },
    }));

  it("a 409 keeps the existing runId and lastSeq", async () => {
    const api = fakeApi({
      thread: threadWith("succeeded"),
      startRun: vi.fn(() => {
        throw new ApiError(409, "run_in_progress");
      }),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    await s.getState().send("hi", []);
    expect(s.getState().view).toMatchObject({ runId: "r1", lastSeq: 9 });
    expect(s.getState().view.items.at(-1)).toMatchObject({ code: "run_in_progress" });
  });

  it("a stale poll response for run A after run B started changes nothing", async () => {
    let resolve!: (r: RunEvents) => void;
    const api = fakeApi({
      thread: threadWith("running", "rA", 3),
      runEvents: vi.fn(() => new Promise<RunEvents>((r) => (resolve = r))),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    await vi.advanceTimersByTimeAsync(1000);
    const b = { items: [], run: "running" as const, runId: "rB", lastSeq: 1 };
    s.setState({ view: b });
    resolve(polled("succeeded", seqd(text("mA", "stale"), 4)));
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.getState().view).toBe(b);
  });

  it("a double send makes exactly one startRun call", async () => {
    const api = fakeApi({ startRun: vi.fn(() => stream(seqd([started(), { type: "RUN_FINISHED" }]))) });
    const s = createAppStore(api);
    await Promise.all([s.getState().send("a", []), s.getState().send("b", [])]);
    expect(api.startRun).toHaveBeenCalledTimes(1);
    expect(s.getState().view.items.some((i) => i.kind === "error")).toBe(false);
  });

  it("switching threads during an upload posts nothing", async () => {
    let done!: (a: { id: string; name: string; content_type: string; size: number }) => void;
    const api = fakeApi({
      thread: threadWith("succeeded"),
      upload: vi.fn(() => new Promise((r) => (done = r))),
      startRun: vi.fn(() => stream([])),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    const p = s.getState().send("hi", [new File(["x"], "a.txt")]);
    await s.getState().openThread("t2");
    done({ id: "f", name: "a", content_type: "x", size: 1 });
    await p;
    expect(api.startRun).not.toHaveBeenCalled();
    expect(s.getState().currentThreadId).toBe("t2");
    expect(s.getState().view.items).toEqual([]);
  });

  it("an upload failure is not reported into another thread's view", async () => {
    let fail!: (e: unknown) => void;
    const api = fakeApi({
      thread: threadWith("succeeded"),
      upload: vi.fn(() => new Promise((_r, rej) => (fail = rej))),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    const p = s.getState().send("hi", [new File(["x"], "a.txt")]);
    await s.getState().openThread("t2");
    fail(new ApiError(415, "unsupported_media_type"));
    await p;
    expect(s.getState().view.items).toEqual([]);
  });

  it("trims page_query to 20 entries and drops entries over 1024 bytes", () => {
    const entries: [string, string][] = Array.from({ length: 30 }, (_, i) => [`k${i}`, "v"]);
    expect(Object.keys(trimPageQuery(entries))).toHaveLength(20);
    const out = trimPageQuery([["big", "x".repeat(1025)], ["é".repeat(513), "v"], ["ok", "é".repeat(512)]]);
    expect(Object.keys(out)).toEqual(["ok"]);
  });

  it("send applies the trim to the configured page query", async () => {
    const api = fakeApi({ startRun: vi.fn(() => stream(seqd([started(), { type: "RUN_FINISHED" }]))) });
    const s = createAppStore(api, {
      pageQuery: () => Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, "v"])),
    });
    await s.getState().send("hi", []);
    expect(Object.keys((api.startRun.mock.calls[0][0] as RunBody).page_query)).toHaveLength(20);
  });

  it("poll errors back off, report Connection lost after 5, and keep polling", async () => {
    const runEvents = vi.fn().mockRejectedValue(new TypeError("net"));
    const api = fakeApi({ thread: threadWith("running", "r1", 3), runEvents });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    await vi.advanceTimersByTimeAsync(1000); // call 1, next delay 2000
    expect(runEvents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(runEvents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // call 2, delay 4000
    await vi.advanceTimersByTimeAsync(4000); // call 3, delay 8000
    await vi.advanceTimersByTimeAsync(8000); // call 4, delay 10000 (cap)
    expect(s.getState().view.items).toEqual([]);
    await vi.advanceTimersByTimeAsync(10000); // call 5
    expect(runEvents).toHaveBeenCalledTimes(5);
    expect(s.getState().view.items).toEqual([{ kind: "error", message: "Connection lost." }]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(runEvents).toHaveBeenCalledTimes(6);
    expect(s.getState().view.items).toHaveLength(1);
  });

  it("poll exits on 404 with the run interrupted, and on 401 with user cleared", async () => {
    for (const [status, code] of [[404, "not_found"], [401, "unauthorized"]] as const) {
      const api = fakeApi({
        thread: threadWith("running", "r1", 3),
        runEvents: vi.fn().mockRejectedValue(new ApiError(status, code)),
      });
      const s = createAppStore(api);
      await s.getState().init();
      await s.getState().openThread("t1");
      await vi.advanceTimersByTimeAsync(1000);
      expect(s.getState().view.run).toBe("interrupted");
      expect(s.getState().user === null).toBe(status === 401);
    }
  });

  it("delete waits on the thread itself after the user switched away", async () => {
    const statuses: RunStatus[] = ["running", "running", "cancelled"];
    const order: string[] = [];
    const api = fakeApi({
      thread: vi.fn(async (id: string) => ({
        thread: { id, title: "x", updated_at: "" },
        events: [],
        last_run: { id: "r" + id, status: id === "a" ? (statuses.shift() ?? "cancelled") : "succeeded", last_seq: 0 },
      })),
      runEvents: vi.fn(async () => polled("running", [])),
      deleteThread: vi.fn(async () => {
        order.push("delete");
      }),
    });
    const s = createAppStore(api);
    await s.getState().openThread("b");
    const p = s.getState().deleteThread("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.deleteThread).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    expect(order).toEqual(["delete"]);
    expect(s.getState().currentThreadId).toBe("b");
  });

  it("answer after RUN_FINISHED starts a run while threads() is still pending", async () => {
    const startRun = vi.fn((_b: RunBody) => stream(seqd([started("r2"), { type: "RUN_FINISHED" }])));
    let threadsCalls = 0;
    const api = fakeApi({
      startRun,
      threads: vi.fn(() => {
        threadsCalls++;
        if (threadsCalls > 1) return Promise.resolve([]);
        return new Promise(() => undefined); // first call never resolves: stalled network
      }),
    });
    const s = createAppStore(api);
    const first = s.getState().send("hi", []);
    await vi.advanceTimersByTimeAsync(0);
    expect(threadsCalls).toBe(1);
    expect(s.getState().view.run).toBe("idle");
    const ok = await s.getState().answer("c1", { ok: true });
    expect(ok).toBe(true);
    expect(startRun).toHaveBeenCalledTimes(2);
    void first;
  });

  it("send/answer/regenerate resolve false when refused and starting is exposed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = fakeApi({
      startRun: vi.fn(() =>
        (async function* () {
          await gate;
          yield* seqd([started(), { type: "RUN_FINISHED" }]);
        })(),
      ),
    });
    const s = createAppStore(api);
    const p = s.getState().send("a", []);
    expect(s.getState().starting).toBe(true);
    expect(await s.getState().send("b", [])).toBe(false);
    expect(await s.getState().regenerate()).toBe(false);
    release();
    expect(await p).toBe(true);
    expect(s.getState().starting).toBe(false);
  });

  it("stop before RUN_STARTED aborts the POST, and a later send works", async () => {
    const signals: AbortSignal[] = [];
    const api = fakeApi({
      startRun: vi.fn((_b: RunBody, signal?: AbortSignal) => {
        signals.push(signal as AbortSignal);
        if (signals.length === 1)
          return (async function* () {
            await new Promise((_r, rej) => signal!.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))));
            yield* [] as StreamedEvent[];
          })();
        return stream(seqd([started("r2"), { type: "RUN_FINISHED" }]));
      }),
    });
    const s = createAppStore(api);
    const p = s.getState().send("a", []);
    await vi.advanceTimersByTimeAsync(0);
    await s.getState().stop();
    expect(signals[0].aborted).toBe(true);
    expect(await p).toBe(false);
    expect(s.getState().starting).toBe(false);
    expect(s.getState().view.items).toEqual([]);
    expect(await s.getState().send("b", [])).toBe(true);
    expect(api.startRun).toHaveBeenCalledTimes(2);
  });

  it("a send during openThread's fetch is refused and not overwritten", async () => {
    let resolveThread!: (v: unknown) => void;
    const api = fakeApi({
      thread: vi.fn(() => new Promise((r) => (resolveThread = r))),
      startRun: vi.fn(() => stream(seqd([started(), { type: "RUN_FINISHED" }]))),
    });
    const s = createAppStore(api);
    const open = s.getState().openThread("t1");
    expect(await s.getState().send("hi", [])).toBe(false);
    resolveThread({ thread: { id: "t1", title: "x", updated_at: "" }, events: [], last_run: null });
    await open;
    expect(api.startRun).not.toHaveBeenCalled();
    expect(await s.getState().send("hi", [])).toBe(true);
  });
  it("send resolves true (accepted) when the user switches threads mid-run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = fakeApi({
      startRun: vi.fn(() =>
        (async function* () {
          yield { seq: 1, event: started() };
          await gate;
          yield { seq: 2, event: { type: "RUN_FINISHED" } as AgUiEvent };
        })(),
      ),
    });
    const s = createAppStore(api);
    const p = s.getState().send("hi", []);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(s.getState().view.run).toBe("running");
    s.getState().newThread();
    release();
    await expect(p).resolves.toBe(true);
  });
});

const userMsg = (id: string, t: string): AgUiEvent[] => [
  { type: "TEXT_MESSAGE_START", messageId: id, role: "user" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: t },
  { type: "TEXT_MESSAGE_END", messageId: id },
];
const detail = (events: AgUiEvent[], last_run: { id: string; status: RunStatus; last_seq: number } | null) => ({
  thread: { id: "t1", title: "x", updated_at: "" },
  events,
  last_run,
});
const messages = (s: ReturnType<typeof createAppStore>) =>
  s.getState().view.items.flatMap((i) => (i.kind === "message" ? [`${i.role}:${i.text}`] : []));

describe("regenerate and Retry replace the superseded run in the view (item 2)", () => {
  it("reloads the thread once accepted, so only the new reply remains", async () => {
    const first = [started("r1"), ...userMsg("u1", "q"), ...text("m1", "old"), { type: "RUN_FINISHED" } as AgUiEvent];
    // The server's view after the new run r2 persisted its first three events.
    const after = [...userMsg("u1", "q"), started("r2"), { type: "TEXT_MESSAGE_START", messageId: "m2" }, { type: "TEXT_MESSAGE_CONTENT", messageId: "m2", delta: "new" }] as AgUiEvent[];
    const thread = vi
      .fn()
      .mockResolvedValueOnce(detail(first, { id: "r1", status: "succeeded", last_seq: 8 }))
      .mockResolvedValueOnce(detail(after, { id: "r2", status: "running", last_seq: 3 }));
    const api = fakeApi({
      thread,
      startRun: vi.fn(() => stream(seqd([started("r2"), ...text("m2", "new"), { type: "RUN_FINISHED" }]))),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    expect(messages(s)).toEqual(["user:q", "assistant:old"]);
    expect(await s.getState().regenerate()).toBe(true);
    expect(thread).toHaveBeenCalledTimes(2);
    // Exactly one reply, not doubled: streamed seq 1..3 were already in the reloaded view.
    expect(messages(s)).toEqual(["user:q", "assistant:new"]);
    expect(s.getState().view).toMatchObject({ runId: "r2", lastSeq: 5, run: "idle" });
  });

  it("Retry after a failed run drops the old error item", async () => {
    const first = [started("r1"), ...userMsg("u1", "q"), { type: "RUN_ERROR", message: "boom" } as AgUiEvent];
    const thread = vi
      .fn()
      .mockResolvedValueOnce(detail(first, { id: "r1", status: "failed", last_seq: 5 }))
      .mockResolvedValueOnce(detail([...userMsg("u1", "q")], { id: "r2", status: "running", last_seq: 0 }));
    const api = fakeApi({
      thread,
      startRun: vi.fn(() => stream(seqd([started("r2"), ...text("m2", "fine"), { type: "RUN_FINISHED" }]))),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    expect(s.getState().view.items.some((i) => i.kind === "error")).toBe(true);
    await s.getState().regenerate();
    expect(s.getState().view.items.some((i) => i.kind === "error")).toBe(false);
    expect(messages(s)).toEqual(["user:q", "assistant:fine"]);
  });

  it("a refused regenerate (409) reloads nothing and keeps the view", async () => {
    const first = [started("r1"), ...userMsg("u1", "q"), ...text("m1", "old"), { type: "RUN_FINISHED" } as AgUiEvent];
    const thread = vi.fn(async () => detail(first, { id: "r1", status: "succeeded", last_seq: 8 }));
    const api = fakeApi({
      thread,
      startRun: vi.fn(() => {
        throw new ApiError(409, "run_in_progress");
      }),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    await s.getState().regenerate();
    expect(thread).toHaveBeenCalledTimes(1);
    expect(messages(s)).toEqual(["user:q", "assistant:old"]);
  });
});

describe("history replay clears stale streaming flags (item 18)", () => {
  it("marks messages not streaming when the last run is terminal", async () => {
    const events = [started("r1"), ...userMsg("u1", "q"), { type: "TEXT_MESSAGE_START", messageId: "m1" }, { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "cut" }] as AgUiEvent[];
    for (const status of ["interrupted", "failed", "cancelled", "succeeded"] as const) {
      const api = fakeApi({ thread: vi.fn(async () => detail(events, { id: "r1", status, last_seq: 6 })) });
      const s = createAppStore(api);
      await s.getState().openThread("t1");
      const msgs = s.getState().view.items.filter((i) => i.kind === "message");
      expect(msgs.every((m) => m.kind === "message" && !m.streaming)).toBe(true);
    }
  });

  it("keeps the streaming flag while the run is still running", async () => {
    const events = [started("r1"), { type: "TEXT_MESSAGE_START", messageId: "m1" }] as AgUiEvent[];
    const api = fakeApi({
      thread: vi.fn(async () => detail(events, { id: "r1", status: "running", last_seq: 2 })),
      runEvents: vi.fn(async () => polled("running", [])),
    });
    const s = createAppStore(api);
    await s.getState().openThread("t1");
    expect(s.getState().view.items[0]).toMatchObject({ kind: "message", streaming: true });
    s.getState().newThread();
  });
});

describe("the open thread lives in location.hash (item 3)", () => {
  beforeEach(() => history.replaceState(null, "", "/?team=a"));
  afterEach(() => history.replaceState(null, "", "/"));

  it("openThread and newThread write #t=<id> with replaceState and keep the query", async () => {
    const replace = vi.spyOn(history, "replaceState");
    const api = fakeApi({ thread: vi.fn(async () => detail([], null)) });
    const s = createAppStore(api);
    await s.getState().openThread("t 1");
    expect(location.hash).toBe("#t=t%201");
    expect(location.search).toBe("?team=a");
    s.getState().newThread();
    expect(location.hash).toBe("");
    expect(location.search).toBe("?team=a");
    expect(replace).toHaveBeenCalled();
    replace.mockRestore();
  });

  it("a thread created by the first send is written to the hash", async () => {
    const api = fakeApi({ startRun: vi.fn(() => stream(seqd([started("r1", "t9"), { type: "RUN_FINISHED" }]))) });
    const s = createAppStore(api);
    await s.getState().send("hi", []);
    expect(location.hash).toBe("#t=t9");
  });

  it("init reopens the thread named in the hash", async () => {
    history.replaceState(null, "", "/?team=a#t=t1");
    const thread = vi.fn(async () => detail([...userMsg("u1", "q")], { id: "r1", status: "succeeded", last_seq: 3 }));
    const api = fakeApi({ thread });
    const s = createAppStore(api);
    await s.getState().init();
    expect(thread).toHaveBeenCalledWith("t1");
    expect(s.getState().currentThreadId).toBe("t1");
    expect(messages(s)).toEqual(["user:q"]);
  });

  it.each([404, 401])("init with an unknown or unowned id (%i) falls back to a new chat with no error", async (status) => {
    history.replaceState(null, "", "/?team=a#t=nope");
    const api = fakeApi({
      thread: vi.fn(async () => {
        throw new ApiError(status, status === 404 ? "not_found" : "unauthorized");
      }),
    });
    const s = createAppStore(api);
    await s.getState().init();
    expect(s.getState().currentThreadId).toBeNull();
    expect(s.getState().view.items).toEqual([]);
    expect(location.hash).toBe("");
  });

  it("login in password mode reopens the hash thread", async () => {
    history.replaceState(null, "", "/#t=t1");
    const thread = vi.fn(async () => detail([], null));
    const api = fakeApi({
      me: vi.fn(async () => {
        throw new ApiError(401, "unauthorized");
      }),
      thread,
    });
    const s = createAppStore(api);
    await s.getState().init();
    expect(thread).not.toHaveBeenCalled();
    expect(location.hash).toBe("#t=t1"); // kept for after sign-in
    await s.getState().login("a", "b");
    expect(thread).toHaveBeenCalledWith("t1");
    expect(s.getState().currentThreadId).toBe("t1");
  });
});
