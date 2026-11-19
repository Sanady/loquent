import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./client";
import { streamOf } from "./testutil";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const headersOf = (call: number) => (fetchMock.mock.calls[call][1].headers ?? {}) as Record<string, string>;

describe("api client", () => {
  it("uses relative paths and no csrf header on GET", async () => {
    fetchMock.mockResolvedValue(json([]));
    await api.threads();
    expect(fetchMock.mock.calls[0][0]).toBe("api/threads");
    expect(headersOf(0)["X-Loquent-CSRF"]).toBeUndefined();
  });

  it("login stores csrf and sends it on every non-GET", async () => {
    fetchMock.mockResolvedValueOnce(json({ user: { id: "u" }, csrf: "tok" }));
    await api.login("a", "b");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: "a", password: "b" });
    fetchMock.mockResolvedValueOnce(json({ ok: true }, 202));
    await api.cancel("r1");
    expect(fetchMock.mock.calls[1][0]).toBe("api/runs/r1/cancel");
    expect(headersOf(1)["X-Loquent-CSRF"]).toBe("tok");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteThread("t1");
    expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
    expect(headersOf(2)["X-Loquent-CSRF"]).toBe("tok");
  });

  it("me() with empty csrf (none mode) sends the empty string", async () => {
    fetchMock.mockResolvedValueOnce(json({ user: { id: "u" }, csrf: "" }));
    await api.me();
    fetchMock.mockResolvedValueOnce(json({ id: "t", title: "x", updated_at: "" }));
    await api.renameThread("t", "x");
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(headersOf(1)["X-Loquent-CSRF"]).toBe("");
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
  });

  it("upload posts FormData without a manual content type", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "f", name: "a.txt", content_type: "text/plain", size: 1 }));
    const out = await api.upload(new File(["x"], "a.txt", { type: "text/plain" }));
    expect(out.id).toBe("f");
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.headers["X-Loquent-CSRF"]).toBeDefined();
  });

  it("throws typed ApiError on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
    await expect(api.threads()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const e = await api.threads().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("http_error");
  });

  it("startRun sends csrf header and parses events", async () => {
    fetchMock.mockResolvedValueOnce(json({ user: {}, csrf: "tok2" }));
    await api.me();
    fetchMock.mockResolvedValueOnce(
      new Response(
        streamOf([
          'id: 1\ndata: {"type":"RUN_STARTED","threadId":"t","runId":"r"}\n\n',
          'id: 2\ndata: {"type":"RUN_FINISHED"}\n\n',
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    const body = { thread_id: null, input: { type: "regenerate" as const }, page_query: {} };
    const out = [];
    for await (const e of api.startRun(body, new AbortController().signal)) out.push(e);
    expect(fetchMock.mock.calls[1][0]).toBe("api/runs");
    expect(headersOf(1)["X-Loquent-CSRF"]).toBe("tok2");
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(body);
    expect(out).toEqual([
      { seq: 1, event: { type: "RUN_STARTED", threadId: "t", runId: "r" } },
      { seq: 2, event: { type: "RUN_FINISHED" } },
    ]);
  });

  it("startRun throws ApiError for 409", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "run_in_progress" }, 409));
    const it = api.startRun({ thread_id: "t", input: { type: "regenerate" }, page_query: {} })[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toMatchObject({ status: 409, code: "run_in_progress" });
  });
});
