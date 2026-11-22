import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-lq-custom-colors");
  // Opening a thread writes #t=<id>; a later test's store would reopen it on init.
  if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    localStorage.clear();
  } catch {
    /* storage unavailable */
  }
});
