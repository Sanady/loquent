import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "../storeContext";
import type { AppStore } from "../state/store";
import { defaultConfig, readyStore, userMsg, view } from "../test/helpers";
import { Composer } from "./Composer";

function renderComposer(store: AppStore) {
  render(
    <StoreProvider store={store}>
      <Composer />
    </StoreProvider>,
  );
  return screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement;
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("Composer", () => {
  it("send is disabled without text and enabled with text", () => {
    const store = readyStore();
    const box = renderComposer(store);
    const send = screen.getByRole("button", { name: /send/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "   " } });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "hello" } });
    expect(send.disabled).toBe(false);
  });

  it("clears the text once starting flips true (send accepted)", async () => {
    const store = readyStore();
    const d = deferred<boolean>();
    const send = vi.fn(() => {
      store.setState({ starting: true });
      return d.promise;
    });
    store.setState({ send });
    const box = renderComposer(store);
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.submit(screen.getByRole("form", { name: /message/i }));
    expect(send).toHaveBeenCalledWith("hello", []);
    expect(box.value).toBe("");
    await act(async () => d.resolve(true));
  });

  it("keeps the text when send is refused without starting", async () => {
    const store = readyStore();
    const send = vi.fn(async () => false);
    store.setState({ send });
    const box = renderComposer(store);
    fireEvent.change(box, { target: { value: "keep me" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: /message/i }));
    });
    expect(send).toHaveBeenCalled();
    expect(box.value).toBe("keep me");
  });

  it("starting flipped by something else does not clear a draft", () => {
    const store = readyStore();
    const box = renderComposer(store);
    fireEvent.change(box, { target: { value: "draft" } });
    act(() => store.setState({ starting: true }));
    expect(box.value).toBe("draft");
  });

  it("Enter sends, Shift+Enter does not, IME composition does not", () => {
    const store = readyStore();
    const send = vi.fn(async () => false);
    store.setState({ send });
    const box = renderComposer(store);
    fireEvent.change(box, { target: { value: "hi" } });

    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("cannot submit while running or starting", () => {
    const store = readyStore({ view: view([userMsg("u1", "x")], "running") });
    const send = vi.fn(async () => false);
    store.setState({ send });
    const box = renderComposer(store);
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
    act(() => store.setState({ view: view([], "idle"), starting: true }));
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
  });

  it("attach button only when config.attachments; files can be sent alone", () => {
    const store = readyStore();
    renderComposer(store);
    expect(screen.queryByRole("button", { name: /attach/i })).toBeNull();
  });

  it("files are kept until accepted and sent without text", () => {
    const store = readyStore({ config: defaultConfig({ attachments: true }) });
    const send = vi.fn(() => {
      store.setState({ starting: true });
      return new Promise<boolean>(() => {});
    });
    store.setState({ send });
    renderComposer(store);
    expect(screen.getByRole("button", { name: /attach/i })).toBeTruthy();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["abc"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("notes.txt")).toBeTruthy();
    const sendBtn = screen.getByRole("button", { name: /send/i }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn);
    expect(send).toHaveBeenCalledWith("", [file]);
    expect(screen.queryByText("notes.txt")).toBeNull();
  });

  it("rejects files over max_upload_mb without adding them", () => {
    const store = readyStore({ config: defaultConfig({ attachments: true, max_upload_mb: 1 }) });
    renderComposer(store);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "big.bin");
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.queryByText("big.bin")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/big\.bin/);
  });
});

describe("Composer upload limits and failed uploads (item 13)", () => {
  it("rejects types outside allowed_upload_types with an inline notice", () => {
    const store = readyStore({ config: defaultConfig({ attachments: true, allowed_upload_types: ["image/png", "text/plain"] }) });
    renderComposer(store);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    expect(input.accept).toBe("image/png,text/plain");
    const ok = new File(["x"], "pic.png", { type: "image/png" });
    const bad = new File(["x"], "tool.exe", { type: "application/x-msdownload" });
    const unknown = new File(["x"], "blob.xyz", { type: "" });
    fireEvent.change(input, { target: { files: [ok, bad, unknown] } });
    expect(screen.getByText("pic.png")).toBeTruthy();
    expect(screen.queryByText("tool.exe")).toBeNull();
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toMatch(/tool\.exe/);
    expect(alert).toMatch(/blob\.xyz/);
    expect(alert).toMatch(/not a supported file type|not supported/);
  });

  it("type matching ignores case and parameters", () => {
    const store = readyStore({ config: defaultConfig({ attachments: true, allowed_upload_types: ["text/plain"] }) });
    renderComposer(store);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.txt", { type: "Text/Plain;charset=utf-8" })] } });
    expect(screen.getByText("a.txt")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("restores the draft text and files when the accepted send fails (upload error)", async () => {
    const store = readyStore({ config: defaultConfig({ attachments: true }) });
    const d = deferred<boolean>();
    const send = vi.fn(() => {
      store.setState({ starting: true });
      return d.promise;
    });
    store.setState({ send });
    const box = renderComposer(store);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["abc"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(box, { target: { value: "see attached" } });
    fireEvent.submit(screen.getByRole("form", { name: /message/i }));
    expect(box.value).toBe("");
    expect(screen.queryByText("notes.txt")).toBeNull();
    await act(async () => {
      store.setState({ starting: false });
      d.resolve(false);
    });
    expect(box.value).toBe("see attached");
    expect(screen.getByText("notes.txt")).toBeTruthy();
  });

  it("does not restore after a successful send", async () => {
    const store = readyStore();
    const d = deferred<boolean>();
    store.setState({
      send: vi.fn(() => {
        store.setState({ starting: true });
        return d.promise;
      }),
    });
    const box = renderComposer(store);
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.submit(screen.getByRole("form", { name: /message/i }));
    await act(async () => d.resolve(true));
    expect(box.value).toBe("");
  });
});
