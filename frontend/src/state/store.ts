import { createStore, type StoreApi } from "zustand/vanilla";
import {
  api as defaultApi,
  ApiError,
  type Api,
  type AppConfig,
  type RunBody,
  type RunStatus,
  type ThreadSummary,
  type User,
} from "../api/client";
import { applyEvent, applyEvents, emptyView, type AgUiEvent, type Attachment, type RunState, type ThreadView } from "./reducer";

const POLL_MS = 1000;
const POLL_MAX_MS = 10000;
const POLL_FAIL_NOTICE = 5;
const DELETE_WAIT_MS = 30000;

const MESSAGES: Record<string, string> = {
  run_in_progress: "A reply is already in progress.",
  invalid_answer: "That answer is no longer valid.",
  invalid_input: "That request could not be processed.",
  unauthorized: "Please sign in again.",
  csrf: "Your session expired. Please reload the page.",
  rate_limited: "Too many requests. Please wait a moment.",
  unsupported_media_type: "That file type is not supported.",
  payload_too_large: "That file is too large.",
  not_found: "That conversation no longer exists.",
};

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Please try again.";
}

export interface AppState {
  config: AppConfig | null;
  user: User | null;
  authError: string | null;
  threads: ThreadSummary[];
  currentThreadId: string | null;
  view: ThreadView;
  notice: string | null;
  /** True while a run is being started (upload or POST in flight, before the first event). */
  starting: boolean;

  init(): Promise<void>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshThreads(): Promise<void>;
  renameThread(id: string, title: string): Promise<void>;
  deleteThread(id: string): Promise<void>;
  openThread(id: string): Promise<void>;
  newThread(): void;
  /** send/answer/regenerate resolve true if a run was started, false if refused or it did not start. */
  send(text: string, files: (File | Attachment)[]): Promise<boolean>;
  answer(toolCallId: string, value: unknown): Promise<boolean>;
  regenerate(): Promise<boolean>;
  stop(): Promise<void>;
}

export type AppStore = StoreApi<AppState>;

const isTerminal = (s: RunStatus) => s !== "running";
const runFromStatus = (s: RunStatus): RunState =>
  s === "running" ? "running" : s === "interrupted" ? "interrupted" : s === "failed" ? "failed" : s === "cancelled" ? "cancelled" : "idle";

const MAX_QUERY_KEYS = 20;
const MAX_QUERY_BYTES = 1024;

/** Keep the first 20 entries and drop any whose key or value exceeds 1024 UTF-8 bytes (server limits). */
export function trimPageQuery(entries: Iterable<[string, string]>): Record<string, string> {
  const enc = new TextEncoder();
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of entries) {
    if (n >= MAX_QUERY_KEYS) break;
    if (enc.encode(k).length > MAX_QUERY_BYTES || enc.encode(v).length > MAX_QUERY_BYTES) continue;
    out[k] = v;
    n++;
  }
  return out;
}

function defaultPageQuery(): Record<string, string> {
  try {
    return trimPageQuery(new URLSearchParams(window.location.search).entries());
  } catch {
    return {};
  }
}

export function createAppStore(
  api: Api = defaultApi,
  opts: { pageQuery?: () => Record<string, string> } = {},
): AppStore {
  const pageQuery = () => trimPageQuery(Object.entries((opts.pageQuery ?? defaultPageQuery)()));
  // Bumped whenever the visible thread changes; stale consumers stop touching the view.
  let gen = 0;
  let abort: AbortController | null = null;
  // Single-run invariant: token of the send/answer/regenerate flow currently starting or running.
  let runToken = 0;
  let busyToken: number | null = null;

  const store = createStore<AppState>()((set, get) => {
    const setView = (fn: (v: ThreadView) => ThreadView) => set((s) => ({ view: fn(s.view) }));
    const pushError = (message: string, code?: string) =>
      setView((v) => ({ ...v, items: [...v.items, code ? { kind: "error", message, code } : { kind: "error", message }] }));

    const fail = (e: unknown, myGen: number) => {
      if (myGen !== gen) return;
      if (e instanceof ApiError) {
        if (e.status === 401) set({ user: null });
        pushError(errorMessage(e.code), e.code);
      } else {
        pushError(errorMessage(""));
      }
    };

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    function finalize(status: RunStatus) {
      setView((v) => {
        if (v.run !== "running") return v;
        const run = runFromStatus(status);
        if (status === "failed") return { ...v, run, items: [...v.items, { kind: "error", message: "The run failed." }] };
        return { ...v, run };
      });
    }

    async function poll(runId: string, myGen: number) {
      const stale = () => myGen !== gen || get().view.runId !== runId;
      const abandon = (run: RunState) =>
        setView((v) => (v.runId === runId && v.run === "running" ? { ...v, run } : v));
      let delay = POLL_MS;
      let failures = 0;
      for (;;) {
        await sleep(delay);
        if (stale()) return;
        let res;
        try {
          res = await api.runEvents(runId, get().view.lastSeq);
        } catch (e) {
          if (stale()) return;
          if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
            if (e.status === 401) set({ user: null });
            abandon("interrupted");
            return;
          }
          failures++;
          delay = Math.min(delay * 2, POLL_MAX_MS);
          if (failures === POLL_FAIL_NOTICE) pushError("Connection lost.");
          continue;
        }
        if (stale()) return;
        failures = 0;
        delay = POLL_MS;
        setView((v) => res.events.reduce((acc, x) => applyEvent(acc, x.event, x.seq), v));
        if (isTerminal(res.status)) {
          finalize(res.status);
          return;
        }
      }
    }

    /** Resolves true once the server accepted the run (first event received). */
    async function consume(body: RunBody, myGen: number, ac: AbortController, release: () => void): Promise<boolean> {
      let terminal = false;
      let first = true;
      try {
        for await (const { seq, event } of api.startRun(body, ac.signal)) {
          if (myGen !== gen || ac.signal.aborted) return false;
          if (first) {
            // The server accepted the run: only now start a fresh seq space.
            first = false;
            set({ starting: false });
            setView((v) => ({ ...v, lastSeq: 0, runId: undefined }));
          }
          setView((v) => applyEvent(v, event, seq));
          if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") terminal = true;
          const tid = (event as { threadId?: string }).threadId;
          if (event.type === "RUN_STARTED" && tid && get().currentThreadId === null) set({ currentThreadId: tid });
        }
      } catch (e) {
        if (myGen !== gen || ac.signal.aborted) return false;
        if (e instanceof ApiError) {
          fail(e, myGen);
          return false;
        }
        // anything else is a dropped connection: fall through to polling
      }
      if (myGen !== gen || ac.signal.aborted) return !first;
      if (!terminal) {
        const runId = get().view.runId;
        if (runId && !first) await poll(runId, myGen);
        else pushError("Connection lost. Please try again.");
      }
      release(); // the run is over: sends are allowed again before the list refresh
      if (myGen === gen) await get().refreshThreads();
      return !first;
    }

    type Flow = (myGen: number, threadId: string | null, ac: AbortController, release: () => void) => Promise<boolean>;

    /** Run a start flow exclusively. A second start while one is starting or running is a refused no-op (false). */
    async function exclusive(fn: Flow): Promise<boolean> {
      if (busyToken !== null || get().view.run === "running") return false;
      const token = ++runToken;
      busyToken = token;
      const ac = new AbortController();
      abort = ac;
      set({ starting: true });
      const release = () => {
        if (busyToken === token) {
          busyToken = null;
          set({ starting: false });
        }
      };
      try {
        return await fn(gen, get().currentThreadId, ac, release);
      } finally {
        release();
      }
    }

    const startRunFlow =
      (input: RunBody["input"]): Flow =>
      (myGen, threadId, ac, release) =>
        consume({ thread_id: threadId, input, page_query: pageQuery() }, myGen, ac, release);

    async function waitNotRunning(id: string): Promise<void> {
      if (get().currentThreadId === id) {
        await new Promise<void>((resolve) => {
          if (get().view.run !== "running") return resolve();
          const timer = setTimeout(done, DELETE_WAIT_MS);
          const unsub = store.subscribe((s) => {
            if (s.currentThreadId !== id || s.view.run !== "running") done();
          });
          function done() {
            clearTimeout(timer);
            unsub();
            resolve();
          }
        });
        if (get().currentThreadId === id) return;
      }
      // The user switched away: watch the thread itself.
      for (let waited = 0; waited < DELETE_WAIT_MS; waited += POLL_MS) {
        try {
          const d = await api.thread(id);
          if (d.last_run?.status !== "running") return;
        } catch {
          return;
        }
        await sleep(POLL_MS);
      }
    }

    return {
      config: null,
      user: null,
      authError: null,
      threads: [],
      currentThreadId: null,
      view: emptyView(),
      notice: null,
      starting: false,

      async init() {
        try {
          const config = await api.config();
          set({ config });
          const me = await api.me();
          set({ user: me.user });
          await get().refreshThreads();
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) set({ user: null });
        }
      },

      async login(username, password) {
        try {
          const r = await api.login(username, password);
          set({ user: r.user, authError: null });
          await get().refreshThreads();
        } catch (e) {
          set({ authError: e instanceof ApiError && e.status === 401 ? "Invalid username or password." : errorMessage(e instanceof ApiError ? e.code : "") });
        }
      },

      async logout() {
        try {
          await api.logout();
        } catch {
          /* session is gone either way */
        }
        gen++;
        busyToken = null;
        abort?.abort();
        set({ user: null, threads: [], currentThreadId: null, view: emptyView(), starting: false });
      },

      async refreshThreads() {
        try {
          set({ threads: await api.threads() });
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) set({ user: null });
        }
      },

      async renameThread(id, title) {
        try {
          await api.renameThread(id, title);
          await get().refreshThreads();
        } catch (e) {
          set({ notice: e instanceof ApiError ? errorMessage(e.code) : errorMessage("") });
        }
      },

      async deleteThread(id) {
        const isCurrent = get().currentThreadId === id;
        if (isCurrent && get().view.run === "running") {
          await get().stop();
          await waitNotRunning(id);
        } else if (!isCurrent) {
          try {
            const lr = (await api.thread(id)).last_run;
            if (lr?.status === "running") {
              await api.cancel(lr.id);
              await waitNotRunning(id);
            }
          } catch {
            /* let the delete itself report any problem */
          }
        }
        try {
          await api.deleteThread(id);
        } catch (e) {
          const code = e instanceof ApiError ? e.code : "";
          if (e instanceof ApiError && e.status === 401) set({ user: null });
          if (get().currentThreadId === id) pushError(errorMessage(code), code || undefined);
          else set({ notice: errorMessage(code) });
          return;
        }
        if (get().currentThreadId === id) get().newThread();
        await get().refreshThreads();
      },

      async openThread(id) {
        const myGen = ++gen;
        abort?.abort();
        const token = ++runToken;
        busyToken = token; // hold the guard while the thread loads
        const unhold = () => {
          if (busyToken === token) busyToken = null;
        };
        set({ currentThreadId: id, view: emptyView(), starting: false });
        let detail;
        try {
          detail = await api.thread(id);
        } catch (e) {
          unhold();
          fail(e, myGen);
          return;
        }
        unhold();
        if (myGen !== gen) return;
        let view = applyEvents(emptyView(), detail.events);
        const lr = detail.last_run;
        if (lr) view = { ...view, runId: lr.id, lastSeq: lr.last_seq, run: runFromStatus(lr.status) };
        set({ view });
        if (lr?.status === "running") {
          // Detached: opening a thread must not block on the run finishing.
          void poll(lr.id, myGen).then(() => (myGen === gen ? get().refreshThreads() : undefined));
        }
      },

      newThread() {
        gen++;
        busyToken = null;
        abort?.abort();
        set({ currentThreadId: null, view: emptyView(), starting: false });
      },

      send: (text, files) =>
        exclusive(async (myGen, threadId, ac, release) => {
          let ids: string[];
          try {
            ids = await Promise.all(files.map(async (f) => (f instanceof File ? (await api.upload(f)).id : f.id)));
          } catch (e) {
            if (!ac.signal.aborted) fail(e, myGen);
            return false;
          }
          if (myGen !== gen || ac.signal.aborted || get().currentThreadId !== threadId) return false;
          return startRunFlow({ type: "message", content: text, attachments: ids })(myGen, threadId, ac, release);
        }),

      answer: (toolCallId, value) =>
        exclusive(startRunFlow({ type: "tool_result", tool_call_id: toolCallId, answer: value })),
      regenerate: () => exclusive(startRunFlow({ type: "regenerate" })),

      async stop() {
        if (get().starting) {
          // Still starting: abort the pending upload/POST and free the guard.
          abort?.abort();
          busyToken = null;
          set({ starting: false });
          return;
        }
        const { runId, run: state } = get().view;
        if (!runId || state !== "running") return;
        try {
          await api.cancel(runId); // keep consuming: the terminal event arrives via stream or polling
        } catch (e) {
          fail(e, gen);
        }
      },
    };
  });
  return store;
}

export const appStore = createAppStore();

export type { AgUiEvent };
