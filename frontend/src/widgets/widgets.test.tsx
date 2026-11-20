import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "../storeContext";
import type { AppStore } from "../state/store";
import type { Item } from "../state/reducer";
import { readyStore, view } from "../test/helpers";
import { MessageList } from "../components/MessageList";
import { renderWidget, type WidgetItem } from "./registry";

function widget(over: Partial<WidgetItem> & Pick<WidgetItem, "widget" | "args">): WidgetItem {
  return { kind: "widget", id: "w1", argsComplete: true, ...over };
}

function setup(item: WidgetItem, state: Parameters<typeof readyStore>[0] = {}, opts?: { interactive?: boolean }) {
  const store = readyStore(state);
  const answer = vi.fn(async (_id: string, _v: unknown) => true);
  store.setState({ answer });
  const utils = render(<StoreProvider store={store}>{renderWidget(item, opts)}</StoreProvider>);
  return { store, answer, ...utils };
}

const confirmItem = (over: Partial<WidgetItem> = {}) =>
  widget({ widget: "confirm", args: { message: "Delete the file?", confirmLabel: "Delete", rejectLabel: "Keep" }, ...over });

const selectItem = (multiple: boolean, over: Partial<WidgetItem> = {}) =>
  widget({
    widget: "select",
    args: {
      message: "Pick",
      multiple,
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
        { value: "c", label: "Gamma" },
      ],
    },
    ...over,
  });

const formItem = (over: Partial<WidgetItem> = {}) =>
  widget({
    widget: "form",
    args: {
      message: "Tell me",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
          note: { type: "string" },
          agree: { type: "boolean" },
          color: { type: "string", enum: ["red", "blue"] },
        },
        required: ["name", "age"],
      },
    },
    ...over,
  });

describe("confirm", () => {
  it("confirm sends {confirmed:true}", async () => {
    const { answer } = setup(confirmItem());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(answer).toHaveBeenCalledWith("w1", { confirmed: true });
  });
  it("reject sends {confirmed:false}", () => {
    const { answer } = setup(confirmItem());
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(answer).toHaveBeenCalledWith("w1", { confirmed: false });
  });
  it("buttons are disabled while a run is in progress", () => {
    setup(confirmItem(), { starting: true });
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("disabled when not interactive", () => {
    setup(confirmItem(), {}, { interactive: false });
    expect((screen.getByRole("button", { name: "Keep" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("stays disabled after submit, re-enabled when the answer is refused", async () => {
    let resolve!: (v: boolean) => void;
    const store = readyStore();
    const answer = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    store.setState({ answer });
    render(<StoreProvider store={store}>{renderWidget(confirmItem())}</StoreProvider>);
    const btn = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn.disabled).toBe(true);
    await act(async () => resolve(false));
    await waitFor(() => expect(btn.disabled).toBe(false));
  });
});

describe("select", () => {
  it("select single and multiple payloads", () => {
    const single = setup(selectItem(false));
    const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Beta" }));
    fireEvent.click(submit);
    expect(single.answer).toHaveBeenCalledWith("w1", { value: "b" });
    single.unmount();

    const multi = setup(selectItem(true));
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(multi.answer).toHaveBeenCalledWith("w1", { values: ["a", "c"] });
  });
  it("an empty multiple selection is valid", () => {
    const { answer } = setup(selectItem(true));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(answer).toHaveBeenCalledWith("w1", { values: [] });
  });
  it("uses a fieldset with the message as legend", () => {
    setup(selectItem(false));
    expect(screen.getByRole("group", { name: "Pick" })).toBeTruthy();
  });
});

describe("form", () => {
  it("form validates required and coerces integer", () => {
    const { answer } = setup(formItem());
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(answer).not.toHaveBeenCalled();
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ann" } });
    fireEvent.change(screen.getByLabelText(/age/i), { target: { value: "3.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(answer).not.toHaveBeenCalled();
    expect(screen.getByText(/whole number/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/age/i), { target: { value: "42" } });
    fireEvent.click(screen.getByLabelText(/agree/i));
    fireEvent.change(screen.getByLabelText(/color/i), { target: { value: "blue" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(answer).toHaveBeenCalledWith("w1", { values: { name: "Ann", age: 42, agree: true, color: "blue" } });
  });
  it("an optional field left empty is omitted", () => {
    const { answer } = setup(formItem());
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ann" } });
    fireEvent.change(screen.getByLabelText(/age/i), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    const sent = answer.mock.calls[0]![1] as { values: Record<string, unknown> };
    expect(sent.values).toEqual({ name: "Ann", age: 7, agree: false });
    expect("note" in sent.values).toBe(false);
    expect("color" in sent.values).toBe(false);
  });
  it("marks required fields", () => {
    setup(formItem());
    expect(screen.getByLabelText(/name/i).hasAttribute("required")).toBe(true);
    expect(screen.getByLabelText(/note/i).hasAttribute("required")).toBe(false);
  });
});

describe("states", () => {
  it("answered widget is read-only", () => {
    const c = setup(confirmItem({ answer: { confirmed: true } }));
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    c.unmount();

    const r = setup(confirmItem({ answer: { confirmed: false } }));
    expect(screen.getByText("Rejected")).toBeTruthy();
    r.unmount();

    const s = setup(selectItem(true, { answer: { values: ["a", "c"] } }));
    expect(screen.getByText(/Alpha/)).toBeTruthy();
    expect(screen.getByText(/Gamma/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    s.unmount();

    setup(formItem({ answer: { values: { name: "Ann", age: 42 } } }));
    expect(screen.getByText("Ann")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("unknown widget name renders fallback text, no crash", () => {
    setup({ kind: "widget", id: "x", widget: "mystery" as never, args: { message: "hi" }, argsComplete: true });
    expect(screen.getByText(/can't be displayed/)).toBeTruthy();
  });
  it("invalid args render a readable fallback", () => {
    setup(widget({ widget: "select", args: { message: "Pick one" } }));
    expect(screen.getByText("Pick one")).toBeTruthy();
    expect(screen.getByText(/can't be displayed/)).toBeTruthy();
  });
  it("unsupported schema type falls back", () => {
    setup(
      widget({
        widget: "form",
        args: { message: "Odd", schema: { type: "object", properties: { x: { type: "array" } } } },
      }),
    );
    expect(screen.getByText(/can't be displayed/)).toBeTruthy();
  });
  it("incomplete args show a pending state", () => {
    setup(widget({ widget: "confirm", args: '{"mess', argsComplete: false }));
    expect(screen.getByText(/Preparing/)).toBeTruthy();
  });
});

describe("MessageList integration", () => {
  it("only the last pending widget is interactive", () => {
    const items: Item[] = [
      confirmItem({ id: "w1" }),
      confirmItem({ id: "w2", answer: { confirmed: true } }),
      confirmItem({ id: "w3" }),
    ];
    const store: AppStore = readyStore({ view: view(items) });
    render(
      <StoreProvider store={store}>
        <MessageList />
      </StoreProvider>,
    );
    const btns = screen.getAllByRole("button", { name: "Delete" }) as HTMLButtonElement[];
    expect(btns).toHaveLength(2);
    expect(btns[0]!.disabled).toBe(true);
    expect(btns[1]!.disabled).toBe(false);
  });
});

describe("widget answer contracts match the server (item 10)", () => {
  it("select accepts plain-string options as {value:s,label:s}", () => {
    const { answer } = setup(widget({ widget: "select", args: { message: "Pick", options: ["red", { value: "b", label: "Blue" }] } }));
    fireEvent.click(screen.getByRole("radio", { name: "red" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(answer).toHaveBeenCalledWith("w1", { value: "red" });
  });

  it("a truthy but non-true multiple is a single select (server agrees)", () => {
    setup(widget({ widget: "select", args: { message: "Pick", multiple: "yes", options: ["a", "b"] } }));
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("a form whose required name is missing from properties falls back", () => {
    setup(
      widget({
        widget: "form",
        args: { message: "Odd", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a", "b"] } },
      }),
    );
    expect(screen.getByText(/can't be displayed/)).toBeTruthy();
  });
});

describe("only the latest run's pending widget is interactive (item 15)", () => {
  const renderItems = (items: Item[]) => {
    const store: AppStore = readyStore({ view: view(items) });
    render(
      <StoreProvider store={store}>
        <MessageList />
      </StoreProvider>,
    );
  };

  it("a pending widget before the last user message is not interactive", () => {
    renderItems([
      { kind: "message", id: "u0", role: "user", text: "first", attachments: [], streaming: false },
      confirmItem({ id: "w1" }),
      { kind: "message", id: "u1", role: "user", text: "never mind", attachments: [], streaming: false },
      { kind: "message", id: "a1", role: "assistant", text: "ok", attachments: [], streaming: false },
    ]);
    const btn = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("a pending widget after the last user message is interactive", () => {
    renderItems([
      { kind: "message", id: "u0", role: "user", text: "first", attachments: [], streaming: false },
      confirmItem({ id: "w1", answer: { confirmed: true } }),
      confirmItem({ id: "w2" }),
    ]);
    const btns = screen.getAllByRole("button", { name: "Delete" }) as HTMLButtonElement[];
    expect(btns.at(-1)!.disabled).toBe(false);
  });
});
