import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { useApp, useAppStore } from "../storeContext";
import { formatSize } from "./AttachmentChip";
import { IconFile, IconPaperclip, IconSend, IconStop, IconX } from "./icons";
import { part } from "../parts";

const MAX_ROWS_PX = 220;

/** The MIME type the server checks: the browser sends unknown types as application/octet-stream. */
function mimeOf(f: File): string {
  return (f.type || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
}

function names(list: string[]): string {
  return `${list.join(", ")} ${list.length > 1 ? "are" : "is"}`;
}

export function Composer() {
  const store = useAppStore();
  const starting = useApp((s) => s.starting);
  const running = useApp((s) => s.view.run === "running");
  const attachments = useApp((s) => s.config?.attachments ?? false);
  const maxMb = useApp((s) => s.config?.max_upload_mb ?? 0);
  const allowedTypes = useApp((s) => s.config?.allowed_upload_types);
  const threadId = useApp((s) => s.currentThreadId);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = starting || running;
  const hasContent = text.trim() !== "" || files.length > 0;
  const canSubmit = !busy && hasContent;

  // Grow with the content up to a cap, then scroll.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [text]);

  // Focus the box when the conversation changes (new chat, thread opened), except on touch
  // devices where focusing would pop the on-screen keyboard over the conversation.
  useEffect(() => {
    let coarse = false;
    try {
      coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    } catch {
      /* assume a fine pointer */
    }
    if (!coarse) boxRef.current?.focus({ preventScroll: true });
  }, [threadId]);

  const submit = () => {
    if (!canSubmit) return;
    // Keep the draft until the store reports the send was accepted (starting flips true).
    const draftText = text;
    const draftFiles = files;
    let cleared = false;
    const unsub = store.subscribe((s, prev) => {
      if (!cleared && s.starting && !prev.starting) {
        cleared = true;
        unsub();
        setText("");
        setFiles([]);
        setFileError(null);
      }
    });
    void store
      .getState()
      .send(text, files)
      .catch(() => false)
      .then((sent) => {
        // Accepted, then not sent after all (an upload or the start failed, or Stop): give the
        // draft back unless the user has started a new one meanwhile.
        if (sent || !cleared || !mounted.current) return;
        setText((t) => (t === "" ? draftText : t));
        setFiles((f) => (f.length === 0 ? draftFiles : f));
      })
      .finally(unsub);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    // Never send while an IME is composing (Enter confirms the composition there).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

  const addFiles = (list: Iterable<File>) => {
    const allowed = allowedTypes ? new Set(allowedTypes.map((t) => t.toLowerCase())) : null;
    const ok: File[] = [];
    const tooBig: string[] = [];
    const badType: string[] = [];
    for (const f of list) {
      if (allowed && !allowed.has(mimeOf(f))) badType.push(f.name);
      else if (maxMb > 0 && f.size > maxMb * 1024 * 1024) tooBig.push(f.name);
      else ok.push(f);
    }
    const notes: string[] = [];
    if (badType.length) notes.push(`${names(badType)} not a supported file type.`);
    if (tooBig.length) notes.push(`${names(tooBig)} larger than ${maxMb} MB.`);
    setFileError(notes.length ? notes.join(" ") : null);
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachments) return;
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  };

  return (
    <form className="lq-composer" aria-label="Message" onSubmit={onSubmit} {...part("composer")}>
      <div className="lq-composer-box">
        {files.length > 0 && (
          <ul className="lq-pending" aria-label="Files to send">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="lq-chip lq-chip-static">
                <span className="lq-chip-thumb">
                  <IconFile />
                </span>
                <span className="lq-chip-name">{f.name}</span>
                <span className="lq-chip-size">{formatSize(f.size)}</span>
                <button
                  type="button"
                  className="lq-chip-remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, n) => n !== i))}
                >
                  <IconX />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={boxRef}
          className="lq-input"
          {...part("composer-input")}
          rows={1}
          aria-label="Message"
          placeholder="Send a message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="lq-composer-bar">
          {attachments && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={allowedTypes?.join(",")}
                hidden
                tabIndex={-1}
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button type="button" className="lq-icon-btn" {...part("composer-attach")} aria-label="Attach files" title="Attach files" onClick={() => fileRef.current?.click()}>
                <IconPaperclip />
              </button>
            </>
          )}
          <span className="lq-composer-hint" aria-hidden="true">
            Enter to send · Shift+Enter for a new line
          </span>
          {busy ? (
            <button type="button" className="lq-send is-stop" {...part("composer-send", { state: "running" })} aria-label="Stop response" title="Stop" onClick={() => void store.getState().stop()}>
              <IconStop />
            </button>
          ) : (
            <button type="submit" className="lq-send" {...part("composer-send")} aria-label="Send message" title="Send" disabled={!canSubmit}>
              <IconSend />
            </button>
          )}
        </div>
      </div>
      {fileError && (
        <p className="lq-composer-error" role="alert">
          {fileError}
        </p>
      )}
    </form>
  );
}
