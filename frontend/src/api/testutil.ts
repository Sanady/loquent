export function streamOf(chunks: (string | Uint8Array)[], fail?: Error): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) {
        const ch = chunks[i++];
        c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
      } else if (fail) c.error(fail);
      else c.close();
    },
  });
}
