import type { AgUiEvent, Attachment } from "../state/reducer";
import { parseSSE } from "./sse";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

export interface AppConfig {
  app_name: string;
  logo_url: string | null;
  theme: Record<string, string>;
  hide: string[];
  auth: string;
  widgets: boolean;
  attachments: boolean;
  max_upload_mb: number;
}
export interface User {
  id?: string;
  username?: string;
  [k: string]: unknown;
}
export interface ThreadSummary {
  id: string;
  title: string;
  updated_at: string;
}
export type RunStatus = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface ThreadDetail {
  thread: ThreadSummary & { created_at?: string };
  events: AgUiEvent[];
  last_run: { id: string; status: RunStatus; last_seq: number } | null;
}
export type RunInput =
  | { type: "message"; content: string; attachments: string[] }
  | { type: "tool_result"; tool_call_id: string; answer: unknown }
  | { type: "regenerate" };
export interface RunBody {
  thread_id: string | null;
  input: RunInput;
  page_query: Record<string, string>;
}
export interface RunEvents {
  status: RunStatus;
  events: { seq: number; event: AgUiEvent }[];
}
export interface StreamedEvent {
  seq: number;
  event: AgUiEvent;
}

let csrf = "";
/** The CSRF header value. The server only needs the header present in auth "none" (no token). */
const csrfHeader = () => csrf || "1";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-Loquent-CSRF"] = csrfHeader();
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function toError(res: Response): Promise<ApiError> {
  let code = "http_error";
  try {
    const j = await res.json();
    if (j && typeof j.error === "string") code = j.error;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, code);
}

const enc = encodeURIComponent;

export const api = {
  config: () => request<AppConfig>("GET", "api/config"),
  async login(username: string, password: string) {
    const r = await request<{ user: User; csrf: string }>("POST", "api/auth/login", { username, password });
    csrf = r.csrf ?? "";
    return r;
  },
  logout: () => request<{ ok: boolean }>("POST", "api/auth/logout"),
  async me() {
    const r = await request<{ user: User; csrf: string }>("GET", "api/auth/me");
    csrf = r.csrf ?? "";
    return r;
  },
  threads: () => request<ThreadSummary[]>("GET", "api/threads"),
  thread: (id: string) => request<ThreadDetail>("GET", `api/threads/${enc(id)}`),
  renameThread: (id: string, title: string) =>
    request<ThreadSummary>("PATCH", `api/threads/${enc(id)}`, { title }),
  deleteThread: (id: string) => request<void>("DELETE", `api/threads/${enc(id)}`),
  runEvents: (id: string, after: number) =>
    request<RunEvents>("GET", `api/runs/${enc(id)}/events?after=${after}`),
  cancel: (id: string) => request<{ ok: boolean }>("POST", `api/runs/${enc(id)}/cancel`),
  async upload(file: File): Promise<Attachment> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("api/files", { method: "POST", headers: { "X-Loquent-CSRF": csrfHeader() }, body: form });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as Attachment;
  },
  fileUrl: (id: string) => request<{ url: string }>("GET", `api/files/${enc(id)}/url`),

  /** Start a run; yields live SSE events. Throws ApiError on non-2xx. */
  async *startRun(body: RunBody, signal?: AbortSignal): AsyncIterable<StreamedEvent> {
    const res = await fetch("api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Loquent-CSRF": csrfHeader() },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await toError(res);
    if (!res.body) throw new Error("empty response body");
    let n = 0;
    for await (const f of parseSSE(res.body)) {
      n = f.id ?? n + 1;
      yield { seq: n, event: f.data as AgUiEvent };
    }
  },
};

export type Api = typeof api;
