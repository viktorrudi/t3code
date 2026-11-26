import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

function object(value: unknown): Record<string, unknown> {
  return Predicate.isObject(value) ? value : {};
}

const escape = (text: string) => text.replace(/[\\`*_{}[\]<>#|]/gu, "\\$&");
const safeUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href.replace(/\(/gu, "%28").replace(/\)/gu, "%29")
      : null;
  } catch {
    return null;
  }
};

/** ADF is rendered as Markdown, never as Jira-supplied HTML. */
export function jiraDocument(value: unknown): string {
  let remaining = 20_000;
  const render = (input: unknown, depth: number, plain = false): string => {
    if (depth > 30 || remaining-- <= 0) return "";
    if (typeof input === "string") return plain ? input : escape(input);
    const node = object(input);
    const attrs = object(node.attrs);
    const children = Array.isArray(node.content) ? node.content : [];
    const inner = (raw = plain) => children.map((c) => render(c, depth + 1, raw)).join("");
    if (node.type === "text") {
      const raw = typeof node.text === "string" ? node.text : "";
      if (plain) return raw;
      const marks = Array.isArray(node.marks) ? node.marks.map(object) : [];
      const code = marks.some((mark) => mark.type === "code");
      const fence = "`".repeat(
        Math.max(0, ...[...raw.matchAll(/`+/gu)].map((m) => m[0].length)) + 1,
      );
      let text = code ? `${fence} ${raw} ${fence}` : escape(raw);
      for (const mark of marks) {
        if (mark.type === "strong") text = `**${text}**`;
        if (mark.type === "em") text = `*${text}*`;
        if (mark.type === "strike") text = `~~${text}~~`;
        if (mark.type === "link") {
          const url = safeUrl(object(mark.attrs).href);
          if (url) text = `[${text}](${url})`;
        }
      }
      return text;
    }
    switch (node.type) {
      case "doc":
        return inner().trim();
      case "paragraph":
        return `${inner()}\n\n`;
      case "heading":
        return `${"#".repeat(Math.min(6, Math.max(1, Number(attrs.level) || 1)))} ${inner()}\n\n`;
      case "hardBreak":
        return "  \n";
      case "rule":
        return "\n---\n\n";
      case "bulletList":
      case "orderedList":
        return (
          children
            .map((c, i) => {
              const prefix =
                node.type === "orderedList" ? `${(Number(attrs.order) || 1) + i}. ` : "- ";
              return (
                prefix +
                render(c, depth + 1)
                  .trim()
                  .replace(/\n/gu, `\n${" ".repeat(prefix.length)}`)
              );
            })
            .join("\n") + "\n\n"
        );
      case "listItem":
        return inner();
      case "blockquote":
      case "panel":
        return (
          inner()
            .trim()
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n") + "\n\n"
        );
      case "codeBlock": {
        const body = inner(true).trimEnd();
        const fence = "`".repeat(
          Math.max(2, ...[...body.matchAll(/`+/gu)].map((m) => m[0].length)) + 1,
        );
        const language =
          typeof attrs.language === "string" ? attrs.language.replace(/[^\w+-]/gu, "") : "";
        return `${fence}${language}\n${body}\n${fence}\n\n`;
      }
      case "mention":
        return escape(typeof attrs.text === "string" ? attrs.text : "@user");
      case "emoji":
        return escape(String(attrs.text ?? attrs.shortName ?? ""));
      case "status":
        return escape(String(attrs.text ?? ""));
      case "date": {
        const date = DateTime.make(Number(attrs.timestamp));
        return Option.isSome(date) ? DateTime.formatIso(date.value).slice(0, 10) : "";
      }
      case "inlineCard":
      case "blockCard": {
        const url = safeUrl(attrs.url);
        return url ? `[${escape(String(attrs.url))}](${url})` : "";
      }
      case "media":
      case "mediaInline": {
        const url = safeUrl(attrs.url);
        const label = escape(String(attrs.alt ?? "Attachment"));
        return url ? `[${label}](${url})` : `(${label}, see attachments)`;
      }
      case "table": {
        const rows = children.map((row) => {
          const cells = object(row).content;
          return Array.isArray(cells)
            ? cells.map((cell) =>
                render(cell, depth + 1)
                  .trim()
                  .replace(/\n+/gu, " "),
              )
            : [];
        });
        const width = Math.max(0, ...rows.map((row) => row.length));
        if (!width) return "";
        const format = (row: string[]) =>
          `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
        return (
          [
            format(rows[0] ?? []),
            format(Array.from({ length: width }, () => "---")),
            ...rows.slice(1).map(format),
          ].join("\n") + "\n\n"
        );
      }
      case "expand":
      case "nestedExpand":
        return `${escape(String(attrs.title ?? ""))}\n\n${inner()}`;
      default:
        return inner();
    }
  };
  return render(value, 0).slice(0, 200_000).trim();
}
