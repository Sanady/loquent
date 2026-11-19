import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "../storeContext";
import type { Item } from "../state/reducer";
import type { AppStore } from "../state/store";
import { botMsg, readyStore, userMsg, view } from "../test/helpers";
import { MessageList } from "./MessageList";

function renderList(store: AppStore, fileUrl?: (id: string) => Promise<{ url: string }>) {
  return render(
    <StoreProvider store={store} fileUrl={fileUrl}>
      <MessageList />
    </StoreProvider>,
  );
}

describe("MessageList", () => {
  it("step and tool rows collapse/expand", () => {
    const items: Item[] = [
      userMsg("u1", "weather?"),
      { kind: "step", name: "Planning", status: "running" },
      { kind: "tool", id: "c1", name: "get_weather", args: '{"city":"Oslo"}', result: '{"temp":3}', status: "done" },
    ];
    const store = readyStore({ view: view(items, "running") });
    const { container } = renderList(store);

    const step = screen.getByRole("button", { name: /Planning/ });
    const tool = screen.getByRole("button", { name: /get_weather/ });
    expect(step.getAttribute("aria-expanded")).toBe("false");
    expect(tool.getAttribute("aria-expanded")).toBe("false");
    // A running step shows a spinner.
    expect(step.querySelector(".lq-spinner")).not.toBeNull();
    expect(container.textContent).not.toContain('"city"');

    fireEvent.click(tool);
    expect(tool.getAttribute("aria-expanded")).toBe("true");
    const blocks = Array.from(container.querySelectorAll(".lq-tool-detail pre")).map((p) => p.textContent);
    expect(blocks.join("\n")).toContain('"city": "Oslo"');
    expect(blocks.join("\n")).toContain('"temp": 3');

    fireEvent.click(tool);
    expect(tool.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".lq-tool-detail")).toBeNull();

    fireEvent.click(step);
    expect(step.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(step);
    expect(step.getAttribute("aria-expanded")).toBe("false");
  });

  it("user text is shown as plain text, assistant text as markdown", () => {
    const store = readyStore({ view: view([userMsg("u1", "**not bold**"), botMsg("a1", "**bold**")]) });
    const { container } = renderList(store);
    expect(screen.getByText("**not bold**")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("streaming region is a polite live region", () => {
    const store = readyStore({ view: view([userMsg("u1", "hi"), botMsg("a1", "he", true)], "running") });
    const { container } = renderList(store);
    const live = container.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live!.textContent).toContain("he");
  });

  it("copy button writes the assistant text to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const store = readyStore({ view: view([userMsg("u1", "hi"), botMsg("a1", "the *answer*")]) });
    renderList(store);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("the *answer*");
    await screen.findByRole("button", { name: /copied/i });
  });

  it("copy survives a missing clipboard API", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const store = readyStore({ view: view([userMsg("u1", "hi"), botMsg("a1", "x")]) });
    renderList(store);
    expect(() => fireEvent.click(screen.getByRole("button", { name: /copy/i }))).not.toThrow();
  });

  it("regenerate is only on the last assistant message of the latest turn", () => {
    const regenerate = vi.fn(async () => true);
    const store = readyStore({
      view: view([userMsg("u1", "a"), botMsg("a1", "one"), userMsg("u2", "b"), botMsg("a2", "two")]),
    });
    store.setState({ regenerate });
    renderList(store);
    const buttons = screen.getAllByRole("button", { name: /regenerate/i });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(regenerate).toHaveBeenCalled();
  });

  it("retry calls regenerate when the run failed or was interrupted", () => {
    const regenerate = vi.fn(async () => true);
    const items: Item[] = [userMsg("u1", "a"), { kind: "error", message: "The model is unavailable.", code: "agent_error" }];
    const store = readyStore({ view: view(items, "failed") });
    store.setState({ regenerate });
    renderList(store);
    expect(screen.getByText("The model is unavailable.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(regenerate).toHaveBeenCalledTimes(1);

    act(() => store.setState({ view: view([userMsg("u1", "a"), botMsg("a1", "partial")], "interrupted") }));
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();

    act(() => store.setState({ view: view([userMsg("u1", "a"), botMsg("a1", "done")], "idle") }));
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("widget items render through the registry", () => {
    const items: Item[] = [
      userMsg("u1", "delete it"),
      { kind: "widget", id: "w1", widget: "confirm", args: { message: "Really delete the file?" }, argsComplete: true },
    ];
    const store = readyStore({ view: view(items, "idle") });
    const { container } = renderList(store);
    expect(screen.getByText("Really delete the file?")).toBeTruthy();
    expect(container.querySelectorAll(".lq-widget button")).toHaveLength(2);
  });

  it("attachment chips open a window synchronously, then point it at a fresh signed URL", async () => {
    let resolveUrl!: (v: { url: string }) => void;
    const fileUrl = vi.fn(() => new Promise<{ url: string }>((r) => (resolveUrl = r)));
    const win = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    try {
      const msg = userMsg("u1", "see file", {
        attachments: [{ id: "f1", name: "report.pdf", content_type: "application/pdf", size: 2048 }],
      });
      const store = readyStore({ view: view([msg]) });
      renderList(store, fileUrl);
      const chip = screen.getByRole("button", { name: /report\.pdf/ });
      expect(chip.textContent).toContain("2 KB");
      fireEvent.click(chip);
      // Opened in the click itself (Safari blocks window.open after an await), without an opener.
      expect(open).toHaveBeenCalledWith("", "_blank");
      expect(win.opener).toBeNull();
      expect(fileUrl).toHaveBeenCalledWith("f1");
      await act(async () => resolveUrl({ url: "https://files.test/f1?sig=abc" }));
      expect(win.location.href).toBe("https://files.test/f1?sig=abc");
      expect(win.close).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it("attachment chip closes the blank window when the URL cannot be fetched", async () => {
    const fileUrl = vi.fn(async () => {
      throw new Error("nope");
    });
    const win = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    try {
      const msg = userMsg("u1", "x", { attachments: [{ id: "f1", name: "a.pdf", content_type: "application/pdf", size: 1 }] });
      renderList(readyStore({ view: view([msg]) }), fileUrl);
      fireEvent.click(screen.getByRole("button", { name: /a\.pdf/ }));
      await waitFor(() => expect(win.close).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: /could not open/ })).toBeTruthy();
    } finally {
      open.mockRestore();
    }
  });

  it("shows an empty state when there are no items", () => {
    const store = readyStore({ view: view([]) });
    renderList(store);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });
});
