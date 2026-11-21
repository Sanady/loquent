import { afterEach, describe, expect, it, vi } from "vitest";
import { loadThemeFonts } from "./fonts";
import { applyAppearance, contrast, CUSTOM_ATTR, parseColor, resolveTheme, resolveThemeId, systemDark } from "./theme";
import { THEME_TOKENS, THEMES, type ThemeId } from "./themes";

vi.mock("./fonts", () => ({ loadThemeFonts: vi.fn(async () => {}) }));

afterEach(() => vi.restoreAllMocks());

/** Each theme's color tokens as a plain rule (the real theme CSS is layered; jsdom may not cascade @layer). */
const THEME_RULES = Object.fromEntries(
  THEMES.map((id) => [
    id,
    `[data-lq-theme="${id}"] { ${Object.entries(THEME_TOKENS[id])
      .map(([k, v]) => `--lq-${k}: ${v};`)
      .join(" ")} }`,
  ]),
) as Record<ThemeId, string>;

/** applyAppearance with the legacy `config.theme` only (the brand layer), in a light theme. */
const applyBrand = (brand: Record<string, string>, el?: HTMLElement, theme: ThemeId = "graphite") => applyAppearance({ theme }, brand, el);

describe("theme", () => {
  it("theme tokens applied as css vars", () => {
    const el = document.documentElement;
    applyBrand(
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
    expect(el.style.getPropertyValue("--lq-bg")).toBe("#101010");
    expect(el.style.getPropertyValue("--lq-surface")).toBe("#202020");
    expect(el.style.getPropertyValue("--lq-text")).toBe("#eeeeee");
    expect(el.style.getPropertyValue("--lq-text-muted")).toBe("#999999");
    expect(el.style.getPropertyValue("--lq-radius-lg")).toBe("4px");
    expect(el.style.getPropertyValue("--lq-font-body")).toBe("Georgia, serif");
  });

  it("ignores unknown keys and clears keys that are no longer set", () => {
    const el = document.documentElement;
    applyBrand({ accent: "red", evil: "x" }, el);
    expect(el.style.getPropertyValue("--lq-evil")).toBe("");
    applyBrand({}, el);
    expect(el.style.getPropertyValue("--lq-accent")).toBe("");
  });

  it("system mode follows prefers-color-scheme", () => {
    const mm = vi.fn((q: string) => ({ matches: q.includes("dark") }) as MediaQueryList);
    vi.stubGlobal("matchMedia", mm);
    expect(systemDark()).toBe(true);
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
    expect(v["--lq-accent-text"]).toBe("#111111");
    expect(contrast(rgb(v["--lq-accent-text"]), rgb("#7dd3fc"))).toBeGreaterThanOrEqual(AA);
    // The elevated surface (buttons, chips, composer, widgets) is derived, never white.
    expect(v["--lq-surface-raised"]).not.toMatch(/^#fff/i);
    expect(contrast(rgb("#eeeeee"), rgb(v["--lq-surface-raised"]))).toBeGreaterThanOrEqual(AA);
    expect(contrast(rgb("#eeeeee"), rgb(v["--lq-surface"]))).toBeGreaterThanOrEqual(AA);
    expect(contrast(rgb(v["--lq-text-muted"]), rgb(v["--lq-surface-raised"]))).toBeGreaterThanOrEqual(AA);
  });

  it("a background alone derives readable text, muted and surface", () => {
    for (const bg of ["#111", "#0b1020", "rgb(30, 30, 46)", "#ffffff", "#fdf6e3"]) {
      const v = resolveTheme({ background: bg }).vars;
      const b = rgb(bg);
      expect(contrast(rgb(v["--lq-text"]), b)).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text"]), rgb(v["--lq-surface"]))).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text"]), rgb(v["--lq-surface-raised"]))).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text-muted"]), b)).toBeGreaterThanOrEqual(AA);
      // New derived roles stay readable too.
      expect(contrast(rgb(v["--lq-user-bubble-text"]), rgb(v["--lq-user-bubble"]))).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text"]), rgb(v["--lq-bg-subtle"]))).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text"]), rgb(v["--lq-code-bg"]))).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text-muted"]), rgb(v["--lq-surface"]))).toBeGreaterThanOrEqual(AA);
      // text-subtle is non-essential text only: held to 3:1, like the built-in themes.
      expect(contrast(rgb(v["--lq-text-subtle"]), b)).toBeGreaterThanOrEqual(3);
      expect(contrast(rgb(v["--lq-text-subtle"]), rgb(v["--lq-surface"]))).toBeGreaterThanOrEqual(3);
    }
  });

  it("mid-tone backgrounds still derive text that meets every floor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bg of ["#777777", "#808080", "#999999", "#6b6b6b", "#4a7a8c"]) {
      const v = resolveTheme({ background: bg }).vars;
      const b = rgb(bg);
      const at = (fg: string, against: string) => contrast(rgb(v[fg]), rgb(against));
      expect(at("--lq-text", bg), `text on ${bg}`).toBeGreaterThanOrEqual(AA);
      expect(at("--lq-text-muted", bg), `text-muted on ${bg}`).toBeGreaterThanOrEqual(AA);
      expect(at("--lq-text-subtle", bg), `text-subtle on ${bg}`).toBeGreaterThanOrEqual(3);
      expect(at("--lq-text-subtle", v["--lq-surface"]), `text-subtle on surface of ${bg}`).toBeGreaterThanOrEqual(3);
      expect(at("--lq-user-bubble-text", v["--lq-user-bubble"]), `user-bubble-text on ${bg}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(rgb(v["--lq-text"]), b)).toBeGreaterThanOrEqual(AA);
      for (const fg of ["--lq-text", "--lq-text-muted"]) {
        for (const surface of ["--lq-surface", "--lq-surface-raised"]) {
          expect(at(fg, v[surface]), `${fg} on ${surface} of ${bg}`).toBeGreaterThanOrEqual(AA);
        }
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("a background that can't be checked for contrast warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const background of ["#ffffff80", "rgba(20, 20, 20, 0.5)", "transparent", "not-a-color"]) {
      resolveTheme({ background });
      resolveTheme({ background });
    }
    expect(warn).toHaveBeenCalledTimes(4);
    for (const [msg] of warn.mock.calls) expect(msg).toMatch(/brand background could not be checked for contrast/);
    // An opaque background with an alpha channel is still checked.
    warn.mockClear();
    const v = resolveTheme({ background: "#777777ff" }).vars;
    expect(warn).not.toHaveBeenCalled();
    expect(contrast(rgb(v["--lq-text"]), rgb(v["--lq-surface"]))).toBeGreaterThanOrEqual(AA);
  });

  it("a brand text or muted below the floor is kept, with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const brand = { background: "#777777", text: "#555555", muted: "#6a6a6a" };
    const v = resolveTheme(brand).vars;
    expect(v["--lq-text"]).toBe("#555555");
    expect(v["--lq-text-muted"]).toBe("#6a6a6a");
    // Derived tokens still meet their floors.
    expect(contrast(rgb(v["--lq-user-bubble-text"]), rgb(v["--lq-user-bubble"]))).toBeGreaterThanOrEqual(AA);
    expect(contrast(rgb(v["--lq-text-subtle"]), rgb("#777777"))).toBeGreaterThanOrEqual(3);
    resolveTheme(brand); // re-resolving the same palette doesn't warn again
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/text.*#555555.*\d\.\d+:1/);
    expect(warn.mock.calls[1][0]).toMatch(/muted.*#6a6a6a.*\d\.\d+:1/);
  });

  it("on-accent is white on dark accents and near-black on light ones", () => {
    expect(resolveTheme({ accent: "#1e3a8a" }).vars["--lq-accent-text"]).toBe("#ffffff");
    expect(resolveTheme({ accent: "#facc15" }).vars["--lq-accent-text"]).toBe("#111111");
    expect(resolveTheme({ accent: "#fc0" }).vars["--lq-accent-text"]).toBe("#111111");
    expect(resolveTheme({}).vars["--lq-accent-text"]).toBeUndefined();
  });

  it("without a background, configured colors are not marked custom", () => {
    const r = resolveTheme({ text: "#222222", accent: "#f00" });
    expect(r.custom).toEqual([]);
    expect(r.scheme).toBeNull();
    expect(r.vars["--lq-surface-raised"]).toBeUndefined();
  });

  it("applyAppearance marks custom keys on <html> and clears derived vars when the config changes", () => {
    const el = document.documentElement;
    applyBrand({ background: "#111", accent: "#7dd3fc" }, el);
    expect(el.getAttribute(CUSTOM_ATTR)).toBe("background surface text muted");
    expect(el.style.getPropertyValue("--lq-surface-raised")).not.toBe("");
    applyBrand({}, el);
    expect(el.hasAttribute(CUSTOM_ATTR)).toBe(false);
    expect(el.style.getPropertyValue("--lq-surface-raised")).toBe("");
    expect(el.style.getPropertyValue("--lq-accent-text")).toBe("");
  });
});

describe("token cascade", () => {
  // jsdom cascades and inherits custom properties, so what the app root reads can be checked:
  // applyAppearance sets the brand on <html> inline and the theme rule matches <html> too.
  function mount(theme?: ThemeId) {
    const style = document.createElement("style");
    if (theme) style.textContent = THEME_RULES[theme];
    document.head.appendChild(style);
    const root = document.createElement("div");
    root.className = "lq-root";
    document.body.appendChild(root);
    const get = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    return { get, done: () => (style.remove(), root.remove()) };
  }
  const darkConfig = { accent: "#7dd3fc", background: "#111111", text: "#eeeeee" };

  it("configured colors persist in a dark theme", () => {
    applyBrand(darkConfig, undefined, "midnight");
    const { vars } = resolveTheme(darkConfig);
    const { get, done } = mount("midnight");
    try {
      expect(get("--lq-bg")).toBe("#111111");
      expect(get("--lq-text")).toBe("#eeeeee");
      expect(get("--lq-surface")).toBe(vars["--lq-surface"]);
      expect(get("--lq-text-muted")).toBe(vars["--lq-text-muted"]);
      expect(get("--lq-surface-raised")).toBe(vars["--lq-surface-raised"]);
      expect(get("--lq-accent-text")).toBe("#111111");
    } finally {
      done();
    }
  });

  it("a dark config in a light theme gets no white raised surface", () => {
    applyBrand(darkConfig);
    const { vars } = resolveTheme(darkConfig);
    const { get, done } = mount("graphite");
    try {
      expect(get("--lq-surface-raised")).toBe(vars["--lq-surface-raised"]);
      expect(contrast(parseColor(get("--lq-text"))!, parseColor(get("--lq-surface-raised"))!)).toBeGreaterThanOrEqual(4.5);
    } finally {
      done();
    }
  });

  it("without a configured background the tokens follow the theme", () => {
    applyBrand({ text: "#222222" }, undefined, "midnight");
    const { get, done } = mount("midnight");
    try {
      expect(get("--lq-bg")).toBe(THEME_TOKENS.midnight.bg);
      expect(get("--lq-text")).toBe(THEME_TOKENS.midnight.text);
      expect(get("--lq-text-muted")).toBe(THEME_TOKENS.midnight["text-muted"]);
      expect(get("--lq-surface-raised")).toBe(THEME_TOKENS.midnight["surface-raised"]);
    } finally {
      done();
    }
  });

  it("defaults: the tokens take the light theme's values", () => {
    applyBrand({});
    const { get, done } = mount("graphite");
    try {
      expect(get("--lq-surface-raised")).toBe(THEME_TOKENS.graphite["surface-raised"]);
      expect(get("--lq-accent-text")).toBe(THEME_TOKENS.graphite["accent-text"]);
    } finally {
      done();
    }
  });
});

describe("theme selection", () => {
  const all = { default_theme: "system" as const, themes: [...THEMES] };

  it("system maps to graphite in light and midnight in dark", () => {
    expect(resolveThemeId(undefined, all, false)).toBe("graphite");
    expect(resolveThemeId(undefined, all, true)).toBe("midnight");
    expect(resolveThemeId("system", all, true)).toBe("midnight");
    // The pair is taken among the allowed themes.
    const pair = { default_theme: "system" as const, themes: ["editorial", "graphite-dark"] as ThemeId[] };
    expect(resolveThemeId("system", pair, false)).toBe("editorial");
    expect(resolveThemeId("system", pair, true)).toBe("graphite-dark");
  });

  it("system with only light themes stays light", () => {
    const light = { default_theme: "system" as const, themes: ["graphite", "editorial"] as ThemeId[] };
    expect(resolveThemeId("system", light, true)).toBe("graphite");
    const dark = { default_theme: "system" as const, themes: ["midnight"] as ThemeId[] };
    expect(resolveThemeId("system", dark, false)).toBe("midnight");
  });

  it("an explicit pref or default theme wins over the system scheme", () => {
    expect(resolveThemeId("editorial", all, true)).toBe("editorial");
    expect(resolveThemeId(undefined, { default_theme: "graphite-dark", themes: [...THEMES] }, false)).toBe("graphite-dark");
  });

  it("a pref not in allowed themes falls back to default", () => {
    const cfg = { default_theme: "editorial" as const, themes: ["editorial", "midnight"] as ThemeId[] };
    expect(resolveThemeId("graphite", cfg, true)).toBe("editorial");
    expect(resolveThemeId("nonsense" as ThemeId, cfg, true)).toBe("editorial");
    // ... and to the system pair when the default is "system".
    expect(resolveThemeId("graphite", { default_theme: "system", themes: ["editorial", "midnight"] }, true)).toBe("midnight");
  });
});

describe("applyAppearance", () => {
  const el = () => document.documentElement;
  const v = (name: string) => el().style.getPropertyValue(name);

  it("sets the root attributes and loads the theme's fonts", () => {
    vi.mocked(loadThemeFonts).mockClear();
    applyAppearance({ theme: "midnight" }, null);
    expect(el().getAttribute("data-lq-theme")).toBe("midnight");
    expect(el().getAttribute("data-lq-scheme")).toBe("dark");
    expect(el().getAttribute("data-lq-density")).toBe("comfortable");
    expect(el().getAttribute("data-lq-text")).toBe("m");
    expect(loadThemeFonts).toHaveBeenCalledWith("midnight");
    applyAppearance({ theme: "editorial", density: "compact", text: "l" }, null);
    expect(el().getAttribute("data-lq-theme")).toBe("editorial");
    expect(el().getAttribute("data-lq-scheme")).toBe("light");
    expect(el().getAttribute("data-lq-density")).toBe("compact");
    expect(el().getAttribute("data-lq-text")).toBe("l");
    expect(loadThemeFonts).toHaveBeenLastCalledWith("editorial");
  });

  it("legacy accent applies in every theme", () => {
    for (const theme of THEMES) {
      applyAppearance({ theme }, { accent: "#e11d48" });
      expect(v("--lq-accent")).toBe("#e11d48");
      expect(v("--lq-accent-text")).toBe("#ffffff");
      expect(v("--lq-accent-hover")).toContain("#e11d48");
      expect(v("--lq-accent-soft")).toContain("#e11d48");
    }
  });

  it("legacy colors without a background apply to light themes only", () => {
    applyAppearance({ theme: "editorial" }, { text: "#222222", surface: "#fafafa" });
    expect(v("--lq-text")).toBe("#222222");
    expect(v("--lq-surface")).toBe("#fafafa");
    expect(el().getAttribute("data-lq-scheme")).toBe("light");
    applyAppearance({ theme: "midnight" }, { text: "#222222", surface: "#fafafa", radius: "4px" });
    expect(v("--lq-text")).toBe("");
    expect(v("--lq-surface")).toBe("");
    expect(v("--lq-radius-lg")).toBe("4px"); // non-color keys apply everywhere
    expect(el().getAttribute("data-lq-scheme")).toBe("dark");
  });

  it("legacy background keeps brand colors in dark themes (R25)", () => {
    const brand = { background: "#fdf6e3", accent: "#0a7d5a" };
    const resolved = resolveTheme(brand);
    for (const theme of ["midnight", "graphite-dark", "graphite"] as ThemeId[]) {
      applyAppearance({ theme }, brand);
      expect(v("--lq-bg")).toBe("#fdf6e3");
      for (const name of ["--lq-text", "--lq-text-muted", "--lq-surface", "--lq-surface-raised", "--lq-bg-subtle", "--lq-border", "--lq-user-bubble"]) {
        expect(v(name), `${name} in ${theme}`).toBe(resolved.vars[name]);
      }
      expect(el().getAttribute(CUSTOM_ATTR)).toBe("background surface text muted");
      // The brand palette fixes the scheme: a light brand background reads as light.
      expect(el().getAttribute("data-lq-scheme")).toBe("light");
    }
    applyAppearance({ theme: "graphite" }, { background: "#111111" });
    expect(el().getAttribute("data-lq-scheme")).toBe("dark");
    applyAppearance({ theme: "midnight" }, { text: "#222" });
    expect(el().getAttribute("data-lq-scheme")).toBe("dark");
  });

  it("a user accent applies over the brand accent", () => {
    applyAppearance({ theme: "graphite", accent: "#facc15" }, { accent: "#1e3a8a" });
    expect(v("--lq-accent")).toBe("#facc15");
    expect(v("--lq-accent-text")).toBe("#111111");
    expect(v("--lq-accent-hover")).toContain("#facc15");
  });

  it("locked accent overrides user accent and its derived tokens", () => {
    applyAppearance({ theme: "graphite", accent: "#facc15" }, { accent: "#1e3a8a" }, undefined, ["accent"]);
    expect(v("--lq-accent")).toBe("#1e3a8a");
    expect(v("--lq-accent-text")).toBe("#ffffff");
    expect(v("--lq-accent-hover")).toContain("#1e3a8a");
    expect(v("--lq-accent-soft")).toContain("#1e3a8a");
    expect(el().style.getPropertyPriority("--lq-accent")).toBe("important");
    expect(el().style.getPropertyPriority("--lq-accent-hover")).toBe("important");

    // Without a brand accent the theme's own accent family is locked.
    applyAppearance({ theme: "midnight", accent: "#facc15" }, null, undefined, ["accent"]);
    for (const t of ["accent", "accent-hover", "accent-soft", "accent-text"] as const) {
      expect(v(`--lq-${t}`)).toBe(THEME_TOKENS.midnight[t]);
    }

    // Unlocking clears the inline values.
    applyAppearance({ theme: "midnight" }, null);
    expect(v("--lq-accent")).toBe("");
    expect(el().style.getPropertyPriority("--lq-accent")).toBe("");
  });

  it("does not use the old lq-color-mode key", () => {
    localStorage.setItem("lq-color-mode", "dark");
    applyAppearance({ theme: "graphite" }, null);
    expect(el().getAttribute("data-lq-scheme")).toBe("light");
    localStorage.clear();
  });
});
