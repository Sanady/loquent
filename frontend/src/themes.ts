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

/** Display names, for the theme picker and accessible labels. */
export const THEME_LABEL: Record<ThemeId, string> = {
  graphite: "Graphite",
  "graphite-dark": "Graphite Dark",
  editorial: "Editorial",
  midnight: "Midnight",
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

/** Syntax roles for code blocks; each is the private `--lqi-syntax-<role>` knob a theme sets. */
export const SYNTAX_ROLES = ["keyword", "string", "number", "title", "type", "meta", "comment"] as const;
export type SyntaxRole = (typeof SYNTAX_ROLES)[number];

/**
 * Each theme's syntax palette, 4.5:1 or better on its own code-bg. The theme CSS restates
 * these (themes.test.ts keeps them in sync). Under a brand background, resolveTheme checks
 * them against the brand's derived code-bg and falls back to monochrome code if one fails.
 */
export const THEME_SYNTAX: Record<ThemeId, Record<SyntaxRole, string>> = {
  graphite: { keyword: "#6d28d9", string: "#166534", number: "#9a4a08", title: "#1d4ed8", type: "#0e7490", meta: "#9d174d", comment: "#6b6862" },
  "graphite-dark": { keyword: "#a5b4fc", string: "#86efac", number: "#fdba74", title: "#d8b4fe", type: "#67e8f9", meta: "#f9a8d4", comment: "#8f8d87" },
  editorial: { keyword: "#9a3412", string: "#3f6212", number: "#854d0e", title: "#1e40af", type: "#0f766e", meta: "#86198f", comment: "#6b6155" },
  midnight: { keyword: "#22d3ee", string: "#6ee7b7", number: "#fcd34d", title: "#93c5fd", type: "#f0abfc", meta: "#fda4af", comment: "#7c87a6" },
};
