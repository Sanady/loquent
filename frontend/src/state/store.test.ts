import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError, type Api, type RunBody, type RunEvents, type StreamedEvent } from "../api/client";
import type { AgUiEvent } from "./reducer";
import { createAppStore } from "./store";

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

beforeEach(() => vi.useFakeTimers());
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
});
