import { useEffect, useState } from "react";
import { loadThemeFonts } from "./fonts";
import { COLOR_TOKENS, THEME_SCHEME, THEME_SYNTAX, THEME_TOKENS, THEMES, type ColorToken, type ThemeId } from "./themes";

/**
 * Legacy `config.theme` keys: the developer brand layer. It is written into the `lq.brand`
 * cascade layer, above the active theme and below user prefs, unlayered developer CSS and
 * user CSS. Mapping onto the theme tokens (`--lq-<token>`):
 *   accent      -> accent, plus derived accent-hover, accent-soft, accent-text, focus-ring (every theme)
 *   background  -> bg          surface -> surface    text -> text    muted -> text-muted
 *   radius      -> radius-sm/md/lg/xl (lg is the configured value)
 *   font        -> font-body and font-display
 * With `background` set, the brand owns the palette in every theme (R25): the remaining
 * surfaces (bg-subtle, surface-raised, border, border-strong, user-bubble, user-bubble-text,
 * code-bg, text-subtle) are derived from it, and so are the roles a theme of the other scheme
 * would get wrong: the accent family (from the theme accent when the brand sets none),
 * focus-ring and success/warning/danger, each floored for contrast on the brand surfaces.
 * Without `background`, the color keys other than accent apply to light themes only.
 */
export const THEME_KEYS = ["accent", "background", "surface", "text", "muted", "radius", "font"] as const;

/** The brand palette keys: with `background` set, all four are brand-fixed in every theme (R25). */
export const PALETTE_KEYS = ["background", "surface", "text", "muted"] as const;

/** Attribute on <html> listing the palette keys that are brand-fixed (R25). */
export const CUSTOM_ATTR = "data-lq-custom-colors";

/**
 * Internal attribute on <html>: "mono" when the theme's syntax palette misses 4.5:1 on a brand
 * code-bg, so code blocks fall back to text and muted (components/code.css). Not part of the
 * styling contract.
 */
export const SYNTAX_ATTR = "data-lqi-syntax";

/** Locking a token also locks the tokens derived from it. */
export const LOCK_DERIVED: Partial<Record<ColorToken, readonly ColorToken[]>> = {
  accent: ["accent-hover", "accent-soft", "accent-text", "focus-ring"],
};

/**
 * The cascade layer order (styles/layers.css states the same). Earliest is weakest for normal
 * declarations and strongest for !important ones, which is why lq.lock comes first. lq.prefs is
 * reserved for user prefs (Phase 2). Unlayered CSS beats every layer's normal declarations.
 */
export const LAYER_ORDER = "@layer lq.lock, lq.reset, lq.base, lq.components, lq.themes, lq.brand, lq.prefs, lq.utilities;";

/** Ids of the managed <style> elements applyAppearance writes into <head>. */
export const BRAND_SHEET_ID = "lq-brand";
export const LOCK_SHEET_ID = "lq-lock";

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
  /** Theme tokens (`--lq-<token>`) the brand sets for the requested theme. */
  vars: Record<string, string>;
  /** Palette keys that are brand-fixed in every theme. */
  custom: string[];
  /** The scheme a brand palette implies (from its background), or null when the theme's applies. */
  scheme: ColorMode | null;
  /** True when the theme's syntax palette misses 4.5:1 on the brand code-bg (code goes monochrome). */
  monoCode: boolean;
  /** The opaque surfaces accent-derived roles are floored on (bg, surface, surface-raised). */
  floorOn: Rgb[];
}

/** Radius scale from the one legacy `radius` value: lg is the configured radius. */
const RADIUS_SCALE: Record<string, number> = { "--lq-radius-sm": 0.5, "--lq-radius-md": 0.67, "--lq-radius-lg": 1, "--lq-radius-xl": 1.33 };

/** Text color for accent fills: near-black or white, whichever contrasts more, stepped to 4.5:1. */
function onAccent(rgb: Rgb): string {
  const start = parseColor(contrast(rgb, [17, 17, 17]) >= contrast(rgb, [255, 255, 255]) ? ON_LIGHT : ON_DARK)!;
  return toHex(withFloor(start, [rgb], 4.5));
}

/**
 * The accent and the tokens derived from it. accent-text is omitted when the color can't be
 * parsed. focus-ring follows the accent, stepped to 3:1 on `floorOn` (the bg and surfaces it
 * is drawn against) when the accent itself falls short.
 */
function accentFamily(accent: string, floorOn: readonly Rgb[]): Record<string, string> {
  const vars: Record<string, string> = {
    "--lq-accent": accent,
    "--lq-accent-hover": `color-mix(in srgb, ${accent} 85%, var(--lq-text))`,
    "--lq-accent-soft": `color-mix(in srgb, ${accent} 14%, transparent)`,
    "--lq-focus-ring": accent,
  };
  const rgb = resolveColor(accent);
  if (rgb) {
    vars["--lq-accent-text"] = onAccent(rgb);
    if (floorOn.length) {
      const ring = withFloor(rgb, floorOn, 3);
      if (ring !== rgb) vars["--lq-focus-ring"] = toHex(ring);
    }
  }
  return vars;
}

/** The scheme a brand background implies, or null without a (parseable) background. */
export function brandScheme(brand: Record<string, string> | null | undefined): ColorMode | null {
  const v = brand?.background;
  const bg = typeof v === "string" && v.trim() ? resolveColor(v.trim()) : null;
  return bg ? (isDark(bg) ? "dark" : "light") : null;
}

/** The scheme reference themes' shadow tokens (kept equal to styles/themes/*.css by a test). */
export const REFERENCE_SHADOWS = {
  graphite: {
    "--lq-shadow-1": "0 1px 1px rgb(41 37 30 / 0.03), 0 1px 2px rgb(41 37 30 / 0.04)",
    "--lq-shadow-2": "0 1px 2px rgb(41 37 30 / 0.04), 0 4px 10px -2px rgb(41 37 30 / 0.06), 0 10px 20px -8px rgb(41 37 30 / 0.06)",
    "--lq-shadow-3": "0 2px 4px rgb(41 37 30 / 0.04), 0 12px 24px -6px rgb(41 37 30 / 0.08), 0 28px 56px -16px rgb(41 37 30 / 0.12)",
  },
  "graphite-dark": {
    "--lq-shadow-1": "inset 0 1px 0 rgb(255 255 255 / 0.03), 0 1px 2px rgb(4 4 6 / 0.4)",
    "--lq-shadow-2": "inset 0 1px 0 rgb(255 255 255 / 0.04), 0 1px 2px rgb(4 4 6 / 0.35), 0 8px 20px -6px rgb(4 4 6 / 0.5)",
    "--lq-shadow-3": "inset 0 1px 0 rgb(255 255 255 / 0.05), 0 2px 4px rgb(4 4 6 / 0.35), 0 20px 48px -12px rgb(4 4 6 / 0.65)",
  },
} as const;

/**
 * Turn `config.theme` into theme tokens for the given theme.
 *
 * - Every known key maps onto its token(s); unknown keys are ignored.
 * - accent-text (text on accent fills) is picked by contrast against the accent, and
 *   focus-ring follows the accent (floored to 3:1 on bg and surfaces).
 * - When `background` is set, the developer owns the palette (R25): missing surface/text/muted
 *   are derived from it so the result is readable, the other surfaces are derived from the
 *   configured colors, and all four palette keys are marked custom. The palette then applies
 *   in every theme, so the roles the theme would otherwise supply for its own scheme are
 *   derived too (Q14): the accent family (from the theme's accent when the brand sets none),
 *   focus-ring, and success/warning/danger from a scheme-matched reference palette. Without
 *   `background`, the palette keys are light-theme tweaks: for a dark theme they are left out
 *   and the theme's own colors apply.
 */
export function resolveTheme(theme: Record<string, string> | null | undefined, themeId: ThemeId = "graphite"): ResolvedTheme {
  const id: ThemeId = isThemeId(themeId) ? themeId : "graphite";
  const own = THEME_TOKENS[id];
  const vars: Record<string, string> = {};
  const val = (k: string) => {
    const v = theme?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const radius = val("radius");
  if (radius) for (const [name, f] of Object.entries(RADIUS_SCALE)) vars[name] = f === 1 ? radius : `calc(${radius} * ${f})`;
  const font = val("font");
  if (font) {
    vars["--lq-font-body"] = font;
    vars["--lq-font-display"] = font;
  }
  const accent = val("accent");

  const background = val("background");
  if (!background) {
    const palette = { "--lq-surface": val("surface"), "--lq-text": val("text"), "--lq-text-muted": val("muted") };
    if (THEME_SCHEME[id] === "light") for (const [name, v] of Object.entries(palette)) if (v) vars[name] = v;
    const surface = (vars["--lq-surface"] && resolveOpaque(vars["--lq-surface"])) || parseColor(own.surface)!;
    const floorOn = [parseColor(own.bg)!, surface, parseColor(own["surface-raised"])!];
    if (accent) Object.assign(vars, accentFamily(accent, floorOn));
    return { vars, custom: [], scheme: null, monoCode: false, floorOn };
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

  // Surfaces are a tint of the text over the background. On a mid-tone, the best ink may miss
  // 4.5:1 on a surface tinted toward it; that surface is tinted the other way instead.
  const ink = floorBg ? bestInk([floorBg]) : null;
  const tintSurface = (weight: number): Rgb | null => {
    if (!bg || !firstTextRgb) return null;
    const toward = mixRgb(firstTextRgb, bg, weight);
    if (!ink || contrast(ink, toward) >= 4.5) return toward;
    return mixRgb(ink === BLACK ? WHITE : BLACK, bg, weight);
  };
  const mixVar = (weight: number, a = "var(--lq-text)") => `color-mix(in srgb, ${a} ${Math.round(weight * 100)}%, var(--lq-bg))`;

  const surfaceVal = val("surface");
  const surfaceWeight = dark ? 0.07 : 0.045;
  let surface: Rgb | null;
  if (surfaceVal) {
    vars["--lq-surface"] = surfaceVal;
    surface = resolveColor(surfaceVal);
  } else {
    surface = tintSurface(surfaceWeight);
    vars["--lq-surface"] = surface ? toHex(surface) : mixVar(surfaceWeight);
  }
  const raised = bg && surface ? mixRgb(surface, bg, 0.35) : null;
  vars["--lq-surface-raised"] = raised ? toHex(raised) : "color-mix(in srgb, var(--lq-surface) 35%, var(--lq-bg))";

  // The quiet fills text also sits on (sidebar, code), tinted the same way as surface.
  const subtleWeight = dark ? 0.04 : 0.025;
  const codeWeight = dark ? 0.05 : 0.035;
  const bgSubtle = tintSurface(subtleWeight);
  const codeBg = tintSurface(codeWeight);
  vars["--lq-bg-subtle"] = bgSubtle ? toHex(bgSubtle) : mixVar(subtleWeight);
  vars["--lq-code-bg"] = codeBg ? toHex(codeBg) : mixVar(codeWeight);

  // Text roles meet 4.5:1 on bg, the surfaces and the quiet fills. A derived value steps toward
  // the max-contrast ink until all pass; a brand value is kept as set (with one warning).
  const targets = floorBg ? [floorBg, surface, raised, bgSubtle, codeBg].filter((c): c is Rgb => c !== null) : [];
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
  const tint = (weight: number) => (bg && textRgb ? mix(textRgb, bg, weight) : mixVar(weight));
  vars["--lq-border"] = tint(dark ? 0.16 : 0.11);
  vars["--lq-border-strong"] = tint(0.45);
  vars["--lq-user-bubble"] = tint(dark ? 0.1 : 0.06);

  // user-bubble-text: the text color, stepped to 4.5:1 on the bubble when it falls short.
  const bubble = floorBg ? resolveColor(vars["--lq-user-bubble"]) : null;
  const bubbleText = textRgb && bubble ? withFloor(textRgb, [bubble], 4.5) : null;
  vars["--lq-user-bubble-text"] = bubbleText && bubbleText !== textRgb ? toHex(bubbleText) : text;

  // text-subtle is for non-text decoration only (chevrons, icons): held to 3:1 on bg and
  // surface, the same rule as the built-in themes, never to body-copy AA.
  const subtleTargets = floorBg ? (surface ? [floorBg, surface] : [floorBg]) : [];
  vars["--lq-text-subtle"] =
    bg && mutedRgb
      ? toHex(subtleTargets.length ? withFloor(mixRgb(mutedRgb, bg, 0.8), subtleTargets, 3) : mixRgb(mutedRgb, bg, 0.8))
      : "color-mix(in srgb, var(--lq-text-muted) 80%, var(--lq-bg))";

  // Roles the theme would supply for its own scheme (Q14): the accent family, focus-ring and
  // status colors, made for these surfaces. A brand accent is kept as set; without one the
  // theme accent is stepped to 4.5:1 (it is also link text). Status colors start from the
  // scheme-matched reference theme and are stepped to 4.5:1 on bg and the surfaces.
  const floorOn = floorBg ? [floorBg, surface, raised].filter((c): c is Rgb => c !== null) : [];
  const ownAccent = parseColor(own.accent)!;
  const accentValue = accent ?? (floorOn.length ? toHex(withFloor(ownAccent, floorOn, 4.5)) : own.accent);
  Object.assign(vars, accentFamily(accentValue, floorOn));
  const reference = THEME_TOKENS[dark ? "graphite-dark" : "graphite"];
  for (const role of ["success", "warning", "danger"] as const) {
    const start = parseColor(reference[role])!;
    vars[`--lq-${role}`] = floorOn.length ? toHex(withFloor(start, floorOn, 4.5)) : reference[role];
  }

  // A brand scheme opposite to the theme's own would keep that theme's shadows (midnight's
  // heavy dark ones under a white brand): take them from the scheme-matched reference too.
  if (bg && dark !== (THEME_SCHEME[id] === "dark")) Object.assign(vars, REFERENCE_SHADOWS[dark ? "graphite-dark" : "graphite"]);

  // Code keeps the theme's syntax colors only while each holds 4.5:1 on the brand code-bg.
  const monoCode = !codeBg || Object.values(THEME_SYNTAX[id]).some((c) => contrast(parseColor(c)!, codeBg) < 4.5);

  return { vars, custom: [...PALETTE_KEYS], scheme: bg ? (dark ? "dark" : "light") : null, monoCode, floorOn };
}

// ---------- appearance ----------

const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEMES as readonly string[]).includes(v);
const isColorToken = (v: unknown): v is ColorToken => typeof v === "string" && (COLOR_TOKENS as readonly string[]).includes(v);

export interface Appearance {
  theme: ThemeId;
  density?: Density;
  text?: TextSize;
  /** The user's accent pref; ignored unless it parses as a color. */
  accent?: string;
}

/** True when every `()[]` and quote pair in `value` is closed (a quoted string hides its contents). */
function balanced(value: string): boolean {
  const stack: string[] = [];
  const close: Record<string, string> = { "(": ")", "[": "]" };
  let quote = "";
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch in close) stack.push(close[ch]);
    else if (ch === ")" || ch === "]") {
      if (stack.pop() !== ch) return false;
    }
  }
  return !quote && stack.length === 0;
}

/** True when a `!` sits outside quotes and brackets' strings (a quoted "!" is plain text). */
function hasBang(value: string): boolean {
  let quote = "";
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "!") return true;
  }
  return false;
}

/** A value that could break out of its declaration is dropped (and reported once). */
function safeValue(name: string, value: string): boolean {
  const ok =
    !/[;{}<>`\\]|\/\*/.test(value) &&
    !hasBang(value) &&
    balanced(value) &&
    (typeof CSS === "undefined" || typeof CSS.supports !== "function" || CSS.supports("--x", value));
  if (ok) return true;
  warnOnce(`unsafe|${name}|${value}`, `loquent theme: ignored ${name} value ${JSON.stringify(value)} (not a single CSS value).`);
  return false;
}

/** Write (or remove, when `css` is empty) a managed <style id> at the end of <head>. */
function writeSheet(doc: Document, id: string, css: string): void {
  let style = doc.getElementById(id);
  if (!css) {
    style?.remove();
    return;
  }
  if (!(style instanceof HTMLStyleElement)) {
    style?.remove();
    style = doc.createElement("style");
    style.id = id;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

const declarationsOf = (vars: Record<string, string>, important: boolean) =>
  Object.entries(vars)
    .filter(([name, v]) => safeValue(name, v))
    .map(([name, v]) => `    ${name}: ${v}${important ? " !important" : ""};`)
    .join("\n");

/**
 * Apply the appearance to `el` (default <html>):
 * 1. root attributes data-lq-theme, data-lq-scheme, data-lq-density and data-lq-text;
 * 2. the legacy brand layer (`config.theme`, see resolveTheme) and the user's accent pref,
 *    written as `:root` rules into the managed `<style id="lq-brand">` inside
 *    `@layer lq.brand`: above the theme, below unlayered developer and user CSS;
 * 3. `lock_tokens`, written into `<style id="lq-lock">` as `!important` rules for `:root` and
 *    every descendant inside `@layer lq.lock`. Layered !important in the earliest layer beats
 *    all later-layer and unlayered declarations, !important or not, and matching every element
 *    stops a descendant rule from re-setting the token for its subtree. A locked token (and the
 *    tokens derived from it) keeps the brand value, or the theme's when the brand doesn't set it.
 * It also starts loading the theme's fonts (memoised, so repeat calls are free).
 */
export function applyAppearance(
  a: Appearance,
  brand: Record<string, string> | null,
  el: HTMLElement = document.documentElement,
  lock: readonly string[] = [],
): void {
  const theme = isThemeId(a.theme) ? a.theme : "graphite";
  const resolved = resolveTheme(brand, theme);

  el.setAttribute("data-lq-theme", theme);
  el.setAttribute("data-lq-scheme", resolved.scheme ?? THEME_SCHEME[theme]);
  el.setAttribute("data-lq-density", a.density === "compact" ? "compact" : "comfortable");
  el.setAttribute("data-lq-text", a.text === "s" || a.text === "l" ? a.text : "m");
  if (resolved.custom.length) el.setAttribute(CUSTOM_ATTR, resolved.custom.join(" "));
  else el.removeAttribute(CUSTOM_ATTR);
  if (resolved.monoCode) el.setAttribute(SYNTAX_ATTR, "mono");
  else el.removeAttribute(SYNTAX_ATTR);

  const out: Record<string, string> = { ...resolved.vars };
  const userAccent = a.accent?.trim();
  if (userAccent && resolveColor(userAccent)) Object.assign(out, accentFamily(userAccent, resolved.floorOn));

  const locked: Record<string, string> = {};
  for (const token of lock) {
    if (!isColorToken(token)) continue;
    for (const t of [token, ...(LOCK_DERIVED[token] ?? [])]) {
      const name = `--lq-${t}`;
      locked[name] = resolved.vars[name] ?? THEME_TOKENS[theme][t];
    }
  }

  const doc = el.ownerDocument;
  const brandCss = declarationsOf(out, false);
  const lockCss = declarationsOf(locked, true);
  writeSheet(doc, BRAND_SHEET_ID, brandCss && `${LAYER_ORDER}\n@layer lq.brand {\n  :root {\n${brandCss}\n  }\n}\n`);
  writeSheet(doc, LOCK_SHEET_ID, lockCss && `${LAYER_ORDER}\n@layer lq.lock {\n  :root,\n  :root * {\n${lockCss}\n  }\n}\n`);

  loadThemeFonts(theme).catch(() => {
    /* a font that fails to load falls back to the theme's system stack */
  });
}

// ---------- theme selection ----------

export interface ThemeConfig {
  default_theme?: ThemePref | string;
  themes?: readonly (ThemeId | string)[];
  /** The legacy brand layer (`config.theme`): a brand background fixes what `system` means. */
  brand?: Record<string, string> | null;
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
 * silently; `system` (as pref or default) follows the OS scheme within the allowed themes,
 * or, when the brand sets a background, the brand's scheme (light -> graphite, dark ->
 * midnight by default), as release 1 did.
 */
export function resolveThemeId(pref: ThemePref | undefined, cfg: ThemeConfig, osDark: boolean): ThemeId {
  const fixed = brandScheme(cfg.brand);
  const systemDark = fixed ? fixed === "dark" : osDark;
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

/**
 * Preview > pref > default. An allowed `?theme=` is explicit and non-persistent, so it wins
 * over any stored or session pref; without it the pref (then `default_theme`, then the
 * system scheme) decides, as in resolveThemeId.
 */
export function effectiveThemeId(preview: ThemeId | null, pref: ThemePref | undefined, cfg: ThemeConfig, systemDark: boolean): ThemeId {
  return resolveThemeId(preview ?? pref, cfg, systemDark);
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
