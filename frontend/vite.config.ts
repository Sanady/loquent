/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // assetsInlineLimit 0: the server CSP has no data: in font-src, so KaTeX fonts must be files.
  build: { outDir: "../src/loquent/server/static", emptyOutDir: true, assetsInlineLimit: 0 },
  server: { proxy: { "/api": "http://127.0.0.1:8000", "/branding": "http://127.0.0.1:8000" } },
  // css.include: theme tests read the real styles.css and styles/**/*.css (?raw) to check tokens
  // and the custom-property cascade; vitest blanks any CSS not listed here.
  // include: keep Playwright specs in e2e/ out of vitest.
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "jsdom", globals: false, setupFiles: ["src/test/setup.ts"], css: { include: [/styles\.css/, /styles\/.+\.css/] } },
});
