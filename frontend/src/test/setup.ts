import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-lq-custom-colors");
  try {
    localStorage.clear();
  } catch {
    /* storage unavailable */
  }
});
