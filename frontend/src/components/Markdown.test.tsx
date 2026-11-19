import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, safeUrl } from "./Markdown";

describe("Markdown", () => {
  // Review Focus 5
  it("markdown renders script and onerror inert, strips javascript: links", () => {
    const md = [
      "<script>window.__pwned = 1</script>",
      "",
      '<img src="x" onerror="window.__pwned = 2">',
      "",
      '<a href="javascript:alert(1)">raw anchor</a>',
      "",
      "[click me](javascript:alert(1))",
      "",
      "[shouty](JaVaScRiPt:alert(1))",
      "",
      "[tabbed](java&#x09;script:alert(1))",
      "",
      "[data](data:text/html;base64,PHNjcmlwdD4=)",
      "",
      "![img](javascript:alert(1))",
      "",
      "[ok](https://example.com/a) [mail](mailto:a@b.c) [rel](./docs/page)",
    ].join("\n");
    const { container } = render(<Markdown text={md} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    for (const el of Array.from(container.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.startsWith("on")).toBe(false);
      }
    }
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src") ?? "");
    for (const u of [...hrefs, ...srcs]) {
      expect(u.replace(/[\s\u0000-\u001f]/g, "").toLowerCase()).not.toMatch(/^(javascript|data|vbscript):/);
    }
    // The javascript: link still renders as an (inert) anchor.
    const clickMe = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "click me");
    expect(clickMe).toBeDefined();
    expect(clickMe!.getAttribute("href") ?? "").toBe("");
    expect(hrefs).toContain("https://example.com/a");
    expect(hrefs).toContain("mailto:a@b.c");
    expect(hrefs).toContain("./docs/page");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // Raw HTML tags are dropped (their inner text survives only as plain text, never as markup).
    expect(Array.from(container.querySelectorAll("a")).some((a) => a.textContent === "raw anchor")).toBe(false);
    expect(container.querySelector("img[src='x']")).toBeNull();
  });

  it("safeUrl allows only http, https, mailto and relative URLs", () => {
    expect(safeUrl("https://x.y/z")).toBe("https://x.y/z");
    expect(safeUrl("HTTP://x.y")).toBe("HTTP://x.y");
    expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeUrl("/abs/path")).toBe("/abs/path");
    expect(safeUrl("rel/path?q=a:b#c")).toBe("rel/path?q=a:b#c");
    expect(safeUrl("#frag")).toBe("#frag");
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl(" javascript:alert(1)")).toBe("");
    expect(safeUrl("java\tscript:alert(1)")).toBe("");
    expect(safeUrl("vbscript:x")).toBe("");
    expect(safeUrl("data:text/html,x")).toBe("");
    expect(safeUrl("irc://x")).toBe("");
  });

  it("code blocks highlighted and math rendered", () => {
    const md = "```python\ndef f(x):\n    return x\n```\n\nInline $a^2 + b^2$ and block:\n\n$$\n\\int_0^1 x\\,dx\n$$\n";
    const { container } = render(<Markdown text={md} />);
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("hljs");
    expect(code!.querySelector(".hljs-keyword")?.textContent).toBe("def");
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  });

  it("renders GFM tables and opens links in a new tab safely", () => {
    const { container } = render(<Markdown text={"| a | b |\n|---|---|\n| 1 | 2 |\n\n[x](https://e.com)"} />);
    expect(container.querySelector("table")).not.toBeNull();
    const a = container.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });
  it("an image that fails to load (e.g. CSP-blocked) falls back to its alt text", () => {
    const { container } = render(<Markdown text={"![quarterly chart](https://cdn.example.com/c.png)"} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/c.png");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".lq-img-blocked")?.textContent).toBe("quarterly chart");
  });
});
