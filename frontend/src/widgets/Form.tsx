import { useState } from "react";
import type { WidgetItem } from "./registry";
import { Shell, useAnswer } from "./common";

type Kind = "string" | "number" | "integer" | "boolean" | "enum";
export interface Field {
  name: string;
  kind: Kind;
  label: string;
  required: boolean;
  options: string[];
}

/** Flat JSON Schema -> fields, or null if the schema is not displayable. */
export function parseSchema(schema: unknown): Field[] | null {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as Record<string, unknown>;
  const props = s.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  const req = s.required ?? [];
  if (!Array.isArray(req) || !req.every((r) => typeof r === "string")) return null;
  const fields: Field[] = [];
  for (const [name, spec] of Object.entries(props)) {
    if (!spec || typeof spec !== "object") return null;
    const p = spec as Record<string, unknown>;
    const label = typeof p.title === "string" && p.title ? p.title : name;
    let kind: Kind;
    let options: string[] = [];
    if (p.enum !== undefined) {
      if (!Array.isArray(p.enum) || p.enum.length === 0 || !p.enum.every((e) => typeof e === "string")) return null;
      kind = "enum";
      options = p.enum as string[];
    } else if (p.type === "string" || p.type === "number" || p.type === "integer" || p.type === "boolean") {
      kind = p.type;
    } else return null;
    fields.push({ name, kind, label, required: req.includes(name), options });
  }
  if (fields.length === 0) return null;
  return fields;
}

type Draft = Record<string, string | boolean>;

function check(f: Field, d: string | boolean | undefined): { error?: string; omit?: boolean; value?: string | number | boolean } {
  if (f.kind === "boolean") return { value: d === true };
  const raw = typeof d === "string" ? d : "";
  if (f.kind === "string" || f.kind === "enum") {
    if (raw === "") return f.required ? { error: "This field is required." } : { omit: true };
    return { value: raw };
  }
  if (raw.trim() === "") return f.required ? { error: "This field is required." } : { omit: true };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: "Enter a valid number." };
  if (f.kind === "integer" && !Number.isInteger(n)) return { error: "Enter a whole number." };
  return { value: n };
}

function show(f: Field, v: unknown): string {
  if (f.kind === "boolean") return v === true ? "Yes" : "No";
  return v === undefined || v === null || v === "" ? "—" : String(v);
}

export function Form({ item, args, fields, interactive }: { item: WidgetItem; args: Record<string, unknown>; fields: Field[]; interactive: boolean }) {
  const { disabled, submit } = useAnswer(item, interactive);
  const message = String(args.message);
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (item.answer !== undefined) {
    const values: Record<string, unknown> = item.answer?.values && typeof item.answer.values === "object" ? item.answer.values : {};
    return (
      <Shell widget="form">
        <p className="lq-widget-message">{message}</p>
        <dl className="lq-widget-values">
          {fields
            .filter((f) => f.name in values)
            .map((f) => (
              <div key={f.name}>
                <dt>{f.label}</dt>
                <dd>{show(f, values[f.name])}</dd>
              </div>
            ))}
        </dl>
      </Shell>
    );
  }

  const set = (name: string, v: string | boolean) => {
    setDraft((d) => ({ ...d, [name]: v }));
    setErrors((e) => {
      if (!(name in e)) return e;
      const { [name]: _gone, ...rest } = e;
      return rest;
    });
  };

  const onSubmit = () => {
    if (disabled) return;
    const errs: Record<string, string> = {};
    const values: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      const r = check(f, draft[f.name]);
      if (r.error) errs[f.name] = r.error;
      else if (!r.omit) values[f.name] = r.value as string | number | boolean;
    }
    setErrors(errs);
    if (Object.keys(errs).length === 0) submit({ values });
  };

  return (
    <Shell widget="form">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <fieldset className="lq-widget-group" disabled={!interactive || disabled}>
          <legend className="lq-widget-message">{message}</legend>
          {fields.map((f) => {
            const id = `f-${item.id}-${f.name}`;
            const err = errors[f.name];
            const common = {
              id,
              name: f.name,
              required: f.required,
              "aria-invalid": err ? true : undefined,
              "aria-describedby": err ? `${id}-err` : undefined,
            };
            const labelText = (
              <>
                {f.label}
                {f.required && (
                  <span className="lq-widget-req" aria-hidden="true">
                    {" "}
                    *
                  </span>
                )}
              </>
            );
            return (
              <div key={f.name} className={f.kind === "boolean" ? "lq-widget-field is-check" : "lq-widget-field"}>
                {f.kind === "boolean" ? (
                  <label htmlFor={id}>
                    <input {...common} type="checkbox" checked={draft[f.name] === true} onChange={(e) => set(f.name, e.target.checked)} />
                    <span>{labelText}</span>
                  </label>
                ) : (
                  <>
                    <label htmlFor={id}>{labelText}</label>
                    {f.kind === "enum" ? (
                      <select {...common} value={typeof draft[f.name] === "string" ? (draft[f.name] as string) : ""} onChange={(e) => set(f.name, e.target.value)}>
                        <option value="">Select…</option>
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...common}
                        type={f.kind === "string" ? "text" : "number"}
                        step={f.kind === "integer" ? 1 : f.kind === "number" ? "any" : undefined}
                        value={typeof draft[f.name] === "string" ? (draft[f.name] as string) : ""}
                        onChange={(e) => set(f.name, e.target.value)}
                      />
                    )}
                  </>
                )}
                {err && (
                  <p id={`${id}-err`} className="lq-widget-error" role="alert">
                    {err}
                  </p>
                )}
              </div>
            );
          })}
        </fieldset>
        <div className="lq-widget-actions">
          <button type="submit" className="lq-btn lq-btn-primary" disabled={disabled}>
            Submit
          </button>
        </div>
      </form>
    </Shell>
  );
}
