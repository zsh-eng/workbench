import type { Element, Root, RootContent } from "hast";
import { renderFileWithHighlighter, type DiffsHighlighter } from "@pierre/diffs";
import { createHighlighter as createTwinkleplop } from "../../src/web/highlighting/runtime";
import type { AdapterTheme } from "../../src/web/highlighting/adapter";

export const diagnosticTheme = {
  name: "med-diagnostic",
  type: "dark" as const,
  fg: "#dddddd",
  bg: "#101010",
  tokenColors: [
    { scope: ["keyword", "storage"], settings: { foreground: "#ff5555" } },
    { scope: "comment", settings: { foreground: "#888888", fontStyle: "italic" } },
    { scope: "string", settings: { foreground: "#55ff55" } },
    { scope: "constant", settings: { foreground: "#5599ff" } },
    { scope: "entity.name.function", settings: { foreground: "#ff55ff", fontStyle: "bold" } },
    { scope: ["entity.name.type", "entity.name.namespace"], settings: { foreground: "#ffff55" } },
  ],
} satisfies AdapterTheme;
export const themeNames = ["github-light", "github-dark", "med-diagnostic"];
export async function twinkleplop(themes: AdapterTheme[]) {
  const h = await createTwinkleplop();
  for (const theme of themes) h.loadThemeSync(theme);
  for (const lang of ["java", "cpp", "json", "jsonc", "css", "go", "rust", "swift"])
    await h.prepareSource(lang, "");
  return h;
}
export const renderOptions = (theme: string) => ({
  theme,
  useTokenTransformer: true,
  lineDiffType: "word-alt" as const,
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: Infinity,
});
export function renderFile(source: string, lang: string, theme: string, highlighter: unknown) {
  return renderFileWithHighlighter(
    { name: `sample.${lang}`, lang, contents: source },
    highlighter as DiffsHighlighter,
    renderOptions(theme),
  );
}
export interface Style {
  color: string;
  background: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
}
export interface Run {
  start: number;
  end: number;
  text: string;
  style: Style;
}
const styleKey = (s: Style) =>
  `${s.color}|${s.background}|${s.fontWeight}|${s.fontStyle}|${s.textDecoration}`;
/** Compare visible text/style, independent of span boundaries or token names. */
export function normalizedRuns(nodes: (Root | RootContent)[], fg: string, bg: string): Run[] {
  const runs: Run[] = [];
  let offset = 0;
  function visit(node: Root | RootContent, inherited: Style) {
    if (node.type === "text") {
      if (!node.value) return;
      // Whitespace has no foreground ink. Keep backgrounds and decorations;
      // screenshot checks retain the real markup and catch geometry differences.
      for (const text of node.value.match(/\s+|\S+/g) ?? []) {
        const style =
          /^\s+$/.test(text) && inherited.textDecoration === "none"
            ? { ...inherited, color: fg.toLowerCase(), fontWeight: "normal", fontStyle: "normal" }
            : inherited;
        const previous = runs.at(-1);
        if (previous && styleKey(previous.style) === styleKey(style)) {
          previous.text += text;
          previous.end += text.length;
        } else runs.push({ start: offset, end: offset + text.length, text, style });
        offset += text.length;
      }
      return;
    }
    let style = inherited;
    if (node.type === "element") {
      const css = Object.fromEntries(
        String(node.properties.style ?? "")
          .split(";")
          .filter(Boolean)
          .map((item) => {
            const i = item.indexOf(":");
            return [item.slice(0, i).trim(), item.slice(i + 1).trim()];
          }),
      );
      style = {
        color: (css.color ?? inherited.color).toLowerCase(),
        background: (css["background-color"] ?? inherited.background).toLowerCase(),
        fontWeight: css["font-weight"] ?? inherited.fontWeight,
        fontStyle: css["font-style"] ?? inherited.fontStyle,
        textDecoration: css["text-decoration"] ?? inherited.textDecoration,
      };
    }
    if ("children" in node) for (const child of node.children) visit(child, style);
  }
  const base = {
    color: fg.toLowerCase(),
    background: bg.toLowerCase(),
    fontWeight: "normal",
    fontStyle: "normal",
    textDecoration: "none",
  };
  for (const [i, node] of nodes.entries()) {
    if (i) visit({ type: "text", value: "\n" }, base);
    visit(node, base);
  }
  return runs;
}
export function compareRuns(expected: Run[], actual: Run[]) {
  const expectedText = expected.map((r) => r.text).join("");
  const actualText = actual.map((r) => r.text).join("");
  if (expectedText !== actualText) throw new Error("Renderer changed source text or line endings");
  const differences: {
    start: number;
    end: number;
    text: string;
    expected: Style;
    actual: Style;
  }[] = [];
  let i = 0,
    j = 0;
  while (i < expected.length && j < actual.length) {
    const a = expected[i],
      b = actual[j],
      start = Math.max(a.start, b.start),
      end = Math.min(a.end, b.end);
    if (end > start && styleKey(a.style) !== styleKey(b.style))
      differences.push({
        start,
        end,
        text: expectedText.slice(start, end),
        expected: a.style,
        actual: b.style,
      });
    if (a.end <= b.end) i++;
    if (b.end <= a.end) j++;
  }
  return differences;
}
export function textContent(node: Root | RootContent): string {
  return node.type === "text"
    ? node.value
    : "children" in node
      ? node.children.map(textContent).join("")
      : "";
}
export function html(node: Root | RootContent): string {
  const escape = (s: string) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  if (node.type === "text") return escape(node.value);
  if (node.type === "root") return node.children.map(html).join("");
  if (node.type !== "element") return "";
  const props = (node as Element).properties;
  return `<${node.tagName}${Object.entries(props)
    .map(
      ([k, v]) =>
        ` ${k === "className" ? "class" : k}="${escape(Array.isArray(v) ? v.join(" ") : String(v))}"`,
    )
    .join("")}>${node.children.map(html).join("")}</${node.tagName}>`;
}
