import { useState } from "react";
import type { WidgetItem } from "./registry";
import { Shell, useAnswer } from "./common";

interface Option {
  value: string;
  label: string;
}

export function parseOptions(raw: unknown): Option[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Option[] = [];
  for (const o of raw) {
    if (typeof o === "string") {
      out.push({ value: o, label: o }); // the server accepts plain strings too
      continue;
    }
    if (!o || typeof o !== "object") return null;
    const { value, label } = o as Record<string, unknown>;
    if (typeof value !== "string") return null;
    out.push({ value, label: typeof label === "string" ? label : value });
  }
  if (new Set(out.map((o) => o.value)).size !== out.length) return null;
  return out;
}

export function Select({ item, args, options, interactive }: { item: WidgetItem; args: Record<string, unknown>; options: Option[]; interactive: boolean }) {
  const { disabled, submit } = useAnswer(item, interactive);
  const multiple = args.multiple === true;
  const message = String(args.message);
  const [chosen, setChosen] = useState<string[]>([]);
  const label = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  if (item.answer !== undefined) {
    const picked: string[] = Array.isArray(item.answer?.values)
      ? item.answer.values
      : typeof item.answer?.value === "string"
        ? [item.answer.value]
        : [];
    return (
      <Shell widget="select">
        <p className="lq-widget-message">{message}</p>
        <p className="lq-widget-answer">{picked.length ? picked.map(label).join(", ") : "No selection"}</p>
      </Shell>
    );
  }

  const toggle = (v: string) => setChosen((c) => (multiple ? (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]) : [v]));
  const canSubmit = !disabled && (multiple || chosen.length === 1);
  const onSubmit = () => {
    if (!canSubmit) return;
    // keep option order for multiple
    const ordered = options.map((o) => o.value).filter((v) => chosen.includes(v));
    submit(multiple ? { values: ordered } : { value: chosen[0] });
  };

  return (
    <Shell widget="select">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <fieldset className="lq-widget-group" disabled={!interactive || disabled}>
          <legend className="lq-widget-message">{message}</legend>
          {options.map((o) => (
            <label key={o.value} className="lq-widget-option">
              <input
                type={multiple ? "checkbox" : "radio"}
                name={`sel-${item.id}`}
                value={o.value}
                checked={chosen.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="lq-widget-actions">
          <button type="submit" className="lq-btn lq-btn-primary" disabled={!canSubmit}>
            Submit
          </button>
        </div>
      </form>
    </Shell>
  );
}
