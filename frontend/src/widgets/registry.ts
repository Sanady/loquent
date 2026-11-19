import { createElement, type ReactNode } from "react";
import type { Item } from "../state/reducer";
import { Confirm, validConfirm } from "./Confirm";
import { Fallback, Pending, argsObject } from "./common";
import { Form, parseSchema } from "./Form";
import { Select, parseOptions } from "./Select";

export type WidgetItem = Extract<Item, { kind: "widget" }>;

export interface RenderOptions {
  /** False renders an unanswered widget disabled (it is not the last pending one). Default true. */
  interactive?: boolean;
}

/** Render a widget item. Keep this export name; MessageList depends on it. */
export function renderWidget(item: WidgetItem, opts: RenderOptions = {}): ReactNode {
  const interactive = opts.interactive !== false;
  if (!item.argsComplete) return createElement(Pending);
  const args = argsObject(item);
  const message = args && typeof args.message === "string" ? args.message : undefined;
  const fallback = createElement(Fallback, { message });
  if (!args || message === undefined) return fallback;

  switch (item.widget) {
    case "confirm":
      return validConfirm(args) ? createElement(Confirm, { item, args, interactive }) : fallback;
    case "select": {
      const options = parseOptions(args.options);
      return options ? createElement(Select, { item, args, options, interactive }) : fallback;
    }
    case "form": {
      const fields = parseSchema(args.schema);
      return fields ? createElement(Form, { item, args, fields, interactive }) : fallback;
    }
    default:
      return fallback;
  }
}
