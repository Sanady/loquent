import { describe, expect, it } from "vitest";
import mainSrc from "./main.tsx?raw";

// Every stylesheet and component source, read as text. vite.config.ts css.include lets these through.
const ALL_CSS = import.meta.glob<string>("./styles/**/*.css", { query: "?raw", import: "default", eager: true });
const ALL_TSX = import.meta.glob<string>(["./**/*.tsx", "!./**/*.test.tsx"], { query: "?raw", import: "default", eager: true });

/** Release 0.1 token names; styles/legacy.css keeps them as deprecated read aliases only. */
const OLD_NAMES = ["--lq-background", "--lq-muted", "--lq-radius", "--lq-font", "--lq-on-accent", "--lq-elevated"];
const oldNameRe = new RegExp(`(?:${OLD_NAMES.join("|")})(?![\\w-])`);

const COMPONENT_CSS = import.meta.glob<string>("./styles/components/*.css", { query: "?raw", import: "default", eager: true });

const SHELL_FILES = ["shell", "sidebar", "header", "composer", "empty", "login", "drawer"];
const CONVERSATION_FILES = ["message", "markdown", "code", "activity", "widget", "error", "attachment"];

const files = () => Object.entries(COMPONENT_CSS).map(([path, css]) => [path.replace(/^.*\//, ""), css] as const);
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Drop `var(--name, fallback)` fallbacks so a literal kept only as a fallback is not flagged. */
function withoutVarFallbacks(css: string): string {
  let out = css;
  let prev;
  do {
    prev = out;
    out = out.replace(/var\(\s*(--[\w-]+)\s*,[^()]*(?:\([^()]*\)[^()]*)*\)/g, "var($1)");
  } while (out !== prev);
  return out;
}

/** CSS named colors (CSS Color 4). transparent, currentColor, inherit and none stay allowed. */
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
    "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow " +
    "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
    "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
    "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru " +
    "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

/**
 * The only px allowed in a shadow: the documented focus halo, a 3px accent-soft ring around a
 * focused field (composer, rename input, widget fields). Every other shadow is a --lq-shadow-*
 * token or a theme knob.
 */
const SHADOW_PX_ALLOWLIST = ["0 0 0 3px var(--lq-accent-soft)"];

/** `property: value` pairs in a CSS text (comments stripped). */
function declarations(css: string): [string, string][] {
  return [...stripComments(css).matchAll(/(?:^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]);
}

describe("component css", () => {
  it("has a stylesheet for each shell and conversation region", () => {
    const names = files().map(([name]) => name);
    for (const f of [...SHELL_FILES, ...CONVERSATION_FILES]) expect(names, `${f}.css`).toContain(`${f}.css`);
  });

  it("all component css is layered", () => {
    for (const [name, css] of files()) {
      expect(stripComments(css).trimStart(), name).toMatch(/^@layer lq\.components\s*\{/);
    }
  });

  it("component css uses tokens only", () => {
    for (const [name, raw] of files()) {
      const css = withoutVarFallbacks(stripComments(raw));
      expect(css, `${name}: hex color`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, `${name}: color function`).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/);
      expect(css, `${name}: !important`).not.toMatch(/!\s*important/);
      for (const [prop, value] of declarations(css)) {
        // Named colors as values (property names like white-space are not values).
        if (!prop.startsWith("--")) {
          const named = (value.replace(/var\(--[\w-]+\)/g, "").match(/[a-z]+/gi) ?? []).filter((w) => NAMED_COLORS.has(w.toLowerCase()));
          expect(named, `${name}: ${prop}: ${value} uses a named color`).toEqual([]);
        }
        if (/^(?:box|text)-shadow$/.test(prop)) {
          const rest = SHADOW_PX_ALLOWLIST.reduce((v, ok) => v.split(ok).join(""), value);
          expect(rest, `${name}: ${prop} px outside the focus halo`).not.toMatch(/\dpx\b/);
        }
        if (/^(?:border-radius|font-size|font-family|font)$/.test(prop)) {
          expect(value, `${name}: ${prop} must use tokens`).not.toMatch(/\d(?:px|em|pt)\b/);
          expect(value, `${name}: ${prop} must use tokens`).toMatch(/var\(--lqi?-|^(?:inherit|0|50%)$/);
        }
        if (prop === "font-weight") {
          expect(value, `${name}: font-weight must use a weight token`).toMatch(/^(?:var\(--lqi?-[\w-]+\)|inherit)$/);
        }
        if (/^(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?$/.test(prop)) {
          expect(value, `${name}: ${prop} uses space tokens`).not.toMatch(/(?:^|[\s(,])[1-9]\d*(?:\.\d+)?px\b/);
        }
      }
    }
  });

  it("text-subtle colors non-text decoration only (chevrons, icons), never text", () => {
    // Rules as selector { body } at any nesting depth (comments stripped).
    for (const [name, raw] of files()) {
      for (const m of stripComments(raw).matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim();
        if (!/(?:^|[;\s])color\s*:\s*var\(--lq-text-subtle\)/.test(m[2])) continue;
        expect(selector, `${name}: ${selector} sets text in text-subtle; use text-muted`).toMatch(/chevron|icon/);
      }
    }
  });

  it("focus styles never remove the outline (forced-colors keeps a transparent one)", () => {
    for (const [name, raw] of files()) {
      for (const [prop, value] of declarations(withoutVarFallbacks(stripComments(raw)))) {
        if (prop === "outline") expect(value, `${name}: outline: ${value}`).not.toMatch(/^(?:none|0)$/);
      }
    }
  });

  it("status dots stay visible in forced-colors mode", () => {
    const css = stripComments(COMPONENT_CSS["./styles/components/activity.css"]);
    const forced = /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? "";
    expect(forced, "activity.css needs a forced-colors block").toContain(".lq-activity-dot");
    expect(forced).toMatch(/border:\s*4px solid;|forced-color-adjust:\s*none/);
  });

  it("nothing reads the release 0.1 token names except the deprecated alias block", () => {
    for (const [path, css] of Object.entries(ALL_CSS)) {
      const body = stripComments(path.endsWith("/legacy.css") ? css.replace(/\/\* alias:start \*\/[\s\S]*?\/\* alias:end \*\//, "") : css);
      expect(body, path).not.toMatch(oldNameRe);
    }
    for (const [path, src] of Object.entries(ALL_TSX)) expect(src, path).not.toMatch(oldNameRe);
  });

  it("legacy.css aliases each old name in lq.base, and nothing else", () => {
    const css = ALL_CSS["./styles/legacy.css"];
    expect(css, "styles/legacy.css").toBeDefined();
    expect(stripComments(css).trimStart()).toMatch(/^@layer lq\.base\s*\{/);
    const aliases = Object.fromEntries([...stripComments(css).matchAll(/(--lq-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    expect(aliases).toEqual({
      "--lq-background": "var(--lq-bg)",
      "--lq-muted": "var(--lq-text-muted)",
      "--lq-radius": "var(--lq-radius-lg)",
      "--lq-font": "var(--lq-font-body)",
      "--lq-on-accent": "var(--lq-accent-text)",
      "--lq-elevated": "var(--lq-surface-raised)",
    });
    expect(mainSrc.indexOf('"./styles/legacy.css"')).toBeGreaterThan(mainSrc.indexOf('"./styles/tokens.css"'));
  });

  it("main.tsx imports the stylesheets in cascade order", () => {
    const order = ["./styles/layers.css", "./styles/tokens.css", "./styles/themes/", "./styles/components/"];
    const at = order.map((p) => mainSrc.indexOf(`"${p}`));
    for (const [i, p] of order.entries()) expect(at[i], p).toBeGreaterThanOrEqual(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const f of [...SHELL_FILES, ...CONVERSATION_FILES]) expect(mainSrc, f).toContain(`"./styles/components/${f}.css"`);
  });

  it("no unlayered app or decorative third-party css is imported", () => {
    // Unlayered CSS beats every layer, so only KaTeX's functional stylesheet may stay unlayered.
    const imports = [...mainSrc.matchAll(/^import\s+"([^"]+\.css)";/gm)].map((m) => m[1]);
    expect(imports.filter((p) => !p.startsWith("./styles/"))).toEqual(["katex/dist/katex.min.css"]);
    expect(mainSrc).not.toContain("highlight.js");
  });
});
