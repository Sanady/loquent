import { describe, expect, it } from "vitest";
import { parseOptions } from "./Select";

describe("parseOptions", () => {
  it("accepts [value,label] list pairs as options", () => {
    expect(parseOptions([["pro", "Pro plan"], "basic", { value: "x" }])).toEqual([
      { value: "pro", label: "Pro plan" },
      { value: "basic", label: "basic" },
      { value: "x", label: "x" },
    ]);
  });
  it("rejects malformed pairs", () => {
    expect(parseOptions([["a"]])).toBeNull();
    expect(parseOptions([["a", 1]])).toBeNull();
  });
});
