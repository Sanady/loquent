import { describe, expect, it } from "vitest";

// No node types in this project, so the filesystem is read through Vite globs (keys are real paths).
const OWN = import.meta.glob("./fonts/*.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const UPSTREAM = import.meta.glob("../node_modules/@fontsource-variable/*/wght.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const WOFF2 = Object.keys(import.meta.glob("../node_modules/@fontsource-variable/*/files/*.woff2", { query: "?url", import: "default" })).map((k) => k.replace(/^\.\.\//, ""));

/** Resolves `rel` against the directory of `from`, collapsing `.` and `..` segments. */
function resolve(from: string, rel: string): string {
  const out = ["src", ...from.split("/").slice(1, -1)]; // glob keys are relative to src/
  for (const seg of rel.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== ".") out.push(seg);
  }
  return out.join("/");
}

const files = Object.keys(OWN).sort();

/** Declaration lines (`name: value;`) of a CSS text, whitespace-trimmed. */
const lines = (css: string, prop: string) =>
  [...css.matchAll(new RegExp(`^\\s*${prop}:\\s*([^;]+);`, "gm"))].map((m) => m[1].trim());

describe("fonts-drift: src/fonts/*.css stays in sync with @fontsource-variable", () => {
  it("finds the four font files", () => {
    expect(files.map((f) => f.split("/").pop())).toEqual(["geist.css", "inter.css", "jetbrains-mono.css", "newsreader.css"]);
  });

  describe.each(files)("%s", (file) => {
    const css = OWN[file];
    const pkg = /@fontsource-variable\/([a-z-]+)\/wght\.css/.exec(css)?.[1] ?? "";

    it("names its source package in the header", () => {
      expect(pkg).not.toBe("");
    });

    it("every url() resolves to an existing file", () => {
      const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/^["']|["']$/g, ""));
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) expect(WOFF2, u).toContain(resolve(file, u));
    });

    it("unicode-range and font-weight lines appear verbatim in the package wght.css", () => {
      const upstream = UPSTREAM[`../node_modules/@fontsource-variable/${pkg}/wght.css`];
      expect(upstream, `${pkg} wght.css`).toBeTruthy();
      for (const prop of ["unicode-range", "font-weight"]) {
        const ours = lines(css, prop);
        expect(ours.length, `${file} ${prop}`).toBeGreaterThan(0);
        const theirs = new Set(lines(upstream, prop));
        for (const v of ours) expect(theirs.has(v), `${file} ${prop}: ${v}`).toBe(true);
      }
    });
  });
});
