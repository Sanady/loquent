import { useEffect, useState } from "react";
import { loadThemeFonts } from "./fonts";
import { COLOR_TOKENS, THEME_SCHEME, THEME_TOKENS, THEMES, type ColorToken, type ThemeId } from "./themes";

/**
 * Legacy `config.theme` keys: the developer brand layer. It sits on top of the active theme
 * and below user prefs and user CSS. Mapping onto the theme tokens (`--lq-<token>`):
 *   accent      -> accent, plus derived accent-hover, accent-soft, accent-text (every theme)
 *   background  -> bg          surface -> surface    text -> text    muted -> text-muted
 *   radius      -> radius-sm/md/lg/xl (lg is the configured value)
 *   font        -> font-body
 * With `background` set, the remaining surfaces (bg-subtle, surface-raised, border,
 * border-strong, user-bubble, user-bubble-text, code-bg, text-subtle) are derived from it and
 * the brand palette applies in every theme (R25). Without it, the color keys other than
 * accent apply to light themes only.
 */
export const THEME_KEYS = ["accent", "background", "surface", "text", "muted", "radius", "font"] as const;

/** Palette keys that have a built-in dark value (styles.css gates those overrides per key). */
export const PALETTE_KEYS = ["background", "surface", "text", "muted"] as const;

/** Attribute on <html> listing the palette keys that are brand-fixed (R25). */
export const CUSTOM_ATTR = "data-lq-custom-colors";

/** Locking a token also locks the tokens derived from it. */
export const LOCK_DERIVED: Partial<Record<ColorToken, readonly ColorToken[]>> = {
  accent: ["accent-hover", "accent-soft", "accent-text"],
};

export type ColorMode = "light" | "dark";
export type ThemePref = ThemeId | "system";
export type Density = "comfortable" | "compact";
export type TextSize = "s" | "m" | "l";
type Rgb = [number, number, number];

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

// ---------- theme resolution (the legacy brand layer) ----------

export interface ResolvedTheme {
  /** Theme tokens (`--lq-<token>`) the brand sets for the requested scheme. */
  vars: Record<string, string>;
  /**
   * interim: removed in Task 6 with styles.css. The same brand under the old variable names
   * the legacy stylesheet reads (--lq-background, --lq-muted, --lq-on-accent, --lq-elevated,
   * --lq-radius, --lq-font, plus the shared --lq-accent, --lq-surface and --lq-text).
   */
  legacy: Record<string, string>;
  /** Palette keys that are brand-fixed in every theme. */
  custom: string[];
  /** The scheme a brand palette implies (from its background), or null when the theme's applies. */
  scheme: ColorMode | null;
}

/** Radius scale from the one legacy `radius` value: lg is the configured radius. */
const RADIUS_SCALE: Record<string, number> = { "--lq-radius-sm": 0.5, "--lq-radius-md": 0.67, "--lq-radius-lg": 1, "--lq-radius-xl": 1.33 };

/** Text color for accent fills: near-black or white, whichever contrasts more. */
function onAccent(rgb: Rgb): string {
  return contrast(rgb, [17, 17, 17]) >= contrast(rgb, [255, 255, 255]) ? ON_LIGHT : ON_DARK;
}

/** The accent and the tokens derived from it. accent-text is omitted when the color can't be parsed. */
function accentFamily(accent: string): Record<string, string> {
  const vars: Record<string, string> = {
    "--lq-accent": accent,
    "--lq-accent-hover": `color-mix(in srgb, ${accent} 85%, var(--lq-text))`,
    "--lq-accent-soft": `color-mix(in srgb, ${accent} 14%, transparent)`,
  };
  const rgb = resolveColor(accent);
  if (rgb) vars["--lq-accent-text"] = onAccent(rgb);
  return vars;
}

/**
 * Turn `config.theme` into theme tokens for a theme of the given scheme.
 *
 * - Every known key maps onto its token(s); unknown keys are ignored.
 * - accent-text (text on accent fills) is picked by contrast against the accent.
 * - When `background` is set, the developer owns the palette (R25): missing surface/text/muted
 *   are derived from it so the result is readable, the other surfaces are derived from the
 *   configured colors, and all four palette keys are marked custom. The palette then applies
 *   in every theme. Without `background`, the palette keys are light-theme tweaks: for a dark
 *   theme they are left out and the theme's own colors apply.
 */
export function resolveTheme(theme: Record<string, string> | null | undefined, themeScheme: ColorMode = "light"): ResolvedTheme {
  const vars: Record<string, string> = {};
  const legacy: Record<string, string> = {};
  const val = (k: string) => {
    const v = theme?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  for (const key of THEME_KEYS) {
    const v = val(key);
    if (v) legacy[`--lq-${key}`] = v;
  }

  const radius = val("radius");
  if (radius) for (const [name, f] of Object.entries(RADIUS_SCALE)) vars[name] = f === 1 ? radius : `calc(${radius} * ${f})`;
  const font = val("font");
  if (font) vars["--lq-font-body"] = font;
  const accent = val("accent");
  if (accent) Object.assign(vars, accentFamily(accent));
  if (vars["--lq-accent-text"]) legacy["--lq-on-accent"] = vars["--lq-accent-text"];

  const background = val("background");
  if (!background) {
    const palette = { "--lq-surface": val("surface"), "--lq-text": val("text"), "--lq-text-muted": val("muted") };
    if (themeScheme === "light") for (const [name, v] of Object.entries(palette)) if (v) vars[name] = v;
    return { vars, legacy, custom: [], scheme: null };
  }

  const bg = resolveColor(background);
  const dark = bg ? isDark(bg) : false;
  const text = val("text") ?? (dark ? DARK_INK : LIGHT_INK);
  const muted = val("muted") ?? (dark ? DARK_MUTED : LIGHT_MUTED);
  const textRgb = resolveColor(text);
  const mutedRgb = resolveColor(muted);
  vars["--lq-bg"] = background;
  vars["--lq-text"] = text;
  vars["--lq-text-muted"] = muted;

  // A tint of the text color over the background: hex when both parse, color-mix otherwise.
  const tint = (weight: number) =>
    bg && textRgb ? mix(textRgb, bg, weight) : `color-mix(in srgb, var(--lq-text) ${Math.round(weight * 100)}%, var(--lq-bg))`;

  const surfaceVal = val("surface");
  vars["--lq-surface"] = surfaceVal ?? tint(dark ? 0.07 : 0.045);
  const surface = resolveColor(vars["--lq-surface"]);
  vars["--lq-surface-raised"] =
    bg && surface ? mix(surface, bg, 0.35) : "color-mix(in srgb, var(--lq-surface) 35%, var(--lq-bg))";
  vars["--lq-bg-subtle"] = tint(dark ? 0.04 : 0.025);
  vars["--lq-border"] = tint(dark ? 0.16 : 0.11);
  vars["--lq-border-strong"] = tint(0.45);
  vars["--lq-user-bubble"] = tint(dark ? 0.1 : 0.06);
  vars["--lq-user-bubble-text"] = text;
  vars["--lq-code-bg"] = tint(dark ? 0.05 : 0.035);
  vars["--lq-text-subtle"] =
    bg && mutedRgb ? mix(mutedRgb, bg, 0.8) : "color-mix(in srgb, var(--lq-text-muted) 80%, var(--lq-bg))";

  // interim: removed in Task 6 with styles.css (old names of the derived palette).
  legacy["--lq-text"] = text;
  legacy["--lq-muted"] = muted;
  legacy["--lq-surface"] = vars["--lq-surface"];
  legacy["--lq-elevated"] = vars["--lq-surface-raised"];

  return { vars, legacy, custom: [...PALETTE_KEYS], scheme: bg ? (dark ? "dark" : "light") : null };
}

/** The scheme the page shows: a brand background's (R25), else the theme's. */
export function effectiveScheme(theme: ThemeId, brand: Record<string, string> | null | undefined): ColorMode {
  return resolveTheme(brand).scheme ?? THEME_SCHEME[theme];
}

// ---------- appearance ----------

const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEMES as readonly string[]).includes(v);
const isColorToken = (v: unknown): v is ColorToken => typeof v === "string" && (COLOR_TOKENS as readonly string[]).includes(v);

/** interim: removed in Task 6 with styles.css. Old variable names only the legacy stylesheet reads. */
const LEGACY_ONLY = ["--lq-background", "--lq-muted", "--lq-radius", "--lq-font", "--lq-on-accent", "--lq-elevated"];

/** Every inline property applyAppearance owns; each call clears the ones it no longer sets. */
const MANAGED = [...COLOR_TOKENS.map((t) => `--lq-${t}`), ...Object.keys(RADIUS_SCALE), "--lq-font-body", ...LEGACY_ONLY];

export interface Appearance {
  theme: ThemeId;
  density?: Density;
  text?: TextSize;
  /** The user's accent pref; ignored unless it parses as a color. */
  accent?: string;
}

/**
 * Apply the appearance to `el` (default <html>):
 * 1. root attributes data-lq-theme, data-lq-scheme, data-lq-density and data-lq-text;
 * 2. the legacy brand layer (`config.theme`), see resolveTheme;
 * 3. the user's accent pref;
 * 4. `lock_tokens` last, as !important inline properties: a locked token (and the tokens
 *    derived from it) keeps the brand value, or the theme's when the brand doesn't set it.
 * It also starts loading the theme's fonts (memoised, so repeat calls are free).
 */
export function applyAppearance(
  a: Appearance,
  brand: Record<string, string> | null,
  el: HTMLElement = document.documentElement,
  lock: readonly string[] = [],
): void {
  const theme = isThemeId(a.theme) ? a.theme : "graphite";
  const resolved = resolveTheme(brand, THEME_SCHEME[theme]);

  el.setAttribute("data-lq-theme", theme);
  el.setAttribute("data-lq-scheme", resolved.scheme ?? THEME_SCHEME[theme]);
  el.setAttribute("data-lq-density", a.density === "compact" ? "compact" : "comfortable");
  el.setAttribute("data-lq-text", a.text === "s" || a.text === "l" ? a.text : "m");
  if (resolved.custom.length) el.setAttribute(CUSTOM_ATTR, resolved.custom.join(" "));
  else el.removeAttribute(CUSTOM_ATTR);

  const out: Record<string, string> = { ...resolved.vars };
  const userAccent = a.accent?.trim();
  if (userAccent && resolveColor(userAccent)) Object.assign(out, accentFamily(userAccent));

  const locked = new Set<string>();
  for (const token of lock) {
    if (!isColorToken(token)) continue;
    for (const t of [token, ...(LOCK_DERIVED[token] ?? [])]) {
      const name = `--lq-${t}`;
      locked.add(name);
      out[name] = resolved.vars[name] ?? THEME_TOKENS[theme][t];
    }
  }

  // interim: removed in Task 6 with styles.css. The legacy stylesheet reads the old names.
  for (const name of LEGACY_ONLY) {
    const v = resolved.legacy[name];
    if (v) out[name] = v;
  }
  if (out["--lq-accent-text"]) out["--lq-on-accent"] = out["--lq-accent-text"];

  for (const name of MANAGED) el.style.removeProperty(name);
  for (const [name, v] of Object.entries(out)) el.style.setProperty(name, v, locked.has(name) ? "important" : "");

  loadThemeFonts(theme).catch(() => {
    /* a font that fails to load falls back to the theme's system stack */
  });
}

// ---------- theme selection ----------

export interface ThemeConfig {
  default_theme?: ThemePref | string;
  themes?: readonly (ThemeId | string)[];
}

/** The allowed themes, in configured order; all four when the list is missing or holds no known id. */
export function allowedThemes(themes: ThemeConfig["themes"]): ThemeId[] {
  const known = (themes ?? []).filter(isThemeId);
  return known.length ? [...new Set(known)] : [...THEMES];
}

/** "system": the light/dark pair among the allowed themes (graphite/midnight by default). */
function systemTheme(allowed: readonly ThemeId[], dark: boolean): ThemeId {
  const pick = (scheme: ColorMode, preferred: ThemeId) => {
    const of = allowed.filter((t) => THEME_SCHEME[t] === scheme);
    return of.includes(preferred) ? preferred : of[0];
  };
  const light = pick("light", "graphite");
  const darkTheme = pick("dark", "midnight");
  return (dark ? (darkTheme ?? light) : (light ?? darkTheme)) ?? "graphite";
}

/**
 * The effective theme. A pref outside the allowed themes falls back to `default_theme`
 * silently; `system` (as pref or default) follows the OS scheme within the allowed themes.
 */
export function resolveThemeId(pref: ThemePref | undefined, cfg: ThemeConfig, systemDark: boolean): ThemeId {
  const allowed = allowedThemes(cfg.themes);
  const pick = (v: unknown) => (isThemeId(v) && allowed.includes(v) ? v : null);
  if (pref === "system") return systemTheme(allowed, systemDark);
  return pick(pref) ?? pick(cfg.default_theme) ?? systemTheme(allowed, systemDark);
}

// ---------- system scheme ----------

function darkQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

export function systemDark(): boolean {
  return !!darkQuery()?.matches;
}

/** The OS dark-mode preference, tracked live. */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState<boolean>(systemDark);
  useEffect(() => {
    const q = darkQuery();
    if (!q || typeof q.addEventListener !== "function") return;
    const onChange = () => setDark(q.matches);
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, []);
  return dark;
}
