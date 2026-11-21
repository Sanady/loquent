import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ThreadSummary } from "../api/client";
import { useApp } from "../storeContext";
import { plainTitle } from "../text";
import { IconPencil, IconPlus, IconTrash, IconX } from "./icons";
import { part } from "../parts";

const DAY = 24 * 60 * 60 * 1000;

function groupLabel(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Earlier";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY) return "Yesterday";
  if (t >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (t >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Earlier";
}

function groupThreads(threads: ThreadSummary[]): [string, ThreadSummary[]][] {
  const now = new Date();
  const groups = new Map<string, ThreadSummary[]>();
  for (const t of threads) {
    const label = groupLabel(t.updated_at, now);
    const list = groups.get(label) ?? [];
    list.push(t);
    groups.set(label, list);
  }
  return [...groups.entries()];
}

function ThreadRow({
  thread,
  current,
  onOpened,
  onDeleted,
}: {
  thread: ThreadSummary;
  current: boolean;
  onOpened: () => void;
  onDeleted: () => void;
}) {
  const openThread = useApp((s) => s.openThread);
  const renameThread = useApp((s) => s.renameThread);
  const deleteThread = useApp((s) => s.deleteThread);
  const [mode, setMode] = useState<"view" | "rename" | "confirm">("view");
  const [draft, setDraft] = useState(thread.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const renameBtn = useRef<HTMLButtonElement>(null);
  const deleteBtn = useRef<HTMLButtonElement>(null);
  // Where focus goes when the row returns to view mode after a keyboard-driven exit.
  const refocus = useRef<"rename" | "delete" | null>(null);
  // Enter/Escape end the edit; the blur that follows unmounting must not commit again.
  const editDone = useRef(false);
  const title = plainTitle(thread.title) || "Untitled chat";

  useEffect(() => {
    if (mode === "rename") inputRef.current?.select();
    if (mode === "confirm") confirmRef.current?.focus();
    if (mode === "view" && refocus.current) {
      (refocus.current === "rename" ? renameBtn : deleteBtn).current?.focus();
      refocus.current = null;
    }
  }, [mode]);

  const startRename = () => {
    editDone.current = false;
    setDraft(thread.title);
    setMode("rename");
  };

  const commitRename = () => {
    if (editDone.current) return;
    editDone.current = true;
    const next = draft.trim();
    setMode("view");
    if (next && next !== thread.title) void renameThread(thread.id, next);
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      refocus.current = "rename";
      commitRename();
    } else if (e.key === "Escape") {
      // Cancels the rename only; must not also close the mobile drawer.
      e.stopPropagation();
      editDone.current = true;
      refocus.current = "rename";
      setMode("view");
    }
  };

  const cancelDelete = () => {
    refocus.current = "delete";
    setMode("view");
  };

  if (mode === "rename") {
    return (
      <li className="lq-thread is-editing" {...part("thread-item", { active: current ? "true" : undefined })}>
        <input
          ref={inputRef}
          className="lq-thread-input"
          aria-label="Chat title"
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onRenameKey}
          onBlur={commitRename}
        />
      </li>
    );
  }

  if (mode === "confirm") {
    return (
      <li
        className="lq-thread is-confirm"
        {...part("thread-item", { active: current ? "true" : undefined })}
        role="group"
        aria-label={`Delete ${title}?`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cancelDelete();
          }
        }}
      >
        <span className="lq-thread-confirm-text">Delete this chat?</span>
        <button ref={confirmRef} type="button" className="lq-btn lq-btn-danger lq-btn-sm" aria-label="Confirm delete" onClick={() => {
          setMode("view");
          onDeleted();
          void deleteThread(thread.id);
        }}>
          Delete
        </button>
        <button type="button" className="lq-btn lq-btn-quiet lq-btn-sm" onClick={cancelDelete}>
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className={`lq-thread${current ? " is-current" : ""}`} {...part("thread-item", { active: current ? "true" : undefined })}>
      <button
        type="button"
        className="lq-thread-open"
        aria-current={current ? "page" : undefined}
        title={title}
        onClick={() => {
          onOpened();
          if (!current) void openThread(thread.id);
        }}
      >
        {title}
      </button>
      <span className="lq-thread-actions">
        <button ref={renameBtn} type="button" className="lq-icon-btn lq-icon-btn-sm" aria-label={`Rename ${title}`} title="Rename" onClick={startRename}>
          <IconPencil />
        </button>
        <button ref={deleteBtn} type="button" className="lq-icon-btn lq-icon-btn-sm" aria-label={`Delete ${title}`} title="Delete" onClick={() => setMode("confirm")}>
          <IconTrash />
        </button>
      </span>
    </li>
  );
}

export function ThreadList({ id, onNavigate, onClose }: { id: string; onNavigate: () => void; onClose?: () => void }) {
  const threads = useApp((s) => s.threads);
  const currentId = useApp((s) => s.currentThreadId);
  const newThread = useApp((s) => s.newThread);
  const groups = groupThreads(threads);
  const newChatRef = useRef<HTMLButtonElement>(null);

  return (
    <nav id={id} className="lq-sidebar" aria-label="Chats" {...part("sidebar")}>
      <div className="lq-sidebar-top" {...part("sidebar-header")}>
        <button ref={newChatRef} type="button" className="lq-new-chat" {...part("new-chat")} onClick={() => {
          newThread();
          onNavigate();
        }}>
          <IconPlus />
          New chat
        </button>
        {onClose && (
          <button type="button" className="lq-icon-btn" aria-label="Close chats" title="Close" onClick={onClose}>
            <IconX />
          </button>
        )}
      </div>
      <div className="lq-thread-scroll" {...part("thread-list")}>
        {threads.length === 0 ? (
          <p className="lq-thread-empty">Your conversations will appear here.</p>
        ) : (
          groups.map(([label, list]) => (
            <section key={label} className="lq-thread-group" aria-label={label}>
              <h2 className="lq-thread-group-label">{label}</h2>
              <ul>
                {list.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    current={t.id === currentId}
                    onOpened={onNavigate}
                    onDeleted={() => newChatRef.current?.focus()}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}
