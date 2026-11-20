import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApp, useAppStore } from "../storeContext";
import type { WidgetItem } from "./registry";

/** Parse a widget's args into an object, or null when missing/malformed. */
export function argsObject(item: WidgetItem): Record<string, unknown> | null {
  let a: unknown = item.args;
  if (typeof a === "string") {
    try {
      a = JSON.parse(a);
    } catch {
      return null;
    }
  }
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : null;
}

export function Fallback({ message }: { message?: string }) {
  return (
    <div className="lq-widget lq-widget-fallback">
      {message ? <p className="lq-widget-message">{message}</p> : null}
      <p className="lq-widget-pending">This form can't be displayed.</p>
    </div>
  );
}

export function Pending() {
  return (
    <div className="lq-widget" role="status">
      <p className="lq-widget-pending">Preparing…</p>
    </div>
  );
}

export function Shell({ widget, children }: { widget: string; children: ReactNode }) {
  return (
    <div className="lq-widget" data-widget={widget}>
      {children}
    </div>
  );
}

/**
 * Shared submit logic: answer through the store, stay disabled while the answer run starts and
 * runs, and re-enable if the call settles without the widget being answered (refused or failed).
 */
export function useAnswer(item: WidgetItem, interactive: boolean) {
  const store = useAppStore();
  const busy = useApp((s) => s.starting || s.view.run === "running");
  const [sent, setSent] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const disabled = !interactive || busy || sent;
  const submit = (value: unknown) => {
    if (disabled) return;
    setSent(true);
    void store
      .getState()
      .answer(item.id, value)
      .catch(() => false)
      .then(() => {
        if (mounted.current) setSent(false);
      });
  };
  return { disabled, submit };
}
