import { memo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { ExternalLink, Zap, Send } from "lucide-react";
import { motion } from "motion/react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface XmlNode {
  type: "text" | "element";
  tag?: string;
  attrs?: Record<string, string>;
  children?: (XmlNode | string)[];
  raw?: string;
}

// ─── Simple XML parser ────────────────────────────────────────────────────────

function parseXml(input: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  let i = 0;

  const KNOWN_TAGS = [
    "final-text",
    "presentation-actions",
    "presentation-suggestion",
    "presentation-link",
    "presentation-open-publish",
    "lov-actions",
    "lov-write",
    "lov-add-dependency",
  ];

  const tagPattern = new RegExp(
    `<(/?)(${KNOWN_TAGS.join("|")})((?:\\s+[^>]*)?)>`,
    "i"
  );

  while (i < input.length) {
    const rest = input.slice(i);
    const match = rest.match(tagPattern);

    if (!match) {
      // No more known tags — rest is plain text
      nodes.push({ type: "text", raw: rest });
      break;
    }

    const matchIndex = rest.indexOf(match[0]);

    // Text before the tag
    if (matchIndex > 0) {
      nodes.push({ type: "text", raw: rest.slice(0, matchIndex) });
    }

    const isClosing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attrStr = match[3].trim();

    // Parse attributes
    const attrs: Record<string, string> = {};
    const attrRegex = /(\w[\w-]*)=["']([^"']*)["']/g;
    let am: RegExpExecArray | null;
    while ((am = attrRegex.exec(attrStr)) !== null) {
      attrs[am[1]] = am[2];
    }

    i += matchIndex + match[0].length;

    if (!isClosing) {
      // Find closing tag
      const closeTag = `</${tag}>`;
      const closeIdx = input.toLowerCase().indexOf(closeTag, i);

      let innerContent = "";
      if (closeIdx !== -1) {
        innerContent = input.slice(i, closeIdx);
        i = closeIdx + closeTag.length;
      } else {
        // Self-closing or unclosed — grab rest
        innerContent = input.slice(i);
        i = input.length;
      }

      // Recursively parse inner content
      const children = parseXml(innerContent);
      nodes.push({ type: "element", tag, attrs, children });
    }
    // Skip closing tags (already consumed above)
  }

  return nodes;
}

// ─── Renderers ────────────────────────────────────────────────────────────────

interface RenderProps {
  onSuggestion?: (message: string) => void;
}

function renderNodes(nodes: (XmlNode | string)[], props: RenderProps): React.ReactNode[] {
  return nodes.map((node, i) => {
    if (typeof node === "string") {
      return <MarkdownText key={i} text={node} />;
    }
    if (node.type === "text") {
      return <MarkdownText key={i} text={node.raw || ""} />;
    }
    return renderElement(node, i, props);
  });
}

function renderElement(node: XmlNode, key: number, props: RenderProps): React.ReactNode {
  const children = node.children || [];
  const innerText = children
    .map(c => (typeof c === "string" ? c : c.raw || ""))
    .join("")
    .trim();

  switch (node.tag) {
    case "final-text":
      return (
        <div key={key} className="mt-1">
          {renderNodes(children, props)}
        </div>
      );

    case "presentation-actions":
      return (
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-wrap gap-1.5 mt-3 -mx-0.5"
        >
          {renderNodes(children, props)}
        </motion.div>
      );

    case "presentation-suggestion": {
      const message = node.attrs?.message || innerText;
      return (
        <motion.button
          key={key}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => props.onSuggestion?.(message)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium
            border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40
            text-primary/80 hover:text-primary transition-all cursor-pointer text-left"
        >
          <Send size={10} className="shrink-0 opacity-60" />
          <span>{innerText}</span>
        </motion.button>
      );
    }

    case "presentation-link": {
      const url = node.attrs?.url || "#";
      return (
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium
            border border-border/50 bg-muted/40 hover:bg-muted/80
            text-muted-foreground hover:text-foreground transition-all"
        >
          <ExternalLink size={10} className="shrink-0" />
          <span>{innerText}</span>
        </a>
      );
    }

    case "presentation-open-publish":
      return (
        <motion.button
          key={key}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            // Trigger publish flow — could be wired up later
            alert("Publish: Configure your deployment settings.");
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium
            border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20
            text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/50 transition-all"
        >
          <Zap size={10} className="shrink-0" />
          <span>{innerText || "Publish your app"}</span>
        </motion.button>
      );

    default:
      // Unknown tag — render children as-is
      return <span key={key}>{renderNodes(children, props)}</span>;
  }
}

// ─── Markdown text block ──────────────────────────────────────────────────────

const MarkdownText = memo(({ text }: { text: string }) => {
  if (!text.trim()) return null;
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert
      [&>p]:m-0 [&>p:not(:last-child)]:mb-2.5
      [&_strong]:font-semibold
      [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:border [&_code]:border-border/40
      [&_pre]:bg-muted [&_pre]:rounded-xl [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0
      [&_ul]:my-2 [&_ul]:pl-4 [&_ol]:my-2 [&_ol]:pl-4 [&_li]:my-0.5
      [&_a]:text-primary [&_a]:underline-offset-2
      [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:mt-3 [&_h2]:mt-2.5 [&_h3]:mt-2
      [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground
      [&_hr]:border-border/40 [&_hr]:my-3
      [&_table]:w-full [&_th]:text-left [&_th]:font-semibold [&_th]:text-xs [&_th]:pb-1 [&_td]:text-xs [&_td]:py-1">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
});

// ─── Main export ──────────────────────────────────────────────────────────────

export const XmlRenderer = memo(({ content, onSuggestion }: {
  content: string;
  onSuggestion?: (message: string) => void;
}) => {
  const nodes = parseXml(content);
  return <>{renderNodes(nodes, { onSuggestion })}</>;
});

export default XmlRenderer;
