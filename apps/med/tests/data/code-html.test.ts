import { expect, test } from "vitest";
import type { ElementContent } from "hast";
import { unified } from "unified";
import rehypeStringify from "rehype-stringify";
import { codeHtml } from "../../src/web/markdown/code-html";
import type { StyledToken } from "../../src/web/highlighting/highlighter";

const stringify = unified().use(rehypeStringify);

test("a code block's HTML is what rehype-stringify writes for the same spans", () => {
  const token = (content: string, style = "color:#9fd0b4") => ({ content, offset: 0, style });
  const lines: StyledToken[][] = [
    [token("if (a < b && c > d) {"), token(' "quoted" ', "color:#fff;font-style:italic")],
    [token("  return '&amp;' + `<tag>`;", 'font-family:"Mono" & co')],
    [],
    [token(""), token("emoji 🧪 and   and \u0007", "")],
    [token("</code></pre><script>alert(1)</script>")],
  ];
  const spans: ElementContent[] = lines.flatMap((line, index) => [
    ...(index ? [{ type: "text" as const, value: "\n" }] : []),
    ...line.map((each) => ({
      type: "element" as const,
      tagName: "span",
      properties: { style: each.style },
      children: [{ type: "text" as const, value: each.content }],
    })),
  ]);
  expect(codeHtml(lines)).toBe(stringify.stringify({ type: "root", children: spans }));
});
