import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createAppStore } from "./state/store";
import { botMsg, defaultConfig, fakeApi, readyStore, userMsg, view } from "./test/helpers";

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
    // The configured name is what the header shows.
    expect(screen.getByRole("banner").textContent).toContain("Chat");
  });

  it("header shows the configured logo and app name", async () => {
    await renderApp(defaultConfig({ app_name: "Acme Assistant", logo_url: "branding/logo" }));
    const banner = screen.getByRole("banner");
    expect(banner.textContent).toContain("Acme Assistant");
    expect(banner.querySelector("img")?.getAttribute("src")).toBe("branding/logo");
    expect(document.title).toBe("Acme Assistant");
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

  it("theme toggle flips the color mode and persists it", async () => {
    const { container } = await renderApp();
    const root = container.querySelector(".lq-root")!;
    const before = root.getAttribute("data-mode");
    fireEvent.click(screen.getByRole("button", { name: /switch to (dark|light) theme/i }));
    const after = root.getAttribute("data-mode");
    expect(after).not.toBe(before);
    expect(localStorage.getItem("lq-color-mode")).toBe(after);
  });
});
