import { describe, expect, it } from "vitest";
import { applyEvent, applyEvents, emptyView, type AgUiEvent } from "./reducer";

const run = (): AgUiEvent => ({ type: "RUN_STARTED", threadId: "t", runId: "r1" });

describe("reducer", () => {
  it("streams text into one assistant message", () => {
    const v = applyEvents(emptyView(), [
      run(),
      { type: "TEXT_MESSAGE_START", messageId: "m1" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Hel" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "lo" },
    ]);
    expect(v.run).toBe("running");
    expect(v.runId).toBe("r1");
    expect(v.items).toEqual([
      { kind: "message", id: "m1", role: "assistant", text: "Hello", attachments: [], streaming: true },
    ]);
    const v2 = applyEvent(v, { type: "TEXT_MESSAGE_END", messageId: "m1" });
    expect(v2.items[0]).toMatchObject({ streaming: false });
  });

  it("user role message from input events", () => {
    const att = { id: "a", name: "f.txt", content_type: "text/plain", size: 3 };
    const v = applyEvents(emptyView(), [
      { type: "TEXT_MESSAGE_START", messageId: "u1", role: "user", metadata: { attachments: [att] } },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "u1", delta: "hi" },
      { type: "TEXT_MESSAGE_END", messageId: "u1" },
      { type: "TEXT_MESSAGE_START", messageId: "u2", role: "user" },
    ]);
    expect(v.items[0]).toMatchObject({ role: "user", text: "hi", attachments: [att], streaming: false });
    expect(v.items[1]).toMatchObject({ attachments: [] });
  });

  it("step started then finished", () => {
    const v = applyEvents(emptyView(), [
      { type: "STEP_STARTED", stepName: "a" },
      { type: "STEP_STARTED", stepName: "a" },
      { type: "STEP_FINISHED", stepName: "a" },
    ]);
    expect(v.items).toEqual([
      { kind: "step", name: "a", status: "running" },
      { kind: "step", name: "a", status: "done" },
    ]);
  });

  it("tool call args accumulate and result attaches", () => {
    const v = applyEvents(emptyView(), [
      { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "search", parentMessageId: "m1" },
      { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"q":' },
      { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '"x"}' },
      { type: "TOOL_CALL_END", toolCallId: "c1" },
      { type: "TOOL_CALL_RESULT", toolCallId: "c1", content: "found" },
    ]);
    expect(v.items).toEqual([
      { kind: "tool", id: "c1", name: "search", args: '{"q":"x"}', result: "found", status: "done" },
    ]);
  });

  it("loquent_confirm becomes widget; result sets answer", () => {
    let v = applyEvents(emptyView(), [
      { type: "TOOL_CALL_START", toolCallId: "w1", toolCallName: "loquent_confirm" },
      { type: "TOOL_CALL_ARGS", toolCallId: "w1", delta: '{"message":' },
    ]);
    expect(v.items[0]).toMatchObject({ kind: "widget", widget: "confirm", args: '{"message":', argsComplete: false });
    v = applyEvents(v, [
      { type: "TOOL_CALL_ARGS", toolCallId: "w1", delta: '"ok?"}' },
      { type: "TOOL_CALL_END", toolCallId: "w1" },
      { type: "TOOL_CALL_RESULT", toolCallId: "w1", content: '{"confirmed":true}' },
    ]);
    expect(v.items[0]).toEqual({
      kind: "widget", id: "w1", widget: "confirm", args: { message: "ok?" }, argsComplete: true, answer: { confirmed: true },
    });
  });

  it("widget invalid args give {} and non-JSON answer falls back to raw", () => {
    const v = applyEvents(emptyView(), [
      { type: "TOOL_CALL_START", toolCallId: "w", toolCallName: "loquent_select" },
      { type: "TOOL_CALL_ARGS", toolCallId: "w", delta: "{bad" },
      { type: "TOOL_CALL_END", toolCallId: "w" },
      { type: "TOOL_CALL_RESULT", toolCallId: "w", content: "plain" },
    ]);
    expect(v.items[0]).toMatchObject({ widget: "select", args: {}, argsComplete: true, answer: "plain" });
  });

  it("cancelled outcome sets run cancelled", () => {
    const v = applyEvents(emptyView(), [run(), { type: "RUN_FINISHED", outcome: { type: "cancelled" } }]);
    expect(v.run).toBe("cancelled");
    const w = applyEvents(emptyView(), [
      run(),
      { type: "RUN_FINISHED", outcome: { type: "success", pendingToolCallIds: [] } },
    ]);
    expect(w.run).toBe("idle");
    expect(applyEvents(emptyView(), [run(), { type: "RUN_FINISHED" }]).run).toBe("idle");
  });

  it("run error adds error item", () => {
    const v = applyEvents(emptyView(), [run(), { type: "RUN_ERROR", message: "boom", code: "E1" }]);
    expect(v.run).toBe("failed");
    expect(v.items).toEqual([{ kind: "error", message: "boom", code: "E1" }]);
  });

  it("ignores duplicate seq <= lastSeq", () => {
    let v = applyEvent(emptyView(), { type: "TEXT_MESSAGE_START", messageId: "m" }, 1);
    v = applyEvent(v, { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "a" }, 2);
    expect(v.lastSeq).toBe(2);
    const same = applyEvent(v, { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "a" }, 2);
    expect(same).toBe(v);
    expect(applyEvent(v, { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "z" }, 1)).toBe(v);
  });

  it("ignores unknown events", () => {
    const v = emptyView();
    const out = applyEvent(v, { type: "REASONING_START" } as AgUiEvent);
    expect(out.items).toEqual([]);
    expect(applyEvent(v, { type: "CUSTOM", name: "x" } as AgUiEvent).run).toBe("idle");
  });

  it("is pure: does not mutate input", () => {
    const base = applyEvents(emptyView(), [
      { type: "TEXT_MESSAGE_START", messageId: "m" },
      { type: "TOOL_CALL_START", toolCallId: "c", toolCallName: "t" },
    ]);
    const items = base.items.map((i) => Object.freeze({ ...i }));
    const frozen = Object.freeze({ ...base, items: Object.freeze(items) as typeof base.items });
    const next = applyEvents(frozen, [
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "x" },
      { type: "TOOL_CALL_ARGS", toolCallId: "c", delta: "y" },
      { type: "TOOL_CALL_RESULT", toolCallId: "c", content: "r" },
      { type: "TEXT_MESSAGE_END", messageId: "m" },
    ]);
    expect(next).not.toBe(frozen);
    expect(next.items[0]).not.toBe(frozen.items[0]);
    expect(frozen.items[0]).toMatchObject({ text: "", streaming: true });
    expect(frozen.items[1]).toMatchObject({ args: "" });
  });

  it("TEXT_MESSAGE_START is a no-op when a message with the same id exists", () => {
    const v = applyEvents(emptyView(), [
      { type: "TEXT_MESSAGE_START", messageId: "m" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "hi" },
    ]);
    const out = applyEvent(v, { type: "TEXT_MESSAGE_START", messageId: "m" });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ text: "hi" });
  });

  it("TOOL_CALL_START is a no-op when a tool or widget with the same id exists", () => {
    const v = applyEvents(emptyView(), [
      { type: "TOOL_CALL_START", toolCallId: "c", toolCallName: "t" },
      { type: "TOOL_CALL_START", toolCallId: "w", toolCallName: "loquent_confirm" },
    ]);
    const out = applyEvents(v, [
      { type: "TOOL_CALL_START", toolCallId: "c", toolCallName: "t" },
      { type: "TOOL_CALL_START", toolCallId: "w", toolCallName: "loquent_confirm" },
    ]);
    expect(out.items).toHaveLength(2);
  });
});
