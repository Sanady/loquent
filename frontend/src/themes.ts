/**
 * The four built-in themes and their color tokens.
 *
 * THEME_TOKENS is the single source for every theme color. The CSS in styles/themes/*.css
 * restates these values (CSS cannot import TS); themes.test.ts fails if the two drift and
 * checks WCAG AA for each theme. Values are lowercase hex: #rrggbb, or #rrggbbaa for the
 * translucent roles (accent-soft, scrim), which are never used in contrast pairs.
 */

export const THEMES = ["graphite", "graphite-dark", "editorial", "midnight"] as const;
export type ThemeId = (typeof THEMES)[number];

export const THEME_SCHEME: Record<ThemeId, "light" | "dark"> = {
  graphite: "light",
  "graphite-dark": "dark",
  editorial: "light",
  midnight: "dark",
};

/** Color roles; each is the `--lq-<name>` custom property a theme sets. */
export const COLOR_TOKENS = [
  "bg",
  "bg-subtle",
  "surface",
  "surface-raised",
  "border",
  "border-strong",
  "text",
  "text-muted",
  // Non-essential text only (timestamps, hints): held to 3:1, never body copy.
  "text-subtle",
  "accent",
  "accent-hover",
  "accent-text",
  "accent-soft",
  "user-bubble",
  "user-bubble-text",
  "code-bg",
  "focus-ring",
  "success",
  "warning",
  "danger",
  "scrim",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

export const THEME_TOKENS: Record<ThemeId, Record<ColorToken, string>> = {
  // Precise, warm-neutral greys; one indigo accent.
  graphite: {
    bg: "#fbfbfa",
    "bg-subtle": "#f4f4f2",
    surface: "#ffffff",
    "surface-raised": "#ffffff",
    border: "#e7e6e3",
    "border-strong": "#8a867f",
    text: "#18181b",
    "text-muted": "#5c5a55",
    "text-subtle": "#85827b",
    accent: "#4f46e5",
    "accent-hover": "#4338ca",
    "accent-text": "#ffffff",
    "accent-soft": "#4f46e51a",
    "user-bubble": "#f0efec",
    "user-bubble-text": "#18181b",
    "code-bg": "#f5f5f3",
    "focus-ring": "#4f46e5",
    success: "#15803d",
    warning: "#b45309",
    danger: "#c62828",
    scrim: "#18181b52",
  },
  // Neutral dark twin; surfaces step up from bg, indigo lightened so dark text sits on it.
  "graphite-dark": {
    bg: "#111113",
    "bg-subtle": "#0d0d0f",
    surface: "#18181a",
    "surface-raised": "#1f1f22",
    border: "#28282b",
    "border-strong": "#67666b",
    text: "#ededeb",
    "text-muted": "#a3a19c",
    "text-subtle": "#77756f",
    accent: "#818cf8",
    "accent-hover": "#a5b4fc",
    "accent-text": "#111113",
    "accent-soft": "#818cf824",
    "user-bubble": "#232326",
    "user-bubble-text": "#ededeb",
    "code-bg": "#0d0d0f",
    "focus-ring": "#818cf8",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",
    scrim: "#000000a6",
  },
  // Warm paper all the way through; ink black with a terracotta accent.
  editorial: {
    bg: "#faf7f2",
    "bg-subtle": "#f3eee5",
    surface: "#fffdf9",
    "surface-raised": "#fffefb",
    border: "#e6dfd2",
    "border-strong": "#918675",
    text: "#1f1b16",
    "text-muted": "#6b6155",
    "text-subtle": "#8f8474",
    accent: "#c2410c",
    "accent-hover": "#9a3412",
    "accent-text": "#fffaf5",
    "accent-soft": "#c2410c1a",
    "user-bubble": "#efe8dc",
    "user-bubble-text": "#1f1b16",
    "code-bg": "#f4efe6",
    "focus-ring": "#c2410c",
    success: "#3f6212",
    warning: "#a16207",
    danger: "#b91c1c",
    scrim: "#1f1b1652",
  },
  // Deep navy; surfaces step up in small lightness increments; electric-teal accent.
  midnight: {
    bg: "#0b1020",
    "bg-subtle": "#0e1428",
    surface: "#121a33",
    "surface-raised": "#17213d",
    border: "#1c2440",
    "border-strong": "#5a6792",
    text: "#e6e9f2",
    "text-muted": "#9aa3bd",
    "text-subtle": "#6e7896",
    accent: "#22d3ee",
    "accent-hover": "#67e8f9",
    "accent-text": "#04121a",
    "accent-soft": "#22d3ee1f",
    "user-bubble": "#172039",
    "user-bubble-text": "#e6e9f2",
    "code-bg": "#080c19",
    "focus-ring": "#22d3ee",
    success: "#34d399",
    warning: "#fbbf24",
    danger: "#fb7185",
    scrim: "#02040ab3",
  },
};
