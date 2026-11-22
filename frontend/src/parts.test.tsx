import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AppearancePanel } from "./components/AppearancePanel";
import { PARTS, PART_TARGETS, ROLES, STATES, part } from "./parts";
import { createAppStore } from "./state/store";
import type { Item } from "./state/reducer";
import { botMsg, defaultConfig, fakeApi, userMsg, view } from "./test/helpers";

vi.mock("./fonts", () => ({ loadThemeFonts: vi.fn(async () => {}) }));

const threads = [{ id: "t1", title: "First chat", updated_at: new Date().toISOString() }];

const widget = (id: string, name: string, args: unknown): Item => ({
  kind: "widget",
  id,
  widget: name,
  args: JSON.stringify(args),
  argsComplete: true,
} as unknown as Item);

const fixture: Item[] = [
  userMsg("u1", "hello", { attachments: [{ id: "f1", name: "a.txt", type: "text/plain", size: 10 }] } as never),
  botMsg("a1", "Some **text**\n\n```js\nconst x = 1;\n```"),
  { kind: "step", id: "s1", name: "Plan", status: "done" } as unknown as Item,
  { kind: "tool", id: "t1", name: "search", status: "done", args: "{}", result: "{}" } as unknown as Item,
  widget("w1", "confirm", { message: "Sure?" }),
  widget("w2", "select", { message: "Pick", options: [{ value: "a", label: "A" }] }),
  widget("w3", "form", { message: "Fill", schema: { type: "object", properties: { n: { type: "string" } } } }),
  { kind: "error", message: "boom" } as unknown as Item,
];

function partsIn(root: ParentNode): Set<string> {
  return new Set([...root.querySelectorAll("[data-lq-part]")].flatMap((e) => e.getAttribute("data-lq-part")!.split(/\s+/)));
}

async function mount(config = defaultConfig({ attachments: true }), prime?: (s: ReturnType<typeof createAppStore>) => void, over: Record<string, unknown> = {}) {
  const api = fakeApi(config, { threads: vi.fn(async () => threads), ...over });
  const store = createAppStore(api, { pageQuery: () => ({}) });
  const utils = render(<App store={store} />);
  await vi.waitFor(() => expect(store.getState().config).not.toBeNull());
  prime?.(store);
  return { ...utils, store };
}

afterEach(() => vi.unstubAllGlobals());

describe("named parts", () => {
  it("part() builds a token list and data attributes", () => {
    expect(part(["activity", "activity-tool"], { state: "running" })).toEqual({ "data-lq-part": "activity activity-tool", "data-lq-state": "running" });
    expect(part("message", { role: "user", state: undefined })).toEqual({ "data-lq-part": "message", "data-lq-role": "user" });
  });

  it("every PART appears in the rendered app, and nothing else", async () => {
    const seen = new Set<string>();
    const add = (s: Set<string>) => s.forEach((p) => seen.add(p));

    // Wide: the main app with a full thread, plus an empty thread for the empty state.
    const wide = await mount();
    await screen.findByText("First chat");
    act(() => wide.store.setState({ view: view(fixture) }));
    add(partsIn(document.body));
    act(() => wide.store.setState({ view: view([]) }));
    add(partsIn(document.body));
    wide.unmount();

    // Narrow with the drawer open.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width"), addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    const narrow = await mount();
    fireEvent.click(await screen.findByRole("button", { name: /show chats/i }));
    add(partsIn(document.body));
    narrow.unmount();
    vi.unstubAllGlobals();

    // Login: password mode without a user.
    const login = await mount(defaultConfig({ auth: "password" }), undefined, { me: vi.fn(async () => { throw new Error("401"); }) });
    await screen.findByRole("heading", { name: /sign in/i });
    add(partsIn(document.body));
    login.unmount();

    // The appearance panel placeholder, rendered directly (Task 10 mounts it in the app).
    const panel = render(<AppearancePanel />);
    add(partsIn(panel.container));

    expect([...seen].sort()).toEqual([...PARTS].sort());
  });

  it("exposes state attributes", async () => {
    const { store } = await mount();
    await screen.findByText("First chat");
    act(() => store.setState({ view: view([userMsg("u1", "hi"), botMsg("a1", "yo", true), { kind: "step", id: "s", name: "S", status: "running" } as unknown as Item, { kind: "tool", id: "t", name: "T", status: "done", args: "{}", result: "{}" } as unknown as Item], "running") }));
    expect(document.querySelector('[data-lq-part~="message"][data-lq-role="user"]')).toBeTruthy();
    expect(document.querySelector('[data-lq-part~="message"][data-lq-role="assistant"][data-lq-state="streaming"]')).toBeTruthy();
    expect(document.querySelector('[data-lq-part~="activity"][data-lq-part~="activity-step"][data-lq-state="running"]')).toBeTruthy();
    expect(document.querySelector('[data-lq-part~="activity"][data-lq-part~="activity-tool"][data-lq-state="done"]')).toBeTruthy();
    expect(document.querySelector('[data-lq-part~="thread-item"][data-lq-active]')).toBeNull();
  });

  it("observed state and role values stay inside the contract", async () => {
    const wide = await mount();
    await screen.findByText("First chat");
    const seen = { state: new Set<string>(), role: new Set<string>(), active: new Set<string>() };
    const collect = () => {
      for (const k of ["state", "role", "active"] as const)
        document.querySelectorAll(`[data-lq-${k}]`).forEach((e) => seen[k].add(e.getAttribute(`data-lq-${k}`)!));
    };
    act(() => wide.store.setState({ view: view(fixture) }));
    collect();
    act(() => wide.store.setState({ view: view([userMsg("u", "x"), botMsg("a", "y", true), { kind: "step", id: "s", name: "S", status: "running" } as unknown as Item], "running") }));
    collect();
    expect(seen.state.size).toBeGreaterThan(1);
    for (const v of seen.state) expect(STATES).toContain(`data-lq-state=${v}`);
    for (const v of seen.role) expect(ROLES).toContain(v);
    for (const v of seen.active) expect(STATES).toContain(`data-lq-active=${v}`);
  });

  it("every part is documented in PART_TARGETS", () => {
    expect(Object.keys(PART_TARGETS).sort()).toEqual([...PARTS].sort());
  });
});
