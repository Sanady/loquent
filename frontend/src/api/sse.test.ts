import { describe, expect, it } from "vitest";
import { parseSSE } from "./sse";
import { streamOf } from "./testutil";

async function collect(body: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const f of parseSSE(body)) out.push(f);
  return out;
}

describe("parseSSE", () => {
  it("handles split chunks and id field", async () => {
    const frames = await collect(streamOf(["id: 1\nda", 'ta: {"a"', ':1}\n\nid: 2\ndata: {"b":2}\n\n']));
    expect(frames).toEqual([
      { id: 1, data: { a: 1 } },
      { id: 2, data: { b: 2 } },
    ]);
  });

  it("handles CRLF, including CR and LF split across chunks", async () => {
    const frames = await collect(streamOf(['id: 3\r\ndata: {"x":1}\r', "\n\r", "\n", 'data: {"y":2}\r\n\r\n']));
    expect(frames).toEqual([
      { id: 3, data: { x: 1 } },
      { id: undefined, data: { y: 2 } },
    ]);
  });

  it("ignores comments and joins multi-line data", async () => {
    const frames = await collect(streamOf([": keepalive\n\n", "data: line1\ndata: line2\n\n"]));
    expect(frames).toEqual([{ id: undefined, data: "line1\nline2" }]);
  });

  it("emits a final frame without trailing blank line", async () => {
    const frames = await collect(streamOf(['id: 9\ndata: {"z":1}']));
    expect(frames).toEqual([{ id: 9, data: { z: 1 } }]);
  });

  it("decodes multibyte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('data: {"t":"é€"}\n\n');
    const frames = await collect(streamOf([bytes.slice(0, 11), bytes.slice(11)]));
    expect(frames[0].data).toEqual({ t: "é€" });
  });

  it("propagates stream errors", async () => {
    await expect(collect(streamOf(['data: {"a":1}\n\n'], new Error("drop")))).rejects.toThrow("drop");
  });
});
