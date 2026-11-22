// Generates the colour-palette and styling-contract sections of ../DESIGN.md.
//
//   npm run gen:design          rewrite DESIGN.md in place
//
// Only the text between the `<!-- gen:NAME:start -->` / `<!-- gen:NAME:end -->` markers is
// generated; everything else in DESIGN.md is written by hand. `render(source, data)` is pure,
// and src/design.test.ts uses it to check that DESIGN.md is up to date.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DESIGN_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "DESIGN.md");

/** What each colour token is for. */
const ROLES = {
  bg: "page background",
  "bg-subtle": "sidebar and quiet fills",
  surface: "cards, composer, widgets",
  "surface-raised": "elevated surfaces, menus",
  border: "hairlines and dividers",
  "border-strong": "input outlines, meaningful borders (3:1 or better)",
  text: "body text and headings",
  "text-muted": "secondary text",
  "text-subtle": "timestamps and hints only (3:1, never body copy)",
  accent: "primary actions, links, active state",
  "accent-hover": "accent on hover or press",
  "accent-text": "text on accent fills",
  "accent-soft": "translucent accent wash (selection, focus halo)",
  "user-bubble": "the user's message bubble",
  "user-bubble-text": "text in the user's bubble",
  "code-bg": "code blocks and inline code",
  "focus-ring": "keyboard focus outline",
  success: "completed, approved",
  warning: "caution",
  danger: "errors, destructive actions",
  scrim: "overlay behind the drawer and dialogs",
};

/** Descriptive colour names, per theme and token. A missing name fails generation. */
const NAMES = {
  graphite: {
    bg: "Warm Chalk", "bg-subtle": "Soft Stone", surface: "Clean White", "surface-raised": "Clean White",
    border: "Pale Pebble", "border-strong": "Warm Slate", text: "Near-Black Ink", "text-muted": "Quiet Umber",
    "text-subtle": "Faded Pewter", accent: "Indigo Ink", "accent-hover": "Deep Indigo", "accent-text": "Bright White",
    "accent-soft": "Indigo Mist", "user-bubble": "Pale Oat", "user-bubble-text": "Near-Black Ink", "code-bg": "Light Flint",
    "focus-ring": "Indigo Ink", success: "Forest Green", warning: "Burnt Amber", danger: "Signal Red", scrim: "Smoked Veil",
  },
  "graphite-dark": {
    bg: "Charcoal", "bg-subtle": "Coal", surface: "Graphite Slate", "surface-raised": "Lifted Slate",
    border: "Dark Seam", "border-strong": "Ash Grey", text: "Soft Bone", "text-muted": "Warm Fog",
    "text-subtle": "Dim Smoke", accent: "Lifted Periwinkle", "accent-hover": "Pale Periwinkle", "accent-text": "Charcoal Ink",
    "accent-soft": "Periwinkle Haze", "user-bubble": "Raised Basalt", "user-bubble-text": "Soft Bone", "code-bg": "Coal",
    "focus-ring": "Lifted Periwinkle", success: "Fresh Mint", warning: "Warm Amber", danger: "Coral Red", scrim: "Black Veil",
  },
  editorial: {
    bg: "Warm Paper", "bg-subtle": "Aged Vellum", surface: "Cream Stock", "surface-raised": "Bright Cream",
    border: "Parchment Edge", "border-strong": "Driftwood", text: "Press Ink", "text-muted": "Walnut Brown",
    "text-subtle": "Weathered Tan", accent: "Terracotta", "accent-hover": "Baked Clay", "accent-text": "Paper White",
    "accent-soft": "Terracotta Wash", "user-bubble": "Oat Linen", "user-bubble-text": "Press Ink", "code-bg": "Pale Sand",
    "focus-ring": "Terracotta", success: "Olive Green", warning: "Ochre", danger: "Brick Red", scrim: "Sepia Veil",
  },
  midnight: {
    bg: "Deep Navy", "bg-subtle": "Abyss Blue", surface: "Night Slate", "surface-raised": "Lifted Indigo Slate",
    border: "Dusk Seam", "border-strong": "Steel Lavender", text: "Moonlit White", "text-muted": "Mist Blue",
    "text-subtle": "Distant Haze", accent: "Electric Teal", "accent-hover": "Bright Aqua", "accent-text": "Abyss Ink",
    "accent-soft": "Teal Glow", "user-bubble": "Midnight Indigo", "user-bubble-text": "Moonlit White", "code-bg": "Void Navy",
    "focus-ring": "Electric Teal", success: "Sea Green", warning: "Gold", danger: "Rose", scrim: "Ink Veil",
  },
};

/** The current DESIGN.md text. */
export const readDesign = () => readFileSync(DESIGN_PATH, "utf8");

const mark = (name, edge) => `<!-- gen:${name}:${edge} -->`;

function palette({ THEMES, THEME_LABEL, THEME_SCHEME, COLOR_TOKENS, THEME_TOKENS }) {
  const out = [];
  for (const t of THEMES) {
    out.push(`### ${THEME_LABEL[t]} (\`${t}\`, ${THEME_SCHEME[t]})`, "", "| Token | Name | Hex | Role |", "|---|---|---|---|");
    for (const c of COLOR_TOKENS) {
      const name = NAMES[t]?.[c];
      if (!name) throw new Error(`gen_design_md: no colour name for ${t}/${c}`);
      if (!ROLES[c]) throw new Error(`gen_design_md: no role for ${c}`);
      out.push(`| \`--lq-${c}\` | ${name} | \`${THEME_TOKENS[t][c]}\` | ${ROLES[c]} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

function contract({ STYLE_CONTRACT_VERSION, PART_SELECTOR, PARTS, PART_TARGETS, SCALE_TOKENS, STATES }) {
  const out = [
    `Contract version: **${STYLE_CONTRACT_VERSION}**. Select a part with \`${PART_SELECTOR}\`.`,
    "",
    "#### Parts",
    "",
    "| Part | Lands on |",
    "|---|---|",
    ...PARTS.map((p) => `| \`${p}\` | ${PART_TARGETS[p].replaceAll("|", "\\|")} |`),
    "",
    "#### Scale tokens",
    "",
    SCALE_TOKENS.map((t) => `\`--lq-${t}\``).join(", "),
    "",
    "#### States",
    "",
    STATES.map((s) => `\`${s}\``).join(", "),
    "",
  ];
  return out.join("\n");
}

/** Replace the generated regions of `source`. `data` holds the exports of themes.ts and parts.ts. */
export function render(source, data) {
  const regions = { palette: palette(data), contract: contract(data) };
  let text = source;
  for (const [name, body] of Object.entries(regions)) {
    const start = mark(name, "start");
    const end = mark(name, "end");
    const a = text.indexOf(start);
    const b = text.indexOf(end);
    if (a < 0 || b < a) throw new Error(`gen_design_md: markers for "${name}" missing in DESIGN.md`);
    text = `${text.slice(0, a + start.length)}\n\n${body}\n${text.slice(b)}`;
  }
  return text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Load the TypeScript sources through Vite, so the script reads the same modules as the app.
  const { createServer } = await import("vite");
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const data = { ...(await server.ssrLoadModule(`${root}/themes.ts`)), ...(await server.ssrLoadModule(`${root}/parts.ts`)) };
    const current = readFileSync(DESIGN_PATH, "utf8");
    const next = render(current, data);
    if (next !== current) writeFileSync(DESIGN_PATH, next);
    console.log(next === current ? "DESIGN.md is up to date" : "DESIGN.md updated");
  } finally {
    await server.close();
  }
}
