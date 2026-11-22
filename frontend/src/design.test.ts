import { describe, expect, it } from "vitest";
import { readDesign, render } from "../scripts/gen_design_md.mjs";
import * as parts from "./parts";
import * as themes from "./themes";

const design = readDesign();

describe("DESIGN.md", () => {
  it("is up to date (run `npm --prefix frontend run gen:design`)", () => {
    expect(render(design, { ...themes, ...parts })).toBe(design);
  });

  it("documents the contract version and every part", () => {
    expect(design).toContain(`**${parts.STYLE_CONTRACT_VERSION}**`);
    for (const p of parts.PARTS) expect(design).toContain(`\`${p}\``);
  });
});
