import { describe, expect, it } from "vitest";
import mainSrc from "./main.tsx?raw";

// Every component stylesheet, read as text. vite.config.ts css.include lets these through.
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
      expect(css, `${name}: rgb()/hsl() color`).not.toMatch(/\b(?:rgba?|hsla?)\(/);
      expect(css, `${name}: !important`).not.toMatch(/!\s*important/);
      for (const [prop, value] of declarations(css)) {
        if (/^(?:border-radius|font-size|font-family|font)$/.test(prop)) {
          expect(value, `${name}: ${prop} must use tokens`).not.toMatch(/\d(?:px|em|pt)\b/);
          expect(value, `${name}: ${prop} must use tokens`).toMatch(/var\(--lqi?-|^(?:inherit|0|50%)$/);
        }
        if (/^(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?$/.test(prop)) {
          expect(value, `${name}: ${prop} uses space tokens`).not.toMatch(/(?:^|[\s(,])[1-9]\d*(?:\.\d+)?px\b/);
        }
      }
    }
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
