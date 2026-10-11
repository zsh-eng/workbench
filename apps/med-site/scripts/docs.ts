// Renders Med's user guides (apps/med/docs) as the site's docs pages, at build
// time. They are the Markdown files that `med docs` prints, so the website and
// the app say the same thing; the page ships HTML only.
//
// Each heading gets GitHub's anchor, so links between the guides keep working.
// A link to another guide goes to its page; a link to any other file in the
// repository goes to GitHub. The build fails when a link between the guides
// names a missing section.
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { repository } from "../src/site.ts";

const guides = join(import.meta.dir, "../../med/docs");

/** The pages in the sidebar's order. The first one is /docs. */
export const pages = [
  { slug: "", file: "INSTALL.md", label: "Install", group: "Start" },
  { slug: "usage", file: "USAGE.md", label: "Using Med", group: "Guides" },
  {
    slug: "agents",
    file: "AGENT_INTEGRATION.md",
    label: "Agents",
    group: "Guides",
  },
  {
    slug: "vaults",
    file: "VAULTS.md",
    label: "Notes and vaults",
    group: "Guides",
  },
];

export interface DocPage {
  /** The file in dist/, such as docs.html or docs/usage.html. */
  output: string;
  title: string;
  description: string;
  /** HTML for the template's slots (src/docs.html). */
  slots: Record<"nav" | "content" | "toc" | "pager", string>;
}

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const href = (slug: string) => (slug ? `/docs/${slug}` : "/docs");

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const text = (node: Node): string =>
  node.type === "text" ? node.value! : (node.children ?? []).map(text).join("");

/** GitHub's heading anchor: lower case, without punctuation, with a hyphen
 * for each space. */
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");

const element = (
  tagName: string,
  properties: Record<string, unknown>,
  children: Node[],
): Node => ({ type: "element", tagName, properties, children });

/** The width and height of a PNG, from its header. */
function pngSize(file: string) {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Renders every page. `asset` gives the URL of a file that a guide shows. */
export function renderDocs(asset: (file: string) => string): DocPage[] {
  const anchors = new Map<string, Set<string>>();
  const links: { from: string; page: string; anchor: string }[] = [];

  const rendered = pages.map((page) => {
    const ids = new Set<string>();
    anchors.set(page.slug, ids);
    const toc: { depth: number; id: string; text: string }[] = [];
    let title = page.label;
    let description = "";
    let code = 0;

    const link = (url: string) => {
      if (/^[a-z][a-z+.-]*:/i.test(url) || url.startsWith("/")) return url;
      const [path = "", anchor = ""] = url.split("#");
      const target = path
        ? pages.find((other) => other.file === path)
        : page;
      if (target) {
        if (anchor) links.push({ from: page.file, page: target.slug, anchor });
        return `${href(target.slug)}${anchor ? `#${anchor}` : ""}`;
      }
      return `${repository}/blob/main/${normalize(join("apps/med/docs", path))}${anchor ? `#${anchor}` : ""}`;
    };

    const visit = (node: Node, parent?: Node) => {
      const tag = node.tagName;
      if (tag === "h1") title = text(node);
      if (tag === "p" && !description && parent?.type === "root")
        description = text(node).replace(/\s+/g, " ").trim();
      if (tag === "h2" || tag === "h3") {
        const base = slug(text(node));
        let id = base;
        for (let n = 1; ids.has(id); n += 1) id = `${base}-${n}`;
        ids.add(id);
        node.properties = { ...node.properties, id };
        toc.push({ depth: Number(tag[1]), id, text: text(node) });
      }
      if (tag === "a" && typeof node.properties?.href === "string")
        node.properties.href = link(node.properties.href);
      if (tag === "img" && typeof node.properties?.src === "string") {
        const file = join(guides, node.properties.src);
        node.properties = {
          ...node.properties,
          src: asset(file),
          ...pngSize(file),
          loading: "lazy",
          decoding: "async",
        };
      }
      node.children?.forEach((child) => visit(child, node));
    };

    // Code gets a copy button (src/main.js); a wide table scrolls by itself.
    const wrap = (node: Node) => {
      node.children = node.children?.map((child) => {
        if (child.tagName === "pre") {
          code += 1;
          const id = `code-${code}`;
          const inner = child.children?.find((part) => part.tagName === "code");
          if (inner) inner.properties = { ...inner.properties, id };
          return element("div", { className: ["code"] }, [
            element(
              "button",
              {
                type: "button",
                className: ["copy"],
                dataCopy: id,
                dataDone: "Copied the code.",
              },
              [
                element("span", { className: ["copy-label"] }, [
                  { type: "text", value: "Copy" },
                ]),
                element("span", { className: ["sr-only"] }, [
                  { type: "text", value: " the code" },
                ]),
              ],
            ),
            child,
          ]);
        }
        if (child.tagName === "table")
          return element("div", { className: ["table"] }, [child]);
        wrap(child);
        return child;
      });
    };

    const content = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(() => (tree: Node) => {
        visit(tree);
        wrap(tree);
      })
      .use(rehypeStringify)
      .processSync(readFileSync(join(guides, page.file), "utf8"))
      .toString();
    return { page, title, description, content, toc };
  });

  for (const { from, page, anchor } of links)
    if (!anchors.get(page)?.has(anchor))
      throw new Error(`${from} links to a missing section: ${href(page)}#${anchor}`);

  return rendered.map(({ page, title, description, content, toc }, index) => {
    const nav = [...new Set(pages.map((other) => other.group))]
      .map(
        (group) =>
          `<p>${escape(group)}</p><ul>${pages
            .filter((other) => other.group === group)
            .map(
              (other) =>
                `<li><a href="${href(other.slug)}"${other === page ? ' aria-current="page"' : ""}>${escape(other.label)}</a></li>`,
            )
            .join("")}</ul>`,
      )
      .join("");
    const sections = toc
      .map(
        (entry) =>
          `<li${entry.depth === 3 ? ' class="sub"' : ""}><a href="#${entry.id}">${escape(entry.text)}</a></li>`,
      )
      .join("");
    const step = (other: (typeof pages)[number] | undefined, rel: string) =>
      other
        ? `<a rel="${rel}" href="${href(other.slug)}"><span>${rel === "prev" ? "Previous" : "Next"}</span>${escape(other.label)}</a>`
        : "<span></span>";
    const source = `${repository}/blob/main/apps/med/docs/${page.file}`;
    return {
      output: page.slug ? `docs/${page.slug}.html` : "docs.html",
      title: `${title} · Med`,
      description,
      slots: {
        nav,
        content,
        toc: sections,
        pager: `${step(pages[index - 1], "prev")}${step(pages[index + 1], "next")}<p class="edit"><a href="${source}">Edit this page on GitHub</a></p>`,
      },
    };
  });
}
