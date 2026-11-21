import { memo, useState, type ImgHTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Element, ElementContent } from "hast";
import { part } from "../parts";
import { CopyButton } from "./CopyButton";

const SAFE_PROTOCOL = /^(https?|mailto)$/i;

/**
 * Allow only http:, https:, mailto: and relative URLs; everything else becomes "".
 * A colon after the first "/", "?" or "#" is part of a relative URL, not a scheme.
 */
export function safeUrl(url: string): string {
  const colon = url.indexOf(":");
  if (colon === -1) return url;
  for (const ch of ["/", "?", "#"]) {
    const i = url.indexOf(ch);
    if (i !== -1 && i < colon) return url;
  }
  return SAFE_PROTOCOL.test(url.slice(0, colon)) ? url : "";
}

function hastText(node: ElementContent | Element): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(hastText).join("");
  return "";
}

function codeLanguage(pre: Element | undefined): string | null {
  const code = pre?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const cls: unknown = code?.properties?.className;
  const list: string[] = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? cls.split(" ") : [];
  const lang = list.find((c) => c.startsWith("language-"));
  return lang ? lang.slice("language-".length) : null;
}

/** An image that falls back to its alt text if it fails to load (e.g. blocked by the CSP). */
function SafeImage({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="lq-img-blocked">{alt || "Image unavailable"}</span>;
  return <img {...rest} src={src} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} />;
}

const components: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a {...rest} href={href || undefined} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ node: _node, ...rest }) => <SafeImage {...rest} />,
  pre: ({ node, children }) => {
    const lang = codeLanguage(node);
    return (
      <div className="lq-code" {...part("code-block")}>
        <div className="lq-code-bar">
          <span className="lq-code-lang">{lang ?? "text"}</span>
          <CopyButton text={node ? hastText(node).replace(/\n$/, "") : ""} label="Copy code" compact />
        </div>
        <pre>{children}</pre>
      </div>
    );
  },
  table: ({ node: _node, ...rest }) => (
    <div className="lq-table-wrap">
      <table {...rest} />
    </div>
  ),
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex, rehypeHighlight];

/** Agent markdown. Raw HTML is dropped (skipHtml) and URLs are restricted; never add rehype-raw here. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="lq-md" {...part("markdown")}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        skipHtml
        urlTransform={safeUrl}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
