import { describe, expect, it } from "vitest";
import layersCss from "./styles/layers.css?raw";
import tokensCss from "./styles/tokens.css?raw";
import editorialCss from "./styles/themes/editorial.css?raw";
import graphiteDarkCss from "./styles/themes/graphite-dark.css?raw";
import graphiteCss from "./styles/themes/graphite.css?raw";
import midnightCss from "./styles/themes/midnight.css?raw";
import { contrast, parseColor } from "./theme";
import { COLOR_TOKENS, THEME_SCHEME, THEME_TOKENS, THEMES, type ColorToken, type ThemeId } from "./themes";

const THEME_CSS: Record<ThemeId, string> = {
  graphite: graphiteCss,
  "graphite-dark": graphiteDarkCss,
  editorial: editorialCss,
  midnight: midnightCss,
};

/** Custom-property declarations (`--lq-name: value;`) in a CSS text, comments stripped. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/--lq-([a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = clean.indexOf(`${selector} {`);
  if (at < 0) return "";
  const open = clean.indexOf("{", at);
  return clean.slice(open + 1, clean.indexOf("}", open));
}

const px = (v: string | undefined) => Number(/^(\d+(?:\.\d+)?)px$/.exec(v ?? "")?.[1] ?? NaN);

/** Opaque-only parse: contrast() ignores alpha, so a translucent value would give a false ratio. */
function solid(theme: ThemeId, token: ColorToken) {
  const value = THEME_TOKENS[theme][token];
  expect(value, `${theme} ${token} must be an opaque #rrggbb`).toMatch(/^#[0-9a-f]{6}$/);
  return parseColor(value)!;
}

const AA_PAIRS: [fg: ColorToken, bg: ColorToken, min: number][] = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["text-muted", "bg", 4.5],
  ["text-muted", "surface", 4.5],
  ["accent-text", "accent", 4.5],
  ["user-bubble-text", "user-bubble", 4.5],
  ["border-strong", "bg", 3],
  ["focus-ring", "bg", 3],
  // Surfaces the real UI puts muted and body text on.
  ["text-muted", "bg-subtle", 4.5],
  ["text-muted", "user-bubble", 4.5],
  ["text-muted", "code-bg", 4.5],
  ["text", "code-bg", 4.5],
  ["border-strong", "surface", 3],
  // Status and accent colors are used as text and links on bg and on surface.
  ...(["success", "warning", "danger", "accent"] as const).flatMap(
    (fg): [ColorToken, ColorToken, number][] => [
      [fg, "bg", 4.5],
      [fg, "surface", 4.5],
    ],
  ),
  // text-subtle is for non-essential text only (timestamps, hints), so 3:1 not 4.5:1.
  ["text-subtle", "bg", 3],
  ["text-subtle", "surface", 3],
];

describe("themes", () => {
  it("lists the four themes in order", () => {
    expect([...THEMES]).toEqual(["graphite", "graphite-dark", "editorial", "midnight"]);
  });

  it("every theme defines every color token", () => {
    for (const id of THEMES) {
      expect(Object.keys(THEME_TOKENS[id]).sort(), id).toEqual([...COLOR_TOKENS].sort());
      for (const token of COLOR_TOKENS) {
        expect(THEME_TOKENS[id][token], `${id} ${token}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      }
    }
  });

  it("theme css matches THEME_TOKENS", () => {
    for (const id of THEMES) {
      const css = THEME_CSS[id];
      expect(css, id).toMatch(/@layer lq\.themes\s*\{/);
      const body = ruleBody(css, `[data-lq-theme="${id}"]`);
      expect(body, `${id} rule`).not.toBe("");
      const decls = declarations(body);
      for (const token of COLOR_TOKENS) {
        expect(decls.get(token)?.toLowerCase(), `${id} --lq-${token}`).toBe(THEME_TOKENS[id][token]);
      }
      expect(body, `${id} color-scheme`).toMatch(new RegExp(`color-scheme:\\s*${THEME_SCHEME[id]};`));
    }
  });

  it("AA contrast holds for every theme", () => {
    for (const id of THEMES) {
      for (const [fg, bg, min] of AA_PAIRS) {
        const ratio = contrast(solid(id, fg), solid(id, bg));
        expect(ratio, `${id}: ${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("THEME_SCHEME is light for graphite and editorial, dark for graphite-dark and midnight", () => {
    expect(THEME_SCHEME).toEqual({
      graphite: "light",
      "graphite-dark": "dark",
      editorial: "light",
      midnight: "dark",
    });
  });
});

describe("token scale", () => {
  it("layers.css declares the cascade layer order", () => {
    expect(layersCss).toContain("@layer lq.reset, lq.base, lq.components, lq.themes, lq.utilities;");
  });

  it("tokens.css defines every scale token in lq.base", () => {
    expect(tokensCss).toMatch(/@layer lq\.base\s*\{/);
    const decls = declarations(tokensCss);
    const names = [
      "font-body", "font-display", "font-mono",
      "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl",
      "leading-tight", "leading-normal",
      ...Array.from({ length: 10 }, (_, i) => `space-${i + 1}`),
      "radius-sm", "radius-md", "radius-lg", "radius-xl", "radius-pill",
      "shadow-1", "shadow-2", "shadow-3",
      "duration-fast", "duration-normal", "ease",
      "content-width", "sidebar-width",
    ];
    for (const n of names) expect(decls.has(n), `--lq-${n}`).toBe(true);
  });

  it("default reading measure: 15-16px text, 1.6 leading, 680-720px column, 4px space base", () => {
    const root = declarations(ruleBody(tokensCss, ":root"));
    expect([15, 16]).toContain(px(root.get("text-base")));
    expect(root.get("leading-normal")).toBe("1.6");
    const width = px(root.get("content-width"));
    expect(width).toBeGreaterThanOrEqual(680);
    expect(width).toBeLessThanOrEqual(720);
    expect(px(root.get("space-1"))).toBe(4);
    for (let i = 1; i <= 10; i++) expect(px(root.get(`space-${i}`)) % 4, `space-${i}`).toBe(0);
  });

  it("density and text-size attributes rescale space and text tokens", () => {
    const root = declarations(ruleBody(tokensCss, ":root"));
    const compact = declarations(ruleBody(tokensCss, '[data-lq-density="compact"]'));
    for (let i = 1; i <= 10; i++) {
      expect(px(compact.get(`space-${i}`)), `compact space-${i}`).toBeLessThanOrEqual(px(root.get(`space-${i}`)));
    }
    expect(px(compact.get("space-4"))).toBeLessThan(px(root.get("space-4")));

    const steps = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl"];
    const small = declarations(ruleBody(tokensCss, '[data-lq-text="s"]'));
    const large = declarations(ruleBody(tokensCss, '[data-lq-text="l"]'));
    for (const s of steps) {
      expect(px(small.get(s)), `s ${s}`).toBeLessThan(px(root.get(s)));
      expect(px(large.get(s)), `l ${s}`).toBeGreaterThan(px(root.get(s)));
    }
  });
});
