import { vi, type Mock } from "vitest";
import type { Api, AppConfig } from "../api/client";
import { createAppStore, type AppState, type AppStore } from "../state/store";
import { emptyView, type Item, type ThreadView } from "../state/reducer";

export const defaultConfig = (over: Partial<AppConfig> = {}): AppConfig => ({
  app_name: "Chat",
  logo_url: null,
  theme: {},
  hide: [],
  auth: "none",
  widgets: false,
  attachments: false,
  max_upload_mb: 20,
  allowed_upload_types: ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json"],
  default_theme: "system",
  themes: ["graphite", "graphite-dark", "editorial", "midnight"],
  allow_user_css: true,
  allow_user_prefs: true,
  lock_tokens: [],
  max_user_css_kb: 64,
  ...over,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeApi = Api & { [K in keyof Api]: Mock<any> };

export function fakeApi(config: AppConfig = defaultConfig(), over: Partial<Record<keyof Api, unknown>> = {}): FakeApi {
  const base = {
    config: vi.fn(async () => config),
    login: vi.fn(async () => ({ user: { id: "u" }, csrf: "c" })),
    logout: vi.fn(async () => ({ ok: true })),
    me: vi.fn(async () => ({ user: { id: "u" }, csrf: "" })),
    threads: vi.fn(async () => []),
    thread: vi.fn(),
    renameThread: vi.fn(async () => ({})),
    deleteThread: vi.fn(async () => undefined),
    runEvents: vi.fn(),
    cancel: vi.fn(async () => ({ ok: true })),
    upload: vi.fn(),
    fileUrl: vi.fn(async (id: string) => ({ url: `https://files.test/${id}?sig=1` })),
    startRun: vi.fn(),
  };
  return { ...base, ...over } as never;
}

/** A store already "initialised" with config and a user, without running init(). */
export function readyStore(state: Partial<AppState> = {}, api: FakeApi = fakeApi()): AppStore {
  const s = createAppStore(api, { pageQuery: () => ({}) });
  s.setState({ config: defaultConfig(), user: { id: "u" }, ...state });
  return s;
}

export function view(items: Item[], run: ThreadView["run"] = "idle"): ThreadView {
  return { ...emptyView(), items, run };
}

export const userMsg = (id: string, text: string, extra: Partial<Extract<Item, { kind: "message" }>> = {}): Item => ({
  kind: "message",
  id,
  role: "user",
  text,
  attachments: [],
  streaming: false,
  ...extra,
});

export const botMsg = (id: string, text: string, streaming = false): Item => ({
  kind: "message",
  id,
  role: "assistant",
  text,
  attachments: [],
  streaming,
});
