import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "./icons";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = "Copy", compact = false }: { text: string; label?: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await writeClipboard(text);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  };

  const name = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;
  return (
    <button type="button" className={`lq-action${compact ? " lq-action-compact" : ""}`} onClick={onClick} aria-label={name} title={name}>
      {state === "copied" ? <IconCheck /> : <IconCopy />}
      {compact && <span>{state === "copied" ? "Copied" : "Copy"}</span>}
    </button>
  );
}
