/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Our own stylesheets under src/ (never anything in node_modules). */
const OWN_CSS = /^(?!.*\/node_modules\/).*\/src\/(?:styles\.css|styles\/.+\.css|fonts\/.+\.css)/;

export default defineConfig({
  base: "./",
  plugins: [react()],
  // assetsInlineLimit 0: the server CSP has no data: in font-src, so KaTeX fonts must be files.
  build: { outDir: "../src/loquent/server/static", emptyOutDir: true, assetsInlineLimit: 0 },
  server: { proxy: { "/api": "http://127.0.0.1:8000", "/branding": "http://127.0.0.1:8000" } },
  // css.include: theme tests read the real src/styles.css, src/styles/**/*.css and src/fonts/*.css (?raw)
  // to check tokens and the custom-property cascade; vitest blanks any CSS not listed here. OWN_CSS is
  // anchored to src/ and excludes node_modules (e.g. highlight.js/styles/*.css) so only our CSS is processed.
  // include: keep Playwright specs in e2e/ out of vitest.
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "jsdom", globals: false, setupFiles: ["src/test/setup.ts"], css: { include: [OWN_CSS] } },
});
