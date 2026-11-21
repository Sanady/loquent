import { describe, expect, it } from "vitest";
import snapshotJson from "./__snapshots__/contract.json";
import { CONTRACT_TOKENS, PARTS, PART_SELECTOR, SCALE_TOKENS, STATES, STYLE_CONTRACT_VERSION } from "./parts";
import tokensCss from "./styles/tokens.css?raw";

// A plain JSON comparison on purpose (not toMatchSnapshot), so `vitest -u` cannot rewrite it.
const snapshot: { version: string; selector: string; parts: string[]; tokens: string[]; states: string[] } = snapshotJson;

const current = { version: STYLE_CONTRACT_VERSION, selector: PART_SELECTOR, parts: [...PARTS], tokens: [...CONTRACT_TOKENS], states: [...STATES] };

describe("styling contract", () => {
  it("matches the committed snapshot", () => {
    const listsMatch =
      JSON.stringify([current.parts, current.tokens, current.states]) ===
      JSON.stringify([snapshot.parts, snapshot.tokens, snapshot.states]);
    if (!listsMatch && current.version === snapshot.version) {
      throw new Error(
        "The styling contract (parts, tokens or states) changed but STYLE_CONTRACT_VERSION is still " +
          `${current.version}. Bump STYLE_CONTRACT_VERSION in src/parts.ts (major for a removal or rename, minor for an ` +
          "addition) and update src/__snapshots__/contract.json by hand.",
      );
    }
    expect(current.version, "update version in src/__snapshots__/contract.json to match parts.ts").toBe(snapshot.version);
    expect(current.selector).toBe(snapshot.selector);
    expect(current.parts).toEqual(snapshot.parts);
    expect(current.tokens).toEqual(snapshot.tokens);
    expect(current.states).toEqual(snapshot.states);
  });

  it("scale tokens are exactly those defined in styles/tokens.css", () => {
    const defined = [...tokensCss.matchAll(/^\s*--lq-([a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    expect([...new Set(defined)].sort()).toEqual([...SCALE_TOKENS].sort());
  });
});
