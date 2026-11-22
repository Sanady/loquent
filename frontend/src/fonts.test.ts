import { beforeEach, describe, expect, it, vi } from "vitest";
import editorialCss from "./styles/themes/editorial.css?raw";
import graphiteCss from "./styles/themes/graphite.css?raw";
import midnightCss from "./styles/themes/midnight.css?raw";
import interCss from "./fonts/inter.css?raw";
import geistCss from "./fonts/geist.css?raw";
import newsreaderCss from "./fonts/newsreader.css?raw";
import monoCss from "./fonts/jetbrains-mono.css?raw";

const loaded = vi.hoisted(() => ({ calls: [] as string[] }));

describe("loadThemeFonts", () => {
  beforeEach(() => {
    vi.resetModules();
    loaded.calls.length = 0;
    // doMock per test: factories run once per registry, so re-register after resetModules.
    for (const font of ["inter", "newsreader", "geist", "jetbrains-mono"]) {
      vi.doMock(`./fonts/${font}.css`, () => {
        loaded.calls.push(font);
        return {};
      });
    }
  });

  it("editorial loads newsreader, inter and mono, each only once", async () => {
    const { loadThemeFonts } = await import("./fonts");
    await loadThemeFonts("editorial");
    await loadThemeFonts("editorial");
    await loadThemeFonts("graphite");
    expect([...loaded.calls].sort()).toEqual(["inter", "jetbrains-mono", "newsreader"]);
  });

  it("midnight loads geist and jetbrains mono, not inter", async () => {
    const { loadThemeFonts } = await import("./fonts");
    await loadThemeFonts("midnight");
    expect([...loaded.calls].sort()).toEqual(["geist", "jetbrains-mono"]);
  });

  it("concurrent calls share one load per font", async () => {
    const { loadThemeFonts } = await import("./fonts");
    await Promise.all([loadThemeFonts("graphite"), loadThemeFonts("graphite-dark")]);
    expect([...loaded.calls].sort()).toEqual(["inter", "jetbrains-mono"]);
  });
});

describe("font assets", () => {
  it.each([
    ["Inter Variable", interCss],
    ["Geist Variable", geistCss],
    ["Newsreader Variable", newsreaderCss],
    ["JetBrains Mono Variable", monoCss],
  ])("%s ships latin and latin-ext only", (family, css) => {
    expect(css).toContain(`font-family: "${family}"`);
    const files = [...css.matchAll(/files\/([a-z-]+)\.woff2/g)].map((m) => m[1]);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.includes("-latin-ext-"))).toBe(true);
    expect(files.some((f) => /-latin-wght/.test(f))).toBe(true);
    expect(css).not.toMatch(/cyrillic|greek|vietnamese/);
  });

  it("theme stacks list the Variable family first, then the plain name", () => {
    expect(graphiteCss).toContain('--lq-font-body: "Inter Variable", "Inter", ');
    expect(graphiteCss).toContain('--lq-font-mono: "JetBrains Mono Variable", "JetBrains Mono", ');
    expect(editorialCss).toContain('--lq-font-display: "Newsreader Variable", "Newsreader", ');
    expect(midnightCss).toContain('--lq-font-body: "Geist Variable", "Geist", ');
  });
});
