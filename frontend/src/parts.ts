/**
 * The styling contract: stable part names, state attributes and token names that developer
 * and user CSS (and later plugins) target. It is semver-governed: removing or renaming
 * anything here is a breaking change and needs a major bump of STYLE_CONTRACT_VERSION;
 * adding something is a minor bump. contract.test.ts compares this against
 * __snapshots__/contract.json and fails until the version and the snapshot are updated.
 */
import { COLOR_TOKENS } from "./themes";

export const STYLE_CONTRACT_VERSION = "1.0.0";

export const PARTS = [
  "app",
  "sidebar",
  "sidebar-header",
  "new-chat",
  "thread-list",
  "thread-item",
  "main",
  "header",
  "header-title",
  "header-actions",
  "conversation",
  "empty-state",
  "message",
  "message-user",
  "message-assistant",
  "message-actions",
  "markdown",
  "code-block",
  "activity",
  "activity-step",
  "activity-tool",
  "widget",
  "widget-confirm",
  "widget-select",
  "widget-form",
  "error",
  "composer",
  "composer-input",
  "composer-attach",
  "composer-send",
  "attachment",
  "appearance-panel",
  "login",
  "drawer",
] as const;
export type PartName = (typeof PARTS)[number];

/** Scale tokens (`--lq-<name>`), defined in styles/tokens.css. Colors come from COLOR_TOKENS. */
export const SCALE_TOKENS = [
  "font-body",
  "font-display",
  "font-mono",
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "leading-tight",
  "leading-normal",
  "space-1",
  "space-2",
  "space-3",
  "space-4",
  "space-5",
  "space-6",
  "space-7",
  "space-8",
  "space-9",
  "space-10",
  "radius-sm",
  "radius-md",
  "radius-lg",
  "radius-xl",
  "radius-pill",
  "shadow-1",
  "shadow-2",
  "shadow-3",
  "duration-fast",
  "duration-normal",
  "ease",
  "content-width",
  "sidebar-width",
] as const;

export const CONTRACT_TOKENS: readonly string[] = [...COLOR_TOKENS, ...SCALE_TOKENS];

/** State attributes and their values, as `attribute=value`. */
export const STATES = [
  "data-lq-state=streaming",
  "data-lq-state=running",
  "data-lq-state=done",
  "data-lq-state=error",
  "data-lq-role=user",
  "data-lq-role=assistant",
  "data-lq-active=true",
] as const;

/**
 * Spread onto an element: `<div {...part("message", { role: "user" })}>`. Each extra key
 * becomes `data-lq-<key>`; undefined values are skipped.
 */
export function part(name: PartName, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const attrs: Record<string, string> = { "data-lq-part": name };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) attrs[`data-lq-${k}`] = v;
  return attrs;
}
