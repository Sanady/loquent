export interface SseFrame {
  id?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/** Parse a text/event-stream body into frames. `data` is JSON-decoded when possible. */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let id: number | undefined;
  let data: string[] = [];
  let skipLf = false;

  const flush = (): SseFrame | null => {
    const frame = data.length > 0 ? { id, data: decode(data.join("\n")) } : null;
    id = undefined;
    data = [];
    return frame;
  };

  const handleLine = (line: string): SseFrame | null => {
    if (line === "") return flush();
    if (line.startsWith(":")) return null;
    const c = line.indexOf(":");
    const field = c < 0 ? line : line.slice(0, c);
    let value = c < 0 ? "" : line.slice(c + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "id") {
      const n = Number(value);
      id = value !== "" && Number.isFinite(n) ? n : undefined;
    }
    return null;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += decoder.decode(value, { stream: !done });
      if (skipLf && buf.startsWith("\n")) buf = buf.slice(1);
      if (buf !== "") skipLf = false;
      const lines = buf.split(/\r\n|\n|\r/);
      if (buf.endsWith("\r")) skipLf = true; // a CRLF may be split across chunks
      buf = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const f = handleLine(line);
        if (f) yield f;
      }
      if (done) break;
    }
    const last = flush(); // final frame without a trailing blank line
    if (last) yield last;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function decode(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
