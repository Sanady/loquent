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

/** The brand palette keys: with `background` set, all four are brand-fixed in every theme (R25). */
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

/** The browser's computed form of a color it understands (named colors, hsl(), ...), or null. */
function computedColor(input: string): string | null {
  if (typeof document === "undefined" || !document.body) return null;
  try {
    const probe = document.createElement("span");
    probe.style.color = input;
    if (!probe.style.color) return null;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  } catch {
    return null;
  }
}

/** Fall back to the browser's own parser (named colors, hsl(), ...) when available. */
function resolveColor(input: string): Rgb | null {
  const direct = parseColor(input);
  if (direct) return direct;
  const computed = computedColor(input);
  return computed ? parseColor(computed) : null;
}

/** Alpha of a hex or rgb()/rgba() color string (1 when it has none); `transparent` is 0. */
function alphaOf(input: string): number {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return 0;
  let m = /^#(?:[0-9a-f]{3}([0-9a-f])|[0-9a-f]{6}([0-9a-f]{2}))$/.exec(s);
  if (m) return m[1] ? parseInt(m[1] + m[1], 16) / 255 : parseInt(m[2], 16) / 255;
  m = /^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+\s*[,/]\s*([\d.]+)(%?)\s*\)$/.exec(s);
  if (m) return m[2] ? Number(m[1]) / 100 : Number(m[1]);
  return 1;
}

/** An opaque color, or null when it is translucent or can't be parsed (contrast is then unknowable). */
function resolveOpaque(input: string): Rgb | null {
  const str = parseColor(input) ? input : computedColor(input);
  return str && alphaOf(str) >= 1 ? parseColor(str) : null;
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

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function mixRgb(a: Rgb, b: Rgb, weightA: number): Rgb {
  return a.map((v, i) => Math.round(v * weightA + b[i] * (1 - weightA))) as Rgb;
}

const toHex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function mix(a: Rgb, b: Rgb, weightA: number): string {
  return toHex(mixRgb(a, b, weightA));
}

const minContrast = (fg: Rgb, against: readonly Rgb[]) => Math.min(...against.map((b) => contrast(fg, b)));

/** Pure black or white, whichever has the higher minimum contrast on `against`. */
const bestInk = (against: readonly Rgb[]): Rgb => (minContrast(BLACK, against) >= minContrast(WHITE, against) ? BLACK : WHITE);

/**
 * `start`, or the first step from it toward the max-contrast ink (black or white, whichever
 * contrasts more with `against`) that meets `floor` on every color in `against`. Mid-tone
 * backgrounds need this: a fixed near-black or off-white ink can miss AA on them.
 */
function withFloor(start: Rgb, against: readonly Rgb[], floor: number): Rgb {
  if (minContrast(start, against) >= floor) return start;
  const ink = bestInk(against);
  for (let step = 1; step <= 20; step++) {
    const c = mixRgb(ink, start, step / 20);
    if (minContrast(c, against) >= floor) return c;
  }
  return ink;
}

/** Each theme warning is logged once per page: resolveTheme runs on every render. */
const warned = new Set<string>();
function warnOnce(id: string, message: string) {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(message);
}

/** Brand colors below their floor are kept (an explicit choice) but reported once each. */
function warnBelowFloor(key: string, value: string, background: string, ratio: number, floor: number) {
  warnOnce(
    `${key}|${value}|${background}`,
    `loquent theme: "${key}" ${value} has ${ratio.toFixed(2)}:1 contrast on background ${background} or its surfaces, below ${floor}:1; kept as configured.`,
  );
}

// ---------- theme resolution (the legacy brand layer) ----------

export interface ResolvedTheme {
  /** Theme tokens (`--lq-<token>`) the brand sets for the requested scheme. */
  vars: Record<string, string>;
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
  const val = (k: string) => {
    const v = theme?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const radius = val("radius");
  if (radius) for (const [name, f] of Object.entries(RADIUS_SCALE)) vars[name] = f === 1 ? radius : `calc(${radius} * ${f})`;
  const font = val("font");
  if (font) vars["--lq-font-body"] = font;
  const accent = val("accent");
  if (accent) Object.assign(vars, accentFamily(accent));

  const background = val("background");
  if (!background) {
    const palette = { "--lq-surface": val("surface"), "--lq-text": val("text"), "--lq-text-muted": val("muted") };
    if (themeScheme === "light") for (const [name, v] of Object.entries(palette)) if (v) vars[name] = v;
    return { vars, custom: [], scheme: null };
  }

  const bg = resolveColor(background);
  const dark = bg ? isDark(bg) : false;
  // Contrast floors need an opaque background; a translucent or unparsable one is reported.
  const floorBg = resolveOpaque(background);
  if (!floorBg) {
    warnOnce(
      `background|${background}`,
      `loquent theme: brand background could not be checked for contrast (${background}); derived text colors are not adjusted.`,
    );
  }

  const given = { text: val("text"), muted: val("muted") };
  const fallback = { text: dark ? DARK_INK : LIGHT_INK, muted: dark ? DARK_MUTED : LIGHT_MUTED };
  // First pass: the derived text floored on bg alone. The surfaces are tinted from it.
  const firstText = given.text ?? (floorBg ? toHex(withFloor(resolveColor(fallback.text)!, [floorBg], 4.5)) : fallback.text);
  const firstTextRgb = resolveColor(firstText);

  // Surfaces are a tint of the text over the background. On a mid-tone, the best ink may
  // miss 4.5:1 on a surface tinted toward it; that surface is tinted the other way instead.
  const surfaceVal = val("surface");
  const surfaceWeight = dark ? 0.07 : 0.045;
  let surface: Rgb | null;
  if (surfaceVal) {
    vars["--lq-surface"] = surfaceVal;
    surface = resolveColor(surfaceVal);
  } else if (bg && firstTextRgb) {
    surface = mixRgb(firstTextRgb, bg, surfaceWeight);
    if (floorBg) {
      const ink = bestInk([floorBg]);
      if (contrast(ink, surface) < 4.5) surface = mixRgb(ink === BLACK ? WHITE : BLACK, bg, surfaceWeight);
    }
    vars["--lq-surface"] = toHex(surface);
  } else {
    vars["--lq-surface"] = `color-mix(in srgb, var(--lq-text) ${Math.round(surfaceWeight * 100)}%, var(--lq-bg))`;
    surface = null;
  }
  const raised = bg && surface ? mixRgb(surface, bg, 0.35) : null;
  vars["--lq-surface-raised"] = raised ? toHex(raised) : "color-mix(in srgb, var(--lq-surface) 35%, var(--lq-bg))";

  // Text roles meet 4.5:1 on bg, surface and surface-raised. A derived value steps toward the
  // max-contrast ink until all pass; a brand value is kept as set (with one warning).
  const targets = floorBg ? [floorBg, surface, raised].filter((c): c is Rgb => c !== null) : [];
  const textRole = (key: "text" | "muted", start: string): string => {
    const v = given[key];
    if (v) {
      const rgb = resolveColor(v);
      const ratio = rgb && targets.length ? minContrast(rgb, targets) : Infinity;
      if (ratio < 4.5) warnBelowFloor(key, v, background, ratio, 4.5);
      return v;
    }
    const rgb = resolveColor(start);
    if (!rgb || !targets.length) return start;
    const out = withFloor(rgb, targets, 4.5);
    return out === rgb ? start : toHex(out);
  };
  const text = textRole("text", firstText);
  const muted = textRole("muted", fallback.muted);
  const textRgb = resolveColor(text);
  const mutedRgb = resolveColor(muted);
  vars["--lq-bg"] = background;
  vars["--lq-text"] = text;
  vars["--lq-text-muted"] = muted;

  // A tint of the text color over the background: hex when both parse, color-mix otherwise.
  const tint = (weight: number) =>
    bg && textRgb ? mix(textRgb, bg, weight) : `color-mix(in srgb, var(--lq-text) ${Math.round(weight * 100)}%, var(--lq-bg))`;
  vars["--lq-bg-subtle"] = tint(dark ? 0.04 : 0.025);
  vars["--lq-border"] = tint(dark ? 0.16 : 0.11);
  vars["--lq-border-strong"] = tint(0.45);
  vars["--lq-user-bubble"] = tint(dark ? 0.1 : 0.06);
  vars["--lq-code-bg"] = tint(dark ? 0.05 : 0.035);

  // user-bubble-text: the text color, stepped to 4.5:1 on the bubble when it falls short.
  const bubble = floorBg ? resolveColor(vars["--lq-user-bubble"]) : null;
  const bubbleText = textRgb && bubble ? withFloor(textRgb, [bubble], 4.5) : null;
  vars["--lq-user-bubble-text"] = bubbleText && bubbleText !== textRgb ? toHex(bubbleText) : text;

  // text-subtle is for non-essential text only (timestamps, hints): held to 3:1 on bg and
  // surface, the same rule as the built-in themes, never to body-copy AA.
  const subtleTargets = floorBg ? (surface ? [floorBg, surface] : [floorBg]) : [];
  vars["--lq-text-subtle"] =
    bg && mutedRgb
      ? toHex(subtleTargets.length ? withFloor(mixRgb(mutedRgb, bg, 0.8), subtleTargets, 3) : mixRgb(mutedRgb, bg, 0.8))
      : "color-mix(in srgb, var(--lq-text-muted) 80%, var(--lq-bg))";

  return { vars, custom: [...PALETTE_KEYS], scheme: bg ? (dark ? "dark" : "light") : null };
}

// ---------- appearance ----------

const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEMES as readonly string[]).includes(v);
const isColorToken = (v: unknown): v is ColorToken => typeof v === "string" && (COLOR_TOKENS as readonly string[]).includes(v);

/** Every inline property applyAppearance owns; each call clears the ones it no longer sets. */
const MANAGED = [...COLOR_TOKENS.map((t) => `--lq-${t}`), ...Object.keys(RADIUS_SCALE), "--lq-font-body"];

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

/**
 * The `?theme=<id>` preview param (a preview and screenshot aid): the id when it is one of
 * the `allowed` themes, otherwise null. It is never stored; reloading without it drops it.
 */
export function previewTheme(search: string, allowed: readonly ThemeId[]): ThemeId | null {
  const id = new URLSearchParams(search).get("theme");
  return isThemeId(id) && allowed.includes(id) ? id : null;
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
