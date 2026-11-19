import { createElement, type ReactNode } from "react";
import type { Item } from "../state/reducer";

export type WidgetItem = Extract<Item, { kind: "widget" }>;

/**
 * Render a widget item. Placeholder until the real widgets land: shows the widget's
 * `message` read-only. Keep this export name and signature; MessageList depends on it.
 */
export function renderWidget(item: WidgetItem): ReactNode {
  const args = item.argsComplete && item.args && typeof item.args === "object" ? item.args : null;
  const message = args && typeof args.message === "string" ? args.message : "";
  return createElement(
    "div",
    { className: "lq-widget", "data-widget": item.widget },
    message ? createElement("p", { className: "lq-widget-message" }, message) : createElement("p", { className: "lq-widget-pending" }, "…"),
  );
}
