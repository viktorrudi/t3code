import { expect, it } from "vite-plus/test";
import type { Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { CHAT_MARKDOWN_REMARK_PLUGINS } from "./markdownPipeline.ts";
import { markdownWithAngledSpacedPathDestinations } from "./markdownSpacedPathLinks.ts";

const processor = unified().use(remarkParse).use(CHAT_MARKDOWN_REMARK_PLUGINS);

it("reads links and images to absolute paths with spaces as links and images", () => {
  const shape = (node: Root | RootContent, source: string): string => {
    if (node.type === "text") return node.value;
    if (node.type === "inlineCode") return `\`${node.value}\``;
    if (node.type === "break") return "<br>";
    if (node.type === "image") return `<img ${node.url} alt="${node.alt}">`;
    const children = "children" in node ? node.children.map((c) => shape(c, source)).join("") : "";
    if (node.type === "link") {
      const { start, end } = node.position ?? {};
      const authored = source.slice(start?.offset, end?.offset);
      return `<a ${node.url}${node.title ? ` "${node.title}"` : ""} from=${authored}>${children}</a>`;
    }
    return children;
  };
  const render = (markdown: string) =>
    shape(processor.runSync(processor.parse(markdown), markdown) as Root, markdown);

  const dir = "/Users/me/Helado Viking 3D Render";
  expect(render(`![Front](${dir}/front.png)\nNext`)).toBe(
    `<img ${dir}/front.png alt="Front"><br>Next`,
  );
  expect(render(`See [the folder](${dir}) and [\`run.sh\`](${dir}/run.sh "Run") now.`)).toBe(
    `See <a ${dir} from=[the folder](${dir})>the folder</a> and ` +
      `<a ${dir}/run.sh "Run" from=[\`run.sh\`](${dir}/run.sh "Run")>\`run.sh\`</a> now.`,
  );
  expect(render(`[![Shot](${dir}/a (1).png)](${dir}/a (1).png)`)).toBe(
    `<a ${dir}/a (1).png from=[![Shot](${dir}/a (1).png)](${dir}/a (1).png)>` +
      `<img ${dir}/a (1).png alt="Shot"></a>`,
  );
  // Relative destinations with spaces stay prose, as does code.
  expect(render("Pick [one](two three) or `[a](/b c)`.")).toBe(
    "Pick [one](two three) or `[a](/b c)`.",
  );
});

it("wraps spaced path destinations for parsers that read source text", () => {
  const dir = "/Users/me/My Project";
  expect(
    markdownWithAngledSpacedPathDestinations(
      `![A](${dir}/a.png) and [\`b\`](${dir}/b.ts "B") but not [x](y z) or ](${dir}) or \`[c](${dir})\``,
    ),
  ).toBe(
    `![A](<${dir}/a.png>) and [\`b\`](<${dir}/b.ts> "B") but not [x](y z) or ](${dir}) or \`[c](${dir})\``,
  );
  expect(markdownWithAngledSpacedPathDestinations(String.raw`[d](C:\My Docs\d.png)`)).toBe(
    String.raw`[d](<C:\\My Docs\\d.png>)`,
  );
});
