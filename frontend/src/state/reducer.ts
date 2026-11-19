export type Attachment = { id: string; name: string; content_type: string; size: number; url?: string };

export type Item =
  | { kind: "message"; id: string; role: "user" | "assistant"; text: string; attachments: Attachment[]; streaming: boolean }
  | { kind: "step"; name: string; status: "running" | "done" }
  | { kind: "tool"; id: string; name: string; args: string; result?: string; status: "running" | "done" }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: "widget"; id: string; widget: "confirm" | "select" | "form"; args: any; answer?: any; argsComplete: boolean }
  | { kind: "error"; message: string; code?: string };

export type RunState = "idle" | "running" | "cancelled" | "failed" | "interrupted";

export interface ThreadView {
  items: Item[];
  run: RunState;
  runId?: string;
  lastSeq: number;
}

export type AgUiEvent =
  | { type: "RUN_STARTED"; threadId?: string; runId?: string }
  | { type: "RUN_FINISHED"; threadId?: string; runId?: string; outcome?: { type: string; pendingToolCallIds?: string[] } }
  | { type: "RUN_ERROR"; message: string; code?: string }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role?: string; metadata?: { attachments?: Attachment[] } & Record<string, unknown> }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "STEP_STARTED"; stepName: string }
  | { type: "STEP_FINISHED"; stepName: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId?: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "TOOL_CALL_RESULT"; toolCallId: string; content: string; messageId?: string }
  | { type: string; [key: string]: unknown };

const WIDGETS: Record<string, "confirm" | "select" | "form"> = {
  loquent_confirm: "confirm",
  loquent_select: "select",
  loquent_form: "form",
};

export function emptyView(): ThreadView {
  return { items: [], run: "idle", lastSeq: 0 };
}

function mapItem(items: Item[], index: number, fn: (i: Item) => Item): Item[] {
  return items.map((it, n) => (n === index ? fn(it) : it));
}

function findIndex(items: Item[], pred: (i: Item) => boolean): number {
  for (let n = items.length - 1; n >= 0; n--) if (pred(items[n])) return n;
  return -1;
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export function applyEvent(v: ThreadView, e: AgUiEvent, seq?: number): ThreadView {
  if (seq !== undefined && seq <= v.lastSeq) return v;
  const base: ThreadView = seq !== undefined ? { ...v, lastSeq: seq } : { ...v };
  // Typed loosely: the union's catch-all member defeats narrowing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = e as any;
  const items = base.items;

  switch (e.type) {
    case "RUN_STARTED":
      return { ...base, run: "running", runId: ev.runId };
    case "RUN_FINISHED":
      return { ...base, run: ev.outcome?.type === "cancelled" ? "cancelled" : "idle" };
    case "RUN_ERROR":
      return {
        ...base,
        run: "failed",
        items: [...items, { kind: "error", message: ev.message, code: ev.code }],
      };
    case "TEXT_MESSAGE_START": {
      const attachments: Attachment[] = Array.isArray(ev.metadata?.attachments) ? ev.metadata.attachments : [];
      const item: Item = {
        kind: "message",
        id: ev.messageId,
        role: ev.role === "user" ? "user" : "assistant",
        text: "",
        attachments,
        streaming: true,
      };
      return { ...base, items: [...items, item] };
    }
    case "TEXT_MESSAGE_CONTENT": {
      const i = findIndex(items, (x) => x.kind === "message" && x.id === ev.messageId);
      if (i < 0) return base;
      return { ...base, items: mapItem(items, i, (x) => (x.kind === "message" ? { ...x, text: x.text + ev.delta } : x)) };
    }
    case "TEXT_MESSAGE_END": {
      const i = findIndex(items, (x) => x.kind === "message" && x.id === ev.messageId);
      if (i < 0) return base;
      return { ...base, items: mapItem(items, i, (x) => (x.kind === "message" ? { ...x, streaming: false } : x)) };
    }
    case "STEP_STARTED":
      return { ...base, items: [...items, { kind: "step", name: ev.stepName, status: "running" }] };
    case "STEP_FINISHED": {
      const i = findIndex(items, (x) => x.kind === "step" && x.name === ev.stepName && x.status === "running");
      if (i < 0) return base;
      return { ...base, items: mapItem(items, i, (x) => (x.kind === "step" ? { ...x, status: "done" } : x)) };
    }
    case "TOOL_CALL_START": {
      const widget = WIDGETS[ev.toolCallName];
      const item: Item = widget
        ? { kind: "widget", id: ev.toolCallId, widget, args: "", argsComplete: false }
        : { kind: "tool", id: ev.toolCallId, name: ev.toolCallName, args: "", status: "running" };
      return { ...base, items: [...items, item] };
    }
    case "TOOL_CALL_ARGS": {
      const i = findIndex(items, (x) => (x.kind === "tool" || x.kind === "widget") && x.id === ev.toolCallId);
      if (i < 0) return base;
      return {
        ...base,
        items: mapItem(items, i, (x) =>
          (x.kind === "tool" || x.kind === "widget") && typeof x.args === "string" ? { ...x, args: x.args + ev.delta } : x,
        ),
      };
    }
    case "TOOL_CALL_END": {
      const i = findIndex(items, (x) => x.kind === "widget" && x.id === ev.toolCallId);
      if (i < 0) return base;
      return {
        ...base,
        items: mapItem(items, i, (x) => {
          if (x.kind !== "widget") return x;
          const parsed = typeof x.args === "string" ? parseJson(x.args || "{}") : { ok: true as const, value: x.args };
          return { ...x, args: parsed.ok ? parsed.value : {}, argsComplete: true };
        }),
      };
    }
    case "TOOL_CALL_RESULT": {
      const i = findIndex(items, (x) => (x.kind === "tool" || x.kind === "widget") && x.id === ev.toolCallId);
      if (i < 0) return base;
      return {
        ...base,
        items: mapItem(items, i, (x) => {
          if (x.kind === "widget") {
            const parsed = parseJson(ev.content);
            return { ...x, answer: parsed.ok ? parsed.value : ev.content };
          }
          if (x.kind === "tool") return { ...x, result: ev.content, status: "done" };
          return x;
        }),
      };
    }
    default:
      return base;
  }
}

export function applyEvents(v: ThreadView, es: AgUiEvent[]): ThreadView {
  return es.reduce((acc, e) => applyEvent(acc, e), v);
}
