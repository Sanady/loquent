/**
 * The styling contract: stable part names, state attributes and token names that developer
 * and user CSS (and later plugins) target. It is semver-governed: removing or renaming
 * anything here is a breaking change and needs a major bump of STYLE_CONTRACT_VERSION;
 * adding something is a minor bump. contract.test.ts compares this against
 * __snapshots__/contract.json and fails until the version and the snapshot are updated.
 */
import { COLOR_TOKENS } from "./themes";

export const STYLE_CONTRACT_VERSION = "1.0.0";

/** The documented selector form for a part; `data-lq-part` is a token list, so `~=`. */
export const PART_SELECTOR = '[data-lq-part~="<name>"]';

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

export type StateValue = "streaming" | "running" | "done" | "error";
export const ROLES = ["user", "assistant"] as const;
export type RoleValue = (typeof ROLES)[number];

/**
 * The element each part lands on, with the state attributes it may carry. `data-lq-part` is a
 * space-separated token list, like `class`: target it with `[data-lq-part~="name"]`, never `=`.
 * Composite parts put a generic and a kind token on one element (`activity activity-tool`).
 * Messages differ: the row is `message` (with `data-lq-role`), and the content inside it is
 * `message-user` (the bubble) or `message-assistant` (the body), because one element cannot be
 * both the row and its content without changing the layout.
 */
export const PART_TARGETS: Record<PartName, string> = {
  app: "The root element of the whole UI, including the login screen.",
  sidebar: "The chats nav.",
  "sidebar-header": "The top of the sidebar: the brand (logo and app name, plus the close button when narrow) above new-chat.",
  "new-chat": "The New chat button in the sidebar.",
  "thread-list": "The scrolling container of thread groups. Also holds the empty hint.",
  "thread-item": "One thread row (viewing, renaming or confirming delete). data-lq-active=true on the current thread.",
  main: "The column holding header, conversation and composer.",
  header: "The top bar.",
  "header-title": "The header title: the open thread's title, or the app name when no thread is open or it has no title.",
  "header-actions": "The group of header buttons.",
  conversation: "The scrolling conversation region.",
  "empty-state": "The greeting shown when the thread has no items. Absent otherwise.",
  message: "A message row, user or assistant. data-lq-role=user|assistant; assistant rows carry data-lq-state=streaming|done.",
  "message-user": "The user's text bubble inside a user message row. Absent for attachments-only messages.",
  "message-assistant": "The assistant's body (markdown, or the typing indicator) inside an assistant message row.",
  "message-actions": "The action bar under a finished assistant message. Absent while streaming or empty.",
  markdown: "The rendered markdown container of an assistant message.",
  "code-block": "A fenced code block, including its header bar.",
  activity: "One step or tool row (same element as activity-step or activity-tool). data-lq-state=running|done|error (error is reserved; not emitted yet).",
  "activity-step": "Kind token on the activity row for a step.",
  "activity-tool": "Kind token on the activity row for a tool call.",
  widget: "Every widget element, including the pending and fallback placeholders. Kind tokens widget-confirm|widget-select|widget-form sit on the same element once rendered.",
  "widget-confirm": "Kind token on the widget element for a confirm widget.",
  "widget-select": "Kind token on the widget element for a select widget.",
  "widget-form": "Kind token on the widget element for a form widget.",
  error: "An error item in the conversation. data-lq-state=error.",
  composer: "The composer card: the visible box around the pending files, the input and its buttons (inside the message form).",
  "composer-input": "The message textarea.",
  "composer-attach": "The attach button. Absent when attachments are disabled.",
  "composer-send": "The send button, or the stop button while a run is active (then data-lq-state=running).",
  attachment: "An attachment chip in a message. data-lq-state=error when it could not be opened.",
  "appearance-panel": "The appearance settings region. Conditional: only while the panel is open.",
  login: "The sign-in screen. Conditional: only in password mode without a user.",
  drawer: "Alias on the sidebar wrapper (the element around sidebar). Conditional: only on narrow screens with the drawer open.",
};

interface PartExtra {
  state?: StateValue;
  role?: RoleValue;
  active?: "true";
}

/**
 * Spread onto an element: `<div {...part("message", { role: "user" })}>`. Pass an array for
 * several tokens: `part(["activity", "activity-tool"])`. Extras become `data-lq-<key>`;
 * undefined values are skipped.
 */
export function part(names: PartName | readonly PartName[], extra: PartExtra = {}): Record<string, string> {
  const attrs: Record<string, string> = { "data-lq-part": typeof names === "string" ? names : names.join(" ") };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) attrs[`data-lq-${k}`] = v;
  return attrs;
}
