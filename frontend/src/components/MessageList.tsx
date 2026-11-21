import { part } from "../parts";
import type { Item } from "../state/reducer";
import { useApp } from "../storeContext";
import { renderWidget } from "../widgets/registry";
import { StepRow, ToolRow } from "./ActivityRow";
import { IconAlert, IconRefresh } from "./icons";
import { Message, Typing } from "./Message";

function lastAssistantIndex(items: Item[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "message") return it.role === "assistant" ? i : -1;
  }
  return -1;
}

function ErrorItem({ item }: { item: Extract<Item, { kind: "error" }> }) {
  return (
    <div className="lq-error" {...part("error", { state: "error" })}>
      <IconAlert />
      <span>{item.message}</span>
    </div>
  );
}

function EmptyState() {
  const logo = useApp((s) => s.config?.logo_url ?? null);
  return (
    <div className="lq-empty" {...part("empty-state")}>
      {logo && <img className="lq-empty-logo" src={logo} alt="" />}
      <h1>How can I help?</h1>
      <p>Ask a question or describe what you need.</p>
    </div>
  );
}

export function MessageList() {
  const view = useApp((s) => s.view);
  const starting = useApp((s) => s.starting);
  const regenerate = useApp((s) => s.regenerate);
  const { items, run } = view;
  const running = run === "running";

  if (items.length === 0 && !starting && !running) return <EmptyState />;

  const idle = !starting && (run === "idle" || run === "cancelled");
  const regenAt = idle ? lastAssistantIndex(items) : -1;
  const last = items[items.length - 1];
  // Only the latest run's output can hold an answerable widget: one after the last user message.
  let lastUser = -1;
  let lastPending = -1;
  items.forEach((it, i) => {
    if (it.kind === "message" && it.role === "user") lastUser = i;
    if (it.kind === "widget" && it.answer === undefined) lastPending = i;
  });
  if (lastPending < lastUser) lastPending = -1;
  const showTyping =
    (running || starting) && !(last?.kind === "message" && last.role === "assistant" && last.streaming);

  return (
    <div className="lq-log" role="log" aria-live="polite" aria-busy={running} aria-label="Conversation">
      {items.map((it, i) => {
        switch (it.kind) {
          case "message":
            return (
              <Message
                key={`m-${it.id}`}
                item={it}
                actions={
                  i === regenAt ? (
                    <button type="button" className="lq-action" onClick={() => void regenerate()} aria-label="Regenerate response" title="Regenerate">
                      <IconRefresh />
                    </button>
                  ) : undefined
                }
              />
            );
          case "step":
            return <StepRow key={`s-${i}`} item={it} />;
          case "tool":
            return <ToolRow key={`t-${it.id}`} item={it} />;
          case "widget":
            return <div key={`w-${it.id}`} className="lq-widget-slot">{renderWidget(it, { interactive: i === lastPending })}</div>;
          case "error":
            return <ErrorItem key={`e-${i}`} item={it} />;
          default:
            return null;
        }
      })}
      {showTyping && (
        <div className="lq-msg lq-msg-assistant" {...part("message", { role: "assistant", state: "streaming" })}>
          <div {...part("message-assistant")}>
            <Typing />
          </div>
        </div>
      )}
      {!starting && (run === "failed" || run === "interrupted") && (
        <div className="lq-run-note">
          <span>{run === "interrupted" ? "The response was interrupted." : "The response did not finish."}</span>
          <button type="button" className="lq-btn lq-btn-quiet" onClick={() => void regenerate()}>
            <IconRefresh />
            Retry
          </button>
        </div>
      )}
      {run === "cancelled" && !starting && <div className="lq-run-note lq-run-note-quiet">Stopped</div>}
    </div>
  );
}
