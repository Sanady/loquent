import type { ThemeId } from "./themes";

/**
 * Self-hosted theme fonts (SIL OFL; the page CSP is default-src 'self', so no Google Fonts).
 * Each font is its own dynamic import so Vite emits a separate CSS chunk and woff2 assets;
 * a theme only downloads the fonts it uses. The CSS files declare the latin and latin-ext
 * subsets only, and `font-display: swap` keeps text visible while a face loads.
 */
type FontId = "inter" | "newsreader" | "geist" | "jetbrains-mono";

const FONT_LOADERS: Record<FontId, () => Promise<unknown>> = {
  inter: () => import("./fonts/inter.css"),
  newsreader: () => import("./fonts/newsreader.css"),
  geist: () => import("./fonts/geist.css"),
  "jetbrains-mono": () => import("./fonts/jetbrains-mono.css"),
};

const THEME_FONTS: Record<ThemeId, readonly FontId[]> = {
  graphite: ["inter", "jetbrains-mono"],
  "graphite-dark": ["inter", "jetbrains-mono"],
  editorial: ["newsreader", "inter", "jetbrains-mono"],
  midnight: ["geist", "jetbrains-mono"],
};

const loading = new Map<FontId, Promise<unknown>>();

function loadFont(font: FontId): Promise<unknown> {
  let p = loading.get(font);
  if (!p) {
    p = FONT_LOADERS[font]().catch((err) => {
      loading.delete(font); // allow a retry after a transient network failure
      throw err;
    });
    loading.set(font, p);
  }
  return p;
}

/** Loads the font CSS (and, on use, the woff2 files) for a theme; memoised per font. */
export async function loadThemeFonts(theme: ThemeId): Promise<void> {
  await Promise.all(THEME_FONTS[theme].map(loadFont));
}
