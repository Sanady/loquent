import { useCallback, useEffect, useState } from "react";

/** `config.theme` keys the UI understands; each maps to a `--lq-<key>` CSS variable. */
export const THEME_KEYS = ["accent", "background", "surface", "text", "muted", "radius", "font"] as const;

export type ColorMode = "light" | "dark";

const MODE_KEY = "lq-color-mode";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Set `--lq-*` variables from the server theme on `el`. Unknown keys are ignored; missing keys are cleared. */
export function applyTheme(theme: Record<string, string> | null | undefined, el: HTMLElement = document.documentElement) {
  for (const key of THEME_KEYS) {
    const value = theme?.[key];
    if (typeof value === "string" && value.trim()) el.style.setProperty(`--lq-${key}`, value.trim());
    else el.style.removeProperty(`--lq-${key}`);
  }
}

export function readStoredMode(): ColorMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function storeMode(mode: ColorMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

function darkQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

export function systemMode(): ColorMode {
  return darkQuery()?.matches ? "dark" : "light";
}

/** The effective color mode: the stored choice if any, else the system preference (tracked live). */
export function useColorMode(): [ColorMode, () => void] {
  const [stored, setStored] = useState<ColorMode | null>(readStoredMode);
  const [system, setSystem] = useState<ColorMode>(systemMode);

  useEffect(() => {
    const q = darkQuery();
    if (!q || typeof q.addEventListener !== "function") return;
    const onChange = () => setSystem(q.matches ? "dark" : "light");
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, []);

  const mode = stored ?? system;
  const toggle = useCallback(() => {
    const next: ColorMode = mode === "dark" ? "light" : "dark";
    storeMode(next);
    setStored(next);
  }, [mode]);

  return [mode, toggle];
}
