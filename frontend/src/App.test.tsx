import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { loadThemeFonts } from "./fonts";
import { createAppStore } from "./state/store";
import { botMsg, defaultConfig, fakeApi, readyStore, userMsg, view } from "./test/helpers";

vi.mock("./fonts", () => ({ loadThemeFonts: vi.fn(async () => {}) }));

const threads = [
  { id: "t1", title: "First chat", updated_at: new Date().toISOString() },
  { id: "t2", title: "Second chat", updated_at: new Date().toISOString() },
];

async function renderApp(config = defaultConfig(), over = {}) {
  const api = fakeApi(config, { threads: vi.fn(async () => threads), ...over });
  const store = createAppStore(api, { pageQuery: () => ({}) });
  const utils = render(<App store={store} />);
  await screen.findByRole("form", { name: /message/i });
  return { ...utils, store, api };
}

describe("App", () => {
  it('no "Loquent" text rendered with default config', async () => {
    const { container } = await renderApp();
    await screen.findByText("First chat");
    expect(container.textContent ?? "").not.toMatch(/loquent/i);
    expect(container.innerHTML).not.toMatch(/loquent/i);
    expect(document.title).not.toMatch(/loquent/i);
    // With no thread open, the header shows the configured name.
    expect(screen.getByRole("banner").textContent).toContain("Chat");
  });

  it("the sidebar shows the configured logo and app name; the header the open thread's title", async () => {
    const { api } = await renderApp(defaultConfig({ app_name: "Acme Assistant", logo_url: "branding/logo" }));
    const nav = screen.getByRole("navigation", { name: /chats/i });
    const brand = nav.querySelector('[data-lq-part~="sidebar-header"]')!;
    expect(brand.textContent).toContain("Acme Assistant");
    expect(brand.querySelector("img")?.getAttribute("src")).toBe("branding/logo");
    expect(document.title).toBe("Acme Assistant");

    // No thread open: the header title falls back to the app name.
    const title = () => screen.getByRole("banner").querySelector('[data-lq-part~="header-title"]')!.textContent;
    expect(title()).toBe("Acme Assistant");
    fireEvent.click(await screen.findByRole("button", { name: "Second chat" }));
    await vi.waitFor(() => expect(title()).toBe("Second chat"));
    // Let the thread load settle inside the test, so nothing resolves after it ends.
    await vi.waitFor(() => expect(api.thread).toHaveBeenCalledWith("t2"));
    await act(async () => {
      await api.thread.mock.results[0].value;
    });
    expect(title()).toBe("Second chat");
  });

  it("the header title follows a rename of the open thread and falls back to the app name on delete", async () => {
    let list = [...threads];
    const { api } = await renderApp(defaultConfig({ app_name: "Acme Assistant" }), {
      threads: vi.fn(async () => list),
      renameThread: vi.fn(async (id: string, title: string) => {
        list = list.map((t) => (t.id === id ? { ...t, title } : t));
        return {};
      }),
      deleteThread: vi.fn(async (id: string) => {
        list = list.filter((t) => t.id !== id);
      }),
    });
    const title = () => screen.getByRole("banner").querySelector('[data-lq-part~="header-title"]')!.textContent;
    fireEvent.click(await screen.findByRole("button", { name: "Second chat" }));
    await vi.waitFor(() => expect(title()).toBe("Second chat"));
    await act(async () => {
      await api.thread.mock.results[0].value;
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename Second chat" }));
    const input = screen.getByRole("textbox", { name: "Chat title" });
    fireEvent.change(input, { target: { value: "Billing question" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(title()).toBe("Billing question"));

    fireEvent.click(screen.getByRole("button", { name: "Delete Billing question" }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await vi.waitFor(() => expect(api.deleteThread).toHaveBeenCalledWith("t2"));
    await vi.waitFor(() => expect(title()).toBe("Acme Assistant"));
  });

  it("with the chat list hidden, the header shows the logo", async () => {
    await renderApp(defaultConfig({ app_name: "Acme Assistant", logo_url: "branding/logo", hide: ["thread_list"] }));
    const banner = screen.getByRole("banner");
    expect(banner.querySelector("img")?.getAttribute("src")).toBe("branding/logo");
    expect(banner.querySelector('[data-lq-part~="header-title"]')!.textContent).toBe("Acme Assistant");
  });

  it("thread list hidden by config", async () => {
    await renderApp(defaultConfig({ hide: ["thread_list"] }));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("First chat")).toBeNull();
    expect(screen.queryByRole("button", { name: /show chats|hide chats/i })).toBeNull();
  });

  it("thread list shown by default", async () => {
    await renderApp();
    expect(screen.getByRole("navigation", { name: /chats/i })).toBeTruthy();
    expect(await screen.findByText("Second chat")).toBeTruthy();
  });

  it("stop button only while running; regenerate only when idle", async () => {
    const { store } = await renderApp();
    const items = [userMsg("u1", "hi"), botMsg("a1", "hello", true)];

    act(() => store.setState({ view: view(items, "running") }));
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^send/i })).toBeNull();

    act(() => store.setState({ view: view([items[0], botMsg("a1", "hello")], "idle") }));
    expect(screen.queryByRole("button", { name: /stop/i })).toBeNull();
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeTruthy();

    act(() => store.setState({ starting: true }));
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
  });

  it("stop calls store.stop", async () => {
    const { store } = await renderApp();
    const stop = vi.fn(async () => {});
    act(() => store.setState({ view: view([userMsg("u1", "hi")], "running"), stop }));
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(stop).toHaveBeenCalled();
  });

  it("shows the login screen with the auth error when auth is password and there is no user", async () => {
    const store = readyStore({ config: defaultConfig({ auth: "password" }), user: null, authError: "Invalid username or password." });
    const login = vi.fn(async () => {});
    store.setState({ login, init: vi.fn(async () => {}) });
    render(<App store={store} />);
    expect(screen.getByRole("alert").textContent).toContain("Invalid username or password.");
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "ann" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(login).toHaveBeenCalledWith("ann", "pw");
    expect(screen.queryByRole("form", { name: /message/i })).toBeNull();
  });

  it("delete asks for inline confirmation before calling deleteThread", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const { store } = await renderApp();
    await screen.findByText("First chat");
    const deleteThread = vi.fn(async () => {});
    act(() => store.setState({ deleteThread }));

    fireEvent.click(screen.getByRole("button", { name: "Delete First chat" }));
    expect(deleteThread).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(deleteThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete First chat" }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(deleteThread).toHaveBeenCalledWith("t1");
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows a 409 error item from a refused delete inline", async () => {
    const { store } = await renderApp();
    act(() =>
      store.setState({
        view: view([userMsg("u1", "hi"), { kind: "error", message: "A reply is already in progress.", code: "run_in_progress" }]),
      }),
    );
    expect(screen.getByText("A reply is already in progress.")).toBeTruthy();
  });

  it("opening a thread calls openThread", async () => {
    const { store } = await renderApp();
    const openThread = vi.fn(async () => {});
    act(() => store.setState({ openThread }));
    fireEvent.click(await screen.findByRole("button", { name: "Second chat" }));
    expect(openThread).toHaveBeenCalledWith("t2");
  });

  it("theme button cycles the allowed themes without persisting a color mode", async () => {
    vi.mocked(loadThemeFonts).mockClear();
    const { container } = await renderApp(defaultConfig({ default_theme: "graphite", themes: ["graphite", "midnight", "editorial"] }));
    const html = document.documentElement;
    expect(container.querySelector(".lq-root")!.hasAttribute("data-mode")).toBe(false);
    expect(html.getAttribute("data-lq-theme")).toBe("graphite");
    expect(html.getAttribute("data-lq-scheme")).toBe("light");
    expect(loadThemeFonts).toHaveBeenLastCalledWith("graphite");

    fireEvent.click(screen.getByRole("button", { name: "Theme: Graphite" }));
    expect(html.getAttribute("data-lq-theme")).toBe("midnight");
    expect(html.getAttribute("data-lq-scheme")).toBe("dark");
    expect(loadThemeFonts).toHaveBeenLastCalledWith("midnight");

    fireEvent.click(screen.getByRole("button", { name: "Theme: Midnight" }));
    expect(html.getAttribute("data-lq-theme")).toBe("editorial");
    fireEvent.click(screen.getByRole("button", { name: "Theme: Editorial" }));
    expect(html.getAttribute("data-lq-theme")).toBe("graphite");
    expect(localStorage.getItem("lq-color-mode")).toBeNull();
  });

  it("the effective theme follows the system scheme and loads its fonts", async () => {
    vi.mocked(loadThemeFonts).mockClear();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("dark"), addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    try {
      await renderApp(defaultConfig());
      expect(document.documentElement.getAttribute("data-lq-theme")).toBe("midnight");
      expect(loadThemeFonts).toHaveBeenCalledWith("midnight");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("?theme= previews an allowed theme, ignores others, and is not persisted", async () => {
    const html = document.documentElement;
    window.history.replaceState(null, "", "/?theme=midnight");
    try {
      const { unmount } = await renderApp(defaultConfig({ default_theme: "graphite", themes: ["graphite", "midnight"] }));
      expect(html.getAttribute("data-lq-theme")).toBe("midnight");
      expect(localStorage.length).toBe(0);
      unmount();
      window.history.replaceState(null, "", "/?theme=editorial");
      await renderApp(defaultConfig({ default_theme: "graphite", themes: ["graphite", "midnight"] }));
      expect(html.getAttribute("data-lq-theme")).toBe("graphite");
      expect(localStorage.length).toBe(0);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("the theme button is hidden while a ?theme= preview is active", async () => {
    window.history.replaceState(null, "", "/?theme=midnight");
    try {
      await renderApp(defaultConfig({ default_theme: "graphite", themes: ["graphite", "midnight"] }));
      expect(document.documentElement.getAttribute("data-lq-theme")).toBe("midnight");
      expect(screen.queryByRole("button", { name: /^theme:/i })).toBeNull();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("system follows a brand background's scheme, not the OS (Q14a)", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("dark"), addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    try {
      await renderApp(defaultConfig({ theme: { background: "#ffffff" } }));
      expect(document.documentElement.getAttribute("data-lq-theme")).toBe("graphite");
      expect(document.documentElement.getAttribute("data-lq-scheme")).toBe("light");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the theme button is hidden when only one theme is allowed", async () => {
    await renderApp(defaultConfig({ default_theme: "editorial", themes: ["editorial"] }));
    expect(document.documentElement.getAttribute("data-lq-theme")).toBe("editorial");
    expect(screen.queryByRole("button", { name: /^theme:/i })).toBeNull();
  });

  it("a brand background fixes the scheme in every theme (R25)", async () => {
    await renderApp(defaultConfig({ default_theme: "graphite", theme: { background: "#111111", text: "#eeeeee" } }));
    const html = document.documentElement;
    expect(html.getAttribute("data-lq-theme")).toBe("graphite");
    expect(html.getAttribute("data-lq-scheme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-lq-custom-colors")).toBe("background surface text muted");
    fireEvent.click(screen.getByRole("button", { name: /^theme:/i }));
    expect(document.documentElement.getAttribute("data-lq-theme")).toBe("graphite-dark");
    expect(html.getAttribute("data-lq-scheme")).toBe("dark");
    expect(getComputedStyle(document.documentElement).getPropertyValue("--lq-bg").trim()).toBe("#111111");
  });

  it("thread titles are shown without markdown syntax", async () => {
    await renderApp(defaultConfig(), {
      threads: vi.fn(async () => [{ id: "t9", title: "Show me **markdown**: a [list](https://x.y)", updated_at: new Date().toISOString() }]),
    });
    expect(await screen.findByRole("button", { name: "Show me markdown: a list" })).toBeTruthy();
  });

  it("delete Cancel returns focus to the delete button; Confirm moves it to New chat", async () => {
    const { store } = await renderApp();
    await screen.findByText("First chat");
    act(() => store.setState({ deleteThread: vi.fn(async () => {}) }));

    fireEvent.click(screen.getByRole("button", { name: "Delete First chat" }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete First chat" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete First chat" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /confirm delete/i }), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete First chat" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete First chat" }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /new chat/i }));
  });

  describe("narrow screens", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((q: string) => ({ matches: q.includes("max-width"), addEventListener: () => {}, removeEventListener: () => {} })),
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it("the drawer is modal: main is inert, Escape closes it and focus returns to the toggle", async () => {
      const { container } = await renderApp();
      await screen.findByText("First chat");
      const main = container.querySelector(".lq-main")!;
      const layout = container.querySelector(".lq-layout")!;
      expect(main.hasAttribute("inert")).toBe(false);
      expect(layout.classList.contains("nav-open")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Show chats" }));
      expect(layout.classList.contains("nav-open")).toBe(true);
      expect(main.hasAttribute("inert")).toBe(true);
      expect(container.querySelector("#lq-nav")!.contains(document.activeElement)).toBe(true);

      fireEvent.keyDown(window, { key: "Escape" });
      expect(layout.classList.contains("nav-open")).toBe(false);
      expect(main.hasAttribute("inert")).toBe(false);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show chats" }));
    });

    it("Escape in the rename field cancels the rename only, not the drawer", async () => {
      const { container } = await renderApp();
      await screen.findByText("First chat");
      fireEvent.click(screen.getByRole("button", { name: "Show chats" }));
      fireEvent.click(screen.getByRole("button", { name: "Rename First chat" }));
      const input = screen.getByRole("textbox", { name: "Chat title" });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("textbox", { name: "Chat title" })).toBeNull();
      expect(container.querySelector(".lq-layout")!.classList.contains("nav-open")).toBe(true);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename First chat" }));
    });
  });
});
