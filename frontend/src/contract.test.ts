import { describe, expect, it } from "vitest";
import snapshotJson from "./__snapshots__/contract.json";
import { CONTRACT_TOKENS, PARTS, PART_SELECTOR, ROOT_ATTRIBUTES, SCALE_TOKENS, STATES, STYLE_CONTRACT_VERSION, THEME_IDS } from "./parts";
import { applyAppearance } from "./theme";
import { THEMES } from "./themes";
import tokensCss from "./styles/tokens.css?raw";

// A plain JSON comparison on purpose (not toMatchSnapshot), so `vitest -u` cannot rewrite it.
const snapshot: {
  version: string;
  selector: string;
  parts: string[];
  tokens: string[];
  states: string[];
  rootAttributes: Record<string, string[]>;
  themes: string[];
} = snapshotJson;

const current = {
  version: STYLE_CONTRACT_VERSION,
  selector: PART_SELECTOR,
  parts: [...PARTS],
  tokens: [...CONTRACT_TOKENS],
  states: [...STATES],
  rootAttributes: Object.fromEntries(Object.entries(ROOT_ATTRIBUTES).map(([k, v]) => [k, [...v]])),
  themes: [...THEME_IDS],
};
const lists = (c: Omit<typeof snapshot, "version" | "selector">) => JSON.stringify([c.parts, c.tokens, c.states, c.rootAttributes, c.themes]);

describe("styling contract", () => {
  it("matches the committed snapshot", () => {
    const listsMatch = lists(current) === lists(snapshot);
    if (!listsMatch && current.version === snapshot.version) {
      throw new Error(
        "The styling contract (parts, tokens, states, root attributes or theme ids) changed but STYLE_CONTRACT_VERSION is still " +
          `${current.version}. Bump STYLE_CONTRACT_VERSION in src/parts.ts (major for a removal or rename, minor for an ` +
          "addition) and update src/__snapshots__/contract.json by hand.",
      );
    }
    expect(current.version, "update version in src/__snapshots__/contract.json to match parts.ts").toBe(snapshot.version);
    expect(current.selector).toBe(snapshot.selector);
    expect(current.parts).toEqual(snapshot.parts);
    expect(current.tokens).toEqual(snapshot.tokens);
    expect(current.states).toEqual(snapshot.states);
    expect(current.rootAttributes).toEqual(snapshot.rootAttributes);
    expect(current.themes).toEqual(snapshot.themes);
  });

  it("THEME_IDS are the theme ids", () => {
    expect([...THEME_IDS]).toEqual([...THEMES]);
    expect(ROOT_ATTRIBUTES["data-lq-theme"]).toEqual(THEME_IDS);
  });

  it("applyAppearance only ever sets documented root attribute values", () => {
    const el = document.documentElement;
    for (const theme of THEMES) {
      for (const density of ["comfortable", "compact"] as const) {
        for (const text of ["s", "m", "l"] as const) {
          applyAppearance({ theme, density, text }, null);
          for (const [attr, values] of Object.entries(ROOT_ATTRIBUTES)) {
            expect(values, `${attr}=${el.getAttribute(attr)}`).toContain(el.getAttribute(attr));
          }
        }
      }
    }
  });

  it("scale tokens are exactly those defined in styles/tokens.css", () => {
    const defined = [...tokensCss.matchAll(/^\s*--lq-([a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    expect([...new Set(defined)].sort()).toEqual([...SCALE_TOKENS].sort());
  });
});
