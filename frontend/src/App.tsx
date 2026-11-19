import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { IconArrowDown, IconX } from "./components/icons";
import { Login } from "./components/Login";
import { MessageList } from "./components/MessageList";
import { ThreadList } from "./components/ThreadList";
import { appStore, type AppStore } from "./state/store";
import { StoreProvider, useApp, useAppStore } from "./storeContext";
import { applyTheme, useColorMode } from "./theme";

const NAV_ID = "lq-nav";
const NARROW = "(max-width: 720px)";
const NEAR_BOTTOM_PX = 96;

function useMediaQuery(query: string): boolean {
  const get = () => {
    try {
      return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    let q: MediaQueryList;
    try {
      if (typeof window.matchMedia !== "function") return;
      q = window.matchMedia(query);
    } catch {
      return;
    }
    if (typeof q.addEventListener !== "function") return;
    const on = () => setMatches(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [query]);
  return matches;
}

function Notice() {
  const store = useAppStore();
  const notice = useApp((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => store.setState({ notice: null }), 8000);
    return () => clearTimeout(t);
  }, [notice, store]);
  if (!notice) return null;
  return (
    <div className="lq-notice" role="status">
      <span>{notice}</span>
      <button type="button" className="lq-icon-btn lq-icon-btn-sm" aria-label="Dismiss" onClick={() => store.setState({ notice: null })}>
        <IconX />
      </button>
    </div>
  );
}

function Chat({ mode, onToggleMode }: { mode: "light" | "dark"; onToggleMode: () => void }) {
  const store = useAppStore();
  const showThreads = useApp((s) => !(s.config?.hide ?? []).includes("thread_list"));
  const items = useApp((s) => s.view.items);
  const threadId = useApp((s) => s.currentThreadId);
  const narrow = useMediaQuery(NARROW);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navOpen = showThreads && (narrow ? drawerOpen : !collapsed);

  const scroller = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setAtBottom(true);
    if (smooth && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  // Follow streaming output while the reader is at the bottom; leave them alone once they scroll up.
  useLayoutEffect(() => {
    if (stick.current) toBottom();
  }, [items, toBottom]);
  useLayoutEffect(() => toBottom(), [threadId, toBottom]);
  useEffect(
    () =>
      store.subscribe((s, prev) => {
        if (s.starting && !prev.starting) toBottom();
      }),
    [store, toBottom],
  );

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stick.current = near;
    setAtBottom(near);
  }, []);

  // Content can grow without new items (images, math, expanded rows): keep following while a
  // run streams, otherwise just refresh whether the reader is at the bottom.
  const following = useApp((s) => s.view.run === "running" || s.starting);
  useEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (following && stick.current) el.scrollTop = el.scrollHeight;
      else onScroll();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [following, onScroll]);

  // Narrow drawer: move focus into it on open; Escape closes it.
  useEffect(() => {
    if (!(narrow && drawerOpen)) return;
    document.querySelector<HTMLElement>(`#${NAV_ID} button`)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, drawerOpen]);

  const layout = ["lq-layout", showThreads ? "has-nav" : "no-nav", navOpen ? "nav-open" : "nav-closed", narrow ? "is-narrow" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={layout}>
      {showThreads && (
        <div className="lq-nav-wrap" inert={!navOpen}>
          <ThreadList
            id={NAV_ID}
            onNavigate={() => narrow && setDrawerOpen(false)}
            onClose={narrow ? () => setDrawerOpen(false) : undefined}
          />
        </div>
      )}
      {showThreads && narrow && drawerOpen && <div className="lq-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}
      <div className="lq-main">
        <Header
          navId={showThreads ? NAV_ID : null}
          navOpen={navOpen}
          onToggleNav={() => (narrow ? setDrawerOpen((o) => !o) : setCollapsed((c) => !c))}
          mode={mode}
          onToggleMode={onToggleMode}
        />
        <Notice />
        <main className="lq-conversation" ref={scroller} onScroll={onScroll}>
          <div className="lq-column">
            <MessageList />
          </div>
        </main>
        <div className="lq-dock">
          {!atBottom && (
            <button type="button" className="lq-jump" aria-label="Scroll to latest" onClick={() => toBottom(true)}>
              <IconArrowDown />
            </button>
          )}
          <div className="lq-column">
            <Composer />
          </div>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const store = useAppStore();
  const config = useApp((s) => s.config);
  const needsLogin = useApp((s) => s.config?.auth === "password" && s.user === null);
  const [loaded, setLoaded] = useState(false);
  const [mode, toggleMode] = useColorMode();

  const load = useCallback(() => {
    setLoaded(false);
    void store
      .getState()
      .init()
      .finally(() => setLoaded(true));
  }, [store]);

  useEffect(load, [load]);
  useEffect(() => applyTheme(config?.theme), [config?.theme]);
  useEffect(() => {
    if (config?.app_name) document.title = config.app_name;
  }, [config?.app_name]);

  let body;
  if (!config) {
    body = loaded ? (
      <main className="lq-fatal">
        <h1>Can’t reach the server</h1>
        <p>Check your connection and try again.</p>
        <button type="button" className="lq-btn lq-btn-primary" onClick={load}>
          Try again
        </button>
      </main>
    ) : (
      <div className="lq-boot" aria-busy="true" />
    );
  } else if (needsLogin) {
    body = <Login />;
  } else {
    body = <Chat mode={mode} onToggleMode={toggleMode} />;
  }

  return (
    <div className="lq-root" data-mode={mode}>
      {body}
    </div>
  );
}

export function App({ store = appStore }: { store?: AppStore }) {
  return (
    <StoreProvider store={store}>
      <Shell />
    </StoreProvider>
  );
}
