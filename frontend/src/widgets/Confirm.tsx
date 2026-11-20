import type { WidgetItem } from "./registry";
import { Shell, useAnswer } from "./common";

export function Confirm({ item, args, interactive }: { item: WidgetItem; args: Record<string, unknown>; interactive: boolean }) {
  const { disabled, submit } = useAnswer(item, interactive);
  const message = String(args.message);
  const confirmLabel = typeof args.confirmLabel === "string" && args.confirmLabel ? args.confirmLabel : "Confirm";
  const rejectLabel = typeof args.rejectLabel === "string" && args.rejectLabel ? args.rejectLabel : "Reject";

  if (item.answer !== undefined) {
    const ok = item.answer?.confirmed === true;
    return (
      <Shell widget="confirm">
        <p className="lq-widget-message">{message}</p>
        <p className="lq-widget-answer">
          <span className={`lq-widget-badge ${ok ? "is-ok" : "is-no"}`}>{ok ? "Approved" : "Rejected"}</span>
          <span>{ok ? confirmLabel : rejectLabel}</span>
        </p>
      </Shell>
    );
  }
  return (
    <Shell widget="confirm">
      <p className="lq-widget-message">{message}</p>
      <div className="lq-widget-actions">
        <button type="button" className="lq-btn lq-btn-primary" disabled={disabled} onClick={() => submit({ confirmed: true })}>
          {confirmLabel}
        </button>
        <button type="button" className="lq-btn" disabled={disabled} onClick={() => submit({ confirmed: false })}>
          {rejectLabel}
        </button>
      </div>
    </Shell>
  );
}

export function validConfirm(args: Record<string, unknown>): boolean {
  return typeof args.message === "string";
}

