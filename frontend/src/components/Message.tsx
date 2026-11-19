import type { ReactNode } from "react";
import type { Item } from "../state/reducer";
import { AttachmentChip } from "./AttachmentChip";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./Markdown";

type Msg = Extract<Item, { kind: "message" }>;

export function Message({ item, actions }: { item: Msg; actions?: ReactNode }) {
  if (item.role === "user") {
    return (
      <div className="lq-msg lq-msg-user">
        <span className="lq-sr">You said:</span>
        {item.attachments.length > 0 && (
          <div className="lq-chips">
            {item.attachments.map((a) => (
              <AttachmentChip key={a.id} file={a} />
            ))}
          </div>
        )}
        {item.text && <div className="lq-bubble">{item.text}</div>}
      </div>
    );
  }
  const empty = item.text === "";
  return (
    <div className={`lq-msg lq-msg-assistant${item.streaming ? " is-streaming" : ""}`}>
      <span className="lq-sr">Assistant said:</span>
      {item.attachments.length > 0 && (
        <div className="lq-chips">
          {item.attachments.map((a) => (
            <AttachmentChip key={a.id} file={a} />
          ))}
        </div>
      )}
      {empty && item.streaming ? <Typing /> : <Markdown text={item.text} />}
      {!item.streaming && !empty && (
        <div className="lq-msg-actions">
          <CopyButton text={item.text} label="Copy message" />
          {actions}
        </div>
      )}
    </div>
  );
}

export function Typing() {
  return (
    <span className="lq-typing" role="status">
      <span />
      <span />
      <span />
      <span className="lq-sr">Assistant is responding</span>
    </span>
  );
}
