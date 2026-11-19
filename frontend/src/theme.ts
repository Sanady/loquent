import { useCallback, useEffect, useState } from "react";

/** `config.theme` keys the UI understands; each maps to a `--lq-<key>` CSS variable. */
export const THEME_KEYS = ["accent", "background", "surface", "text", "muted", "radius", "font"] as const;

/** Palette keys that have a built-in dark value (styles.css gates those overrides per key). */
export const PALETTE_KEYS = ["background", "surface", "text", "muted"] as const;

/** Attribute on <html> listing the palette keys that are brand-fixed (dark overrides skip them). */
export const CUSTOM_ATTR = "data-lq-custom-colors";

/** Variables theme.ts may set besides the THEME_KEYS ones; cleared when no longer derived. */
const DERIVED_VARS = ["--lq-on-accent", "--lq-elevated"] as const;

export type ColorMode = "light" | "dark";
type Rgb = [number, number, number];

const MODE_KEY = "lq-color-mode";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const LIGHT_INK = "#1f1e1c";
const LIGHT_MUTED = "#6b675f";
const DARK_INK = "#ecebe7";
const DARK_MUTED = "#a6a29a";
const ON_LIGHT = "#111111";
const ON_DARK = "#ffffff";

// ---------- color math ----------

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba(); anything else is null (alpha ignored). */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.%]+\s*)?\)$/.exec(s);
  if (m) {
    const rgb = [m[1], m[2], m[3]].map(Number);
    if (rgb.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return rgb as Rgb;
  }
  return null;
}

/** Fall back to the browser's own parser (named colors, hsl(), ...) when available. */
function resolveColor(input: string): Rgb | null {
  const direct = parseColor(input);
  if (direct || typeof document === "undefined" || !document.body) return direct;
  try {
    const probe = document.createElement("span");
    probe.style.color = input;
    if (!probe.style.color) return null;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return parseColor(computed);
  } catch {
    return null;
  }
}

export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const isDark = (c: Rgb) => contrast(c, [255, 255, 255]) > contrast(c, [0, 0, 0]);

function mix(a: Rgb, b: Rgb, weightA: number): string {
  const hex = a.map((v, i) => Math.round(v * weightA + b[i] * (1 - weightA)).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

// ---------- theme resolution ----------

export interface ResolvedTheme {
  /** CSS variables to set on <html>. */
  vars: Record<string, string>;
  /** Palette keys that are brand-fixed in both color modes. */
  custom: string[];
  /** The scheme a brand palette implies (from its background), or null when the built-in palette applies. */
  scheme: ColorMode | null;
}

/**
 * Turn `config.theme` into CSS variables.
 *
 * - Every known key maps to `--lq-<key>`; unknown keys are ignored.
 * - `--lq-on-accent` (text on accent fills) is picked by contrast against the accent.
 * - When `background` is set, the developer owns the palette (R25): missing surface/text/muted
 *   are derived from it so the result is readable, the elevated surface is derived from the
 *   configured colors, and all four palette keys are marked custom so the built-in dark
 *   palette never overrides them. Without `background`, configured colors are light-mode
 *   tweaks and dark mode keeps the built-in palette.
 */
export function resolveTheme(theme: Record<string, string> | null | undefined): ResolvedTheme {
  const vars: Record<string, string> = {};
  const val = (k: string) => {
    const v = theme?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  for (const key of THEME_KEYS) {
    const v = val(key);
    if (v) vars[`--lq-${key}`] = v;
  }

  const accent = val("accent");
  const accentRgb = accent ? resolveColor(accent) : null;
  if (accentRgb) vars["--lq-on-accent"] = contrast(accentRgb, [17, 17, 17]) >= contrast(accentRgb, [255, 255, 255]) ? ON_LIGHT : ON_DARK;

  const background = val("background");
  if (!background) return { vars, custom: [], scheme: null };

  const bg = resolveColor(background);
  const dark = bg ? isDark(bg) : false;
  if (!val("text")) vars["--lq-text"] = dark ? DARK_INK : LIGHT_INK;
  if (!val("muted")) vars["--lq-muted"] = dark ? DARK_MUTED : LIGHT_MUTED;
  const text = resolveColor(vars["--lq-text"]);
  const surfaceVal = val("surface");
  let surface = surfaceVal ? resolveColor(surfaceVal) : null;
  if (!surfaceVal) {
    if (bg && text) {
      vars["--lq-surface"] = mix(text, bg, dark ? 0.07 : 0.045);
      surface = resolveColor(vars["--lq-surface"]);
    } else {
      vars["--lq-surface"] = "color-mix(in srgb, var(--lq-text) 6%, var(--lq-background))";
    }
  }
  vars["--lq-elevated"] =
    bg && surface ? mix(surface, bg, 0.35) : "color-mix(in srgb, var(--lq-surface) 35%, var(--lq-background))";

  return { vars, custom: [...PALETTE_KEYS], scheme: bg ? (dark ? "dark" : "light") : null };
}

/** Apply `config.theme` to `el` (default <html>) and return what was resolved. */
export function applyTheme(theme: Record<string, string> | null | undefined, el: HTMLElement = document.documentElement): ResolvedTheme {
  const resolved = resolveTheme(theme);
  for (const name of [...THEME_KEYS.map((k) => `--lq-${k}`), ...DERIVED_VARS]) {
    const v = resolved.vars[name];
    if (v) el.style.setProperty(name, v);
    else el.style.removeProperty(name);
  }
  if (resolved.custom.length) el.setAttribute(CUSTOM_ATTR, resolved.custom.join(" "));
  else el.removeAttribute(CUSTOM_ATTR);
  return resolved;
}

// ---------- color mode ----------

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
