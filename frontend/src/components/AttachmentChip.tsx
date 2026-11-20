import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../state/reducer";
import { useFileUrl } from "../storeContext";
import { IconFile } from "./icons";

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function openInNewTab(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}

/** Thumbnail fetched (with a fresh signed URL) only once it scrolls into view. */
function Thumb({ id }: { id: string }) {
  const fileUrl = useFileUrl();
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let alive = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fileUrl(id).then(
        (r) => alive && setSrc(r.url),
        () => {},
      );
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [id, fileUrl]);
  return <span ref={ref} className="lq-chip-thumb">{src ? <img src={src} alt="" /> : <IconFile />}</span>;
}

export function AttachmentChip({ file }: { file: Attachment }) {
  const fileUrl = useFileUrl();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const isImage = file.content_type?.startsWith("image/");
  const size = formatSize(file.size);

  const onClick = async () => {
    setBusy(true);
    setFailed(false);
    // Open the tab inside the click: Safari blocks window.open after an await. The signed URL
    // arrives later; the blank tab must not keep a handle on this page.
    let w: Window | null = null;
    try {
      w = window.open("", "_blank");
      if (w) w.opener = null;
    } catch {
      w = null;
    }
    try {
      const { url } = await fileUrl(file.id);
      if (w) w.location.href = url;
      else openInNewTab(url); // popup refused outright: try a plain link
    } catch {
      w?.close();
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`lq-chip${failed ? " is-failed" : ""}`}
      onClick={onClick}
      aria-busy={busy}
      aria-label={`Open ${file.name}${size ? `, ${size}` : ""}${failed ? " (could not open)" : ""}`}
      title={file.name}
    >
      {isImage ? <Thumb id={file.id} /> : <span className="lq-chip-thumb"><IconFile /></span>}
      <span className="lq-chip-name">{file.name}</span>
      {size && <span className="lq-chip-size">{size}</span>}
    </button>
  );
}
