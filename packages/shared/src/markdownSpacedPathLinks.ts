import type { Image, Link, Parents, PhrasingContent, Root, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { type Transformer, unified } from "unified";
import { isWindowsAbsolutePath } from "./path.ts";

type Point = NonNullable<Text["position"]>["start"];

/**
 * Agents often write `[label](/Users/me/My Project/file.png)` without the `<…>` CommonMark needs
 * for spaces, so the link renders as raw text. An absolute path cannot be prose, so these are
 * read as the link or image the agent meant.
 */
const SPACED_PATH_CLOSE =
  /\]\(((?:\/|file:\/\/|[A-Za-z]:[\\/])(?:[^()<>\n]|\([^()<>\n]*\))*?)(?:[ \t]+"([^"\n]*)")?\)/g;

interface Close {
  readonly index: number;
  readonly end: number;
  readonly rawUrl: string;
  readonly url: string;
  readonly title: string | undefined;
}

function findClose(value: string, from: number): Close | undefined {
  SPACED_PATH_CLOSE.lastIndex = from;
  for (let match; (match = SPACED_PATH_CLOSE.exec(value));) {
    const rawUrl = match[1]!;
    const url = rawUrl.trim();
    if (/\s/.test(url)) {
      return {
        index: match.index,
        end: match.index + match[0].length,
        rawUrl,
        url,
        title: match[2],
      };
    }
    SPACED_PATH_CLOSE.lastIndex = match.index + 1;
  }
  return undefined;
}

// The `[` that opens a label ending at `closeIndex` in `children[index]`, searching back over siblings.
function findOpen(children: PhrasingContent[], index: number, closeIndex: number) {
  for (let at = index; at >= 0; at--) {
    const child = children[at]!;
    if (child.type === "link" || child.type === "linkReference") return undefined;
    if (child.type !== "text") continue;
    const value = at === index ? child.value.slice(0, closeIndex) : child.value;
    const open = value.lastIndexOf("[");
    if (value.lastIndexOf("]") > open) return undefined;
    if (open >= 0) return { index: at, offset: open };
  }
  return undefined;
}

// Offsets into the source are known only where a text node reads exactly as written.
function sourceOffset(node: Text, source: string): number | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start !== undefined && end !== undefined && source.slice(start, end) === node.value
    ? start
    : undefined;
}

function pointAt(source: string, offset: number): Point {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  let line = 1;
  for (let at = source.indexOf("\n"); at !== -1 && at < offset; at = source.indexOf("\n", at + 1)) {
    line++;
  }
  return { line, column: offset - lineStart + 1, offset };
}

function textNode(value: string, start: number | undefined, source: string): Text {
  return start === undefined
    ? { type: "text", value }
    : {
        type: "text",
        value,
        position: { start: pointAt(source, start), end: pointAt(source, start + value.length) },
      };
}

const plainText = (nodes: ReadonlyArray<PhrasingContent>): string =>
  nodes
    .map((node) =>
      "value" in node ? node.value : "children" in node ? plainText(node.children) : "",
    )
    .join("");

type OnDestination = (start: number, end: number, url: string) => void;

function linkSpacedPaths(parent: Parents, source: string, onDestination?: OnDestination) {
  const children = parent.children as PhrasingContent[];
  let from = 0;
  for (let index = 0; index < children.length; index++) {
    const node = children[index]!;
    if (node.type !== "text") {
      if ("children" in node && node.type !== "link" && node.type !== "linkReference") {
        linkSpacedPaths(node, source, onDestination);
      }
      from = 0;
      continue;
    }
    const close = findClose(node.value, from);
    if (!close) {
      from = 0;
      continue;
    }
    const open = findOpen(children, index, close.index);
    if (!open) {
      from = close.index + 1;
      index--;
      continue;
    }
    from = 0;

    const opener = children[open.index] as Text;
    const isImage = open.offset > 0 && opener.value[open.offset - 1] === "!";
    const start = open.offset - (isImage ? 1 : 0);
    const label: PhrasingContent[] =
      open.index === index
        ? [{ type: "text", value: node.value.slice(open.offset + 1, close.index) }]
        : [
            { type: "text", value: opener.value.slice(open.offset + 1) },
            ...children.slice(open.index + 1, index),
            { type: "text", value: node.value.slice(0, close.index) },
          ];
    const labelChildren = label.filter((child) => child.type !== "text" || child.value !== "");

    const openerOffset = sourceOffset(opener, source);
    const closerOffset = sourceOffset(node, source);
    const position =
      openerOffset !== undefined && closerOffset !== undefined
        ? {
            start: pointAt(source, openerOffset + start),
            end: pointAt(source, closerOffset + close.end),
          }
        : undefined;
    if (closerOffset !== undefined) {
      const destinationStart = closerOffset + close.index + 2;
      onDestination?.(destinationStart, destinationStart + close.rawUrl.length, close.url);
    }

    const title = close.title ?? null;
    const replacement: Image | Link = isImage
      ? { type: "image", url: close.url, title, alt: plainText(labelChildren) }
      : { type: "link", url: close.url, title, children: labelChildren };
    if (position) replacement.position = position;

    const before = opener.value.slice(0, start);
    const after = node.value.slice(close.end);
    const nodes: PhrasingContent[] = [];
    if (before) nodes.push(textNode(before, openerOffset, source));
    nodes.push(replacement);
    if (after) {
      nodes.push(
        textNode(after, closerOffset === undefined ? undefined : closerOffset + close.end, source),
      );
    }
    children.splice(open.index, index - open.index + 1, ...nodes);
    index = open.index + (before ? 1 : 0);
  }
}

export function remarkSpacedPathLinks(): Transformer<Root> {
  return (tree, file) => linkSpacedPaths(tree, String(file));
}

const spacedPathParser = unified().use(remarkParse).use(remarkGfm);

/** The same links for parsers that read source text: destinations with spaces gain `<…>`. */
export function markdownWithAngledSpacedPathDestinations(markdown: string): string {
  if (!/\]\([^)\n]*\s/.test(markdown)) return markdown;
  const edits: Array<{ start: number; end: number; content: string }> = [];
  linkSpacedPaths(spacedPathParser.parse(markdown), markdown, (start, end, url) => {
    // Escapes still apply inside `<…>`; every backslash in a drive path is a separator.
    const escaped = isWindowsAbsolutePath(url) ? url.replace(/\\(?!&)/g, "\\\\") : url;
    edits.push({ start, end, content: `<${escaped}>` });
  });
  if (edits.length === 0) return markdown;
  edits.sort((a, b) => a.start - b.start);
  let result = "";
  let offset = 0;
  for (const edit of edits) {
    result += markdown.slice(offset, edit.start) + edit.content;
    offset = edit.end;
  }
  return result + markdown.slice(offset);
}
