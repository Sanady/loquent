import { afterEach, describe, expect, it, vi } from "vitest";
import css from "./styles.css?raw";
import { applyTheme, contrast, CUSTOM_ATTR, parseColor, readStoredMode, resolveTheme, storeMode, systemMode } from "./theme";

afterEach(() => vi.restoreAllMocks());

describe("theme", () => {
  it("theme tokens applied as css vars", () => {
    const el = document.documentElement;
    applyTheme(
      {
        accent: "#ff0066",
        background: "#101010",
        surface: "#202020",
        text: "#eeeeee",
        muted: "#999999",
        radius: "4px",
        font: "Georgia, serif",
      },
      el,
    );
    expect(el.style.getPropertyValue("--lq-accent")).toBe("#ff0066");
    expect(el.style.getPropertyValue("--lq-background")).toBe("#101010");
    expect(el.style.getPropertyValue("--lq-surface")).toBe("#202020");
    expect(el.style.getPropertyValue("--lq-text")).toBe("#eeeeee");
    expect(el.style.getPropertyValue("--lq-muted")).toBe("#999999");
    expect(el.style.getPropertyValue("--lq-radius")).toBe("4px");
    expect(el.style.getPropertyValue("--lq-font")).toBe("Georgia, serif");
  });

  it("ignores unknown keys and clears keys that are no longer set", () => {
    const el = document.documentElement;
    applyTheme({ accent: "red", evil: "x" }, el);
    expect(el.style.getPropertyValue("--lq-evil")).toBe("");
    applyTheme({}, el);
    expect(el.style.getPropertyValue("--lq-accent")).toBe("");
  });

  it("stored mode round-trips and survives a throwing localStorage", () => {
    expect(readStoredMode()).toBeNull();
    storeMode("dark");
    expect(readStoredMode()).toBe("dark");
    localStorage.setItem("lq-color-mode", "purple");
    expect(readStoredMode()).toBeNull();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readStoredMode()).toBeNull();
    expect(() => storeMode("light")).not.toThrow();
  });

  it("system mode follows prefers-color-scheme", () => {
    const mm = vi.fn((q: string) => ({ matches: q.includes("dark") }) as MediaQueryList);
    vi.stubGlobal("matchMedia", mm);
    expect(systemMode()).toBe("dark");
    vi.unstubAllGlobals();
  });
});

describe("brand palettes (R25) and derived contrast", () => {
  const rgb = (c: string) => {
    const v = parseColor(c);
    if (!v) throw new Error(`unparseable ${c}`);
    return v;
  };
  const AA = 4.5;

  it("a dark config gets readable on-accent, surface, elevated and text colors", () => {
    const r = resolveTheme({ accent: "#7dd3fc", background: "#111111", text: "#eeeeee" });
    const v = r.vars;
    expect(r.scheme).toBe("dark");
    expect(r.custom).toEqual(["background", "surface", "text", "muted"]);
    expect(v["--lq-on-accent"]).toBe("#111111");
    expect(contrast(rgb(v["--lq-on-accent"]), rgb("#7dd3fc"))).toBeGreaterThanOrEqual(AA);
    // The elevated surface (buttons, chips, composer, widgets) is derived, never white.
    expect(v["--lq-elevated"]).not.toMatch(/^#fff/i);
    expect(contrast(rgb("#eeeeee"), rgb(v["--lq-elevated"]))).toBeGreaterThanOrEqual(AA);
    expect(contrast(rgb("#eeeeee"), rgb(v["--lq-surface"]))).toBeGreaterThanOrEqual(AA);
    expect(contrast(rgb(v["--lq-muted"]), rgb(v["--lq-elevated"]))).toBeGreaterThanOrEqual(AA);
  });

  it("a background alone derives readable text, muted and surface", () => {
    for (const bg of ["#111", "#0b1020", "rgb(30, 30, 46)", "#ffffff", "#fdf6e3"]) {
      const v = resolveTheme({ background: bg }).vars;
      const b = rgb(bg);
      expect(contrast(rgb(v["--lq-text"]), b)).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text"]), rgb(v["--lq-surface"]))).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text"]), rgb(v["--lq-elevated"]))).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-muted"]), b)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("on-accent is white on dark accents and near-black on light ones", () => {
    expect(resolveTheme({ accent: "#1e3a8a" }).vars["--lq-on-accent"]).toBe("#ffffff");
    expect(resolveTheme({ accent: "#facc15" }).vars["--lq-on-accent"]).toBe("#111111");
    expect(resolveTheme({ accent: "#fc0" }).vars["--lq-on-accent"]).toBe("#111111");
    expect(resolveTheme({}).vars["--lq-on-accent"]).toBeUndefined();
  });

  it("without a background, configured colors are not marked custom", () => {
    const r = resolveTheme({ text: "#222222", accent: "#f00" });
    expect(r.custom).toEqual([]);
    expect(r.scheme).toBeNull();
    expect(r.vars["--lq-elevated"]).toBeUndefined();
  });

  it("applyTheme marks custom keys on <html> and clears derived vars when the config changes", () => {
    const el = document.documentElement;
    applyTheme({ background: "#111", accent: "#7dd3fc" }, el);
    expect(el.getAttribute(CUSTOM_ATTR)).toBe("background surface text muted");
    expect(el.style.getPropertyValue("--lq-elevated")).not.toBe("");
    applyTheme({}, el);
    expect(el.hasAttribute(CUSTOM_ATTR)).toBe(false);
    expect(el.style.getPropertyValue("--lq-elevated")).toBe("");
    expect(el.style.getPropertyValue("--lq-on-accent")).toBe("");
  });
});

describe("styles.css cascade", () => {
  // jsdom cascades and inherits custom properties, so the real stylesheet can be checked.
  function mount(mode: "light" | "dark") {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const root = document.createElement("div");
    root.className = "lq-root";
    root.setAttribute("data-mode", mode);
    document.body.appendChild(root);
    const get = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    return { get, done: () => (style.remove(), root.remove()) };
  }
  const darkConfig = { accent: "#7dd3fc", background: "#111111", text: "#eeeeee" };

  it("configured colors persist in dark mode", () => {
    const resolved = applyTheme(darkConfig);
    const { get, done } = mount("dark");
    try {
      expect(get("--lq-background")).toBe("#111111");
      expect(get("--lq-text")).toBe("#eeeeee");
      expect(get("--lq-surface")).toBe(resolved.vars["--lq-surface"]);
      expect(get("--lq-muted")).toBe(resolved.vars["--lq-muted"]);
      expect(get("--lq-elevated")).toBe(resolved.vars["--lq-elevated"]);
      expect(get("--lq-on-accent")).toBe("#111111");
    } finally {
      done();
    }
  });

  it("a dark config in light mode gets no white elevated surface", () => {
    const resolved = applyTheme(darkConfig);
    const { get, done } = mount("light");
    try {
      expect(get("--lq-elevated")).toBe(resolved.vars["--lq-elevated"]);
      expect(contrast(parseColor(get("--lq-text"))!, parseColor(get("--lq-elevated"))!)).toBeGreaterThanOrEqual(4.5);
    } finally {
      done();
    }
  });

  it("without a configured background the built-in dark palette applies", () => {
    applyTheme({ text: "#222222" });
    const { get, done } = mount("dark");
    try {
      expect(get("--lq-background")).toBe("#141513");
      expect(get("--lq-text")).toBe("#e8e6e1");
      expect(get("--lq-elevated")).toBe("#222420");
    } finally {
      done();
    }
  });

  it("defaults: white elevated and on-accent in light mode", () => {
    applyTheme({});
    const { get, done } = mount("light");
    try {
      expect(get("--lq-elevated")).toBe("#ffffff");
      expect(get("--lq-on-accent")).toBe("#ffffff");
    } finally {
      done();
    }
  });
});
