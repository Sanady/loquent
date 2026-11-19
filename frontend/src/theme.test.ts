import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readStoredMode, storeMode, systemMode } from "./theme";

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
