import { useId, useState, type ReactNode } from "react";
import { part } from "../parts";
import type { Item } from "../state/reducer";
import { IconCheck, IconChevron, IconTool, Spinner } from "./icons";

type Step = Extract<Item, { kind: "step" }>;
type Tool = Extract<Item, { kind: "tool" }>;

function pretty(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function Row({
  icon,
  label,
  kind,
  running,
  children,
}: {
  icon?: ReactNode;
  label: string;
  kind: string;
  running: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div
      className={`lq-activity lq-activity-${kind}${open ? " is-open" : ""}`}
      {...part("activity", { state: running ? "running" : "done" })}
    >
      <button
        type="button"
        className="lq-activity-head"
        {...part(kind === "tool" ? "activity-tool" : "activity-step")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lq-activity-chevron">
          <IconChevron />
        </span>
        {icon}
        <span className="lq-activity-label">{label}</span>
        <span className="lq-activity-status">
          {running ? <Spinner /> : <IconCheck />}
          <span className="lq-sr">{running ? "running" : "done"}</span>
        </span>
      </button>
      {open && (
        <div id={id} className={`lq-activity-body lq-${kind}-detail`}>
          {children}
        </div>
      )}
    </div>
  );
}

export function StepRow({ item }: { item: Step }) {
  return (
    <Row label={item.name} kind="step" running={item.status === "running"}>
      <p className="lq-activity-note">{item.status === "running" ? "In progress…" : "Completed"}</p>
    </Row>
  );
}

export function ToolRow({ item }: { item: Tool }) {
  const args = pretty(item.args);
  const result = pretty(item.result);
  return (
    <Row icon={<IconTool />} label={item.name} kind="tool" running={item.status === "running"}>
      <div className="lq-io">
        <span className="lq-io-label">Arguments</span>
        <pre>{args || "{}"}</pre>
      </div>
      <div className="lq-io">
        <span className="lq-io-label">Result</span>
        <pre>{item.status === "running" ? "Waiting for result…" : result || "(empty)"}</pre>
      </div>
    </Row>
  );
}
