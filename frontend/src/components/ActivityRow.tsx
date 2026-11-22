import { useId, useState, type ReactNode } from "react";
import { part } from "../parts";
import type { Item } from "../state/reducer";
import { IconChevron } from "./icons";

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

/** A row's status. "stopped": it was still running when its run ended, so it never will finish. */
export type ActivityStatus = "running" | "done" | "stopped";

/** The status of a step or tool: one still "running" after its run ended is "stopped". */
export function activityStatus(item: Step | Tool, runEnded: boolean): ActivityStatus {
  if (item.status !== "running") return "done";
  return runEnded ? "stopped" : "running";
}

const STATE = { running: "running", done: "done", stopped: "stopped" } as const;

function Row({
  label,
  kind,
  status,
  children,
}: {
  label: string;
  kind: string;
  status: ActivityStatus;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div
      className={`lq-activity lq-activity-${kind}${open ? " is-open" : ""}`}
      {...part(["activity", kind === "tool" ? "activity-tool" : "activity-step"], { state: STATE[status] })}
    >
      <button
        type="button"
        className="lq-activity-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lq-activity-dot" aria-hidden="true" />
        <span className="lq-activity-label">{label}</span>
        <span className="lq-sr">{status}</span>
        <span className="lq-activity-chevron">
          <IconChevron />
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

const STEP_NOTE: Record<ActivityStatus, string> = { running: "In progress…", done: "Completed", stopped: "Stopped before it finished" };

export function StepRow({ item, runEnded = false }: { item: Step; runEnded?: boolean }) {
  const status = activityStatus(item, runEnded);
  return (
    <Row label={item.name} kind="step" status={status}>
      <p className="lq-activity-note">{STEP_NOTE[status]}</p>
    </Row>
  );
}

export function ToolRow({ item, runEnded = false }: { item: Tool; runEnded?: boolean }) {
  const status = activityStatus(item, runEnded);
  const args = pretty(item.args);
  const result = pretty(item.result);
  return (
    <Row label={item.name} kind="tool" status={status}>
      <div className="lq-io">
        <span className="lq-io-label">Arguments</span>
        <pre>{args || "{}"}</pre>
      </div>
      <div className="lq-io">
        <span className="lq-io-label">Result</span>
        <pre>{status === "running" ? "Waiting for result…" : status === "stopped" ? "No result: the run ended first." : result || "(empty)"}</pre>
      </div>
    </Row>
  );
}
