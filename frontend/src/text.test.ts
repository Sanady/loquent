import { describe, expect, it } from "vitest";
import { plainTitle } from "./text";

describe("plainTitle", () => {
  it("strips common markdown syntax for display", () => {
    expect(plainTitle("Show me **markdown**: a list")).toBe("Show me markdown: a list");
    expect(plainTitle("Show me **markdo")).toBe("Show me markdo");
    expect(plainTitle("__bold__ and *em* and `code`")).toBe("bold and em and code");
    expect(plainTitle("# Heading")).toBe("Heading");
    expect(plainTitle("> quoted\n- item one\n* item two")).toBe("quoted item one item two");
    expect(plainTitle("see [the docs](https://x.y/z) and ![logo](a.png)")).toBe("see the docs and logo");
  });

  it("leaves plain text and inner punctuation alone", () => {
    expect(plainTitle("snake_case_name - a dash")).toBe("snake_case_name - a dash");
    expect(plainTitle("2 * 3 = 6")).toBe("2 * 3 = 6");
    expect(plainTitle("")).toBe("");
  });
});
