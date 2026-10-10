import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import {
  renderDiffWithHighlighter,
  renderFileWithHighlighter,
  getHighlighterThemeStyles,
  parsePatchFiles,
  type DiffsHighlighter,
} from "@pierre/diffs";
import {
  compareRuns,
  diagnosticTheme,
  normalizedRuns,
  renderFile,
  renderOptions,
  themeNames,
  twinkleplop,
} from "../../helpers/highlighting/parity";

import { compactFile, expandCompactFile } from "../../src/web/highlighting/compact-file";

let reference: Awaited<ReturnType<typeof createHighlighter>>;
let actual: Awaited<ReturnType<typeof twinkleplop>>;
beforeAll(async () => {
  reference = await createHighlighter({
    themes: ["github-light", "github-dark", diagnosticTheme],
    langs: ["java", "cpp", "json", "jsonc"],
    engine: createJavaScriptRegexEngine(),
  });
  actual = await twinkleplop(themeNames.map((n) => reference.getTheme(n)));
});
afterAll(() => {
  reference?.dispose();
  actual?.dispose();
});
const fixtures = [
  "java.java",
  "java-edge.java",
  "cpp.cpp",
  "cpp-edge.cpp",
  "java-doc.java",
  "cpp-raw.cpp",
  "json.json",
  "json-edge.json",
  "jsonc.jsonc",
];
const languageOf = (name: string) => name.slice(name.lastIndexOf(".") + 1);
function compare(
  expected: Parameters<typeof normalizedRuns>[0],
  observed: Parameters<typeof normalizedRuns>[0],
  theme: string,
) {
  const t = reference.getTheme(theme);
  return compareRuns(normalizedRuns(expected, t.fg, t.bg), normalizedRuns(observed, t.fg, t.bg));
}
describe("compact files through Pierre's renderer contract", () => {
  it.each(fixtures)(
    "preserves complete HAST for %s, including lines opened out of order",
    (name) => {
      const lang = languageOf(name);
      const source = readFileSync(
        new URL(`../fixtures/highlighting/${name}`, import.meta.url),
        "utf8",
      );
      for (const ending of ["\n", "\r\n", "\r"])
        for (const theme of [...themeNames, { light: "github-light", dark: "github-dark" }])
          for (const useTokenTransformer of [false, true]) {
            const text = source.replaceAll("\n", ending);
            const expected = renderFileWithHighlighter(
              { name, lang, contents: text },
              actual as unknown as DiffsHighlighter,
              { theme, useTokenTransformer, tokenizeMaxLineLength: 1000 },
            );
            const packet = compactFile(
              text,
              actual,
              {
                lang,
                ...(typeof theme === "string" ? { theme } : { themes: theme }),
                cssVariablePrefix: "--diffs-token-",
                tokenizeMaxLineLength: 1000,
              },
              {
                themeStyles: getHighlighterThemeStyles({
                  theme,
                  highlighter: actual as unknown as DiffsHighlighter,
                }),
                baseThemeType:
                  typeof theme === "string"
                    ? (actual.getTheme(theme).type as "light" | "dark")
                    : undefined,
                useTokenTransformer,
              },
            );
            const result = expandCompactFile(JSON.parse(JSON.stringify(packet)));
            const last = result.code.length - 1;
            expect(JSON.parse(JSON.stringify(result.code[last]))).toEqual(
              JSON.parse(JSON.stringify(expected.code[last])),
            );
            expect(JSON.parse(JSON.stringify(result))).toEqual(
              JSON.parse(JSON.stringify(expected)),
            );
          }
    },
  );
});

describe("In-house grammars through production language loading, adapter, and Pierre", () => {
  it.each(fixtures)(
    "matches the pinned Shiki renderer for %s in every theme and line ending",
    (name) => {
      const lang = languageOf(name);
      const source = readFileSync(
        new URL(`../fixtures/highlighting/${name}`, import.meta.url),
        "utf8",
      );
      for (const ending of ["\n", "\r\n", "\r"])
        for (const theme of themeNames) {
          const text = source.replaceAll("\n", ending);
          expect(
            compare(
              renderFile(text, lang, theme, reference).code,
              renderFile(text, lang, theme, actual).code,
              theme,
            ),
            `${name} ${theme} ${JSON.stringify(ending)}`,
          ).toEqual([]);
        }
    },
  );
  it.each([
    ["java", "int count = 42;", "int count = 43;"],
    ["cpp", "int count = 42;", "int count = 43;"],
    ["json", '  "count": 42,', '  "count": 43,'],
  ])("matches both diff sides and preserves word-change markers for %s", (lang, before, after) => {
    const patch = `diff --git a/sample.${lang} b/sample.${lang}\n--- a/sample.${lang}\n+++ b/sample.${lang}\n@@ -1,3 +1,3 @@\n // example\n-${before}\n+${after}\n \n`;
    const diff = parsePatchFiles(patch)[0].files[0];
    for (const theme of themeNames) {
      const a = renderDiffWithHighlighter(
        diff,
        reference as unknown as DiffsHighlighter,
        renderOptions(theme),
      );
      const b = renderDiffWithHighlighter(
        diff,
        actual as unknown as DiffsHighlighter,
        renderOptions(theme),
      );
      for (const side of ["additionLines", "deletionLines"] as const) {
        expect(compare(a.code[side], b.code[side], theme)).toEqual([]);
        const marked = (nodes: typeof a.code.additionLines): string[] =>
          nodes.flatMap((node) => {
            if (node.type !== "element") return [];
            return [
              ...(node.properties["data-diff-span"] !== undefined
                ? [JSON.stringify(node.children)]
                : []),
              ...marked(node.children as typeof nodes),
            ];
          });
        expect(marked(b.code[side]).length).toBeGreaterThan(0);
      }
    }
  });
  it("retains empty-line placeholders when token selection is disabled", () => {
    const file = { name: "sample.java", contents: "// first\n\n/* comment\n\nend */\n\n" };
    for (const theme of themeNames) {
      const options = { ...renderOptions(theme), useTokenTransformer: false };
      expect(
        compare(
          renderFileWithHighlighter(file, reference as unknown as DiffsHighlighter, options).code,
          renderFileWithHighlighter(file, actual as unknown as DiffsHighlighter, options).code,
          theme,
        ),
      ).toEqual([]);
    }
  });
  it("detects a real unhighlighted result and changed source instead of accepting a blank oracle", () => {
    const source = "int count = 42;";
    const a = renderFile(source, "cpp", "github-dark", reference);
    const b = renderFile(source, "text", "github-dark", actual);
    expect(compare(a.code, b.code, "github-dark").some((d) => d.text === "int")).toBe(true);
    expect(() =>
      compare(a.code, renderFile(source + "x", "cpp", "github-dark", actual).code, "github-dark"),
    ).toThrow("source text");
  });
  it.each(["java", "cpp", "json", "jsonc"])(
    "keeps partial edits, Unicode, and long lines intact for %s",
    (lang) => {
      for (const source of [
        "/* not closed\n\n😀",
        'const char* s = "unfinished',
        "int 日本語 = 1;\n",
        `/* ${"long ".repeat(10000)}\nnext line */\nint x = 1;`,
      ]) {
        const result = renderFile(source, lang, "github-dark", actual);
        const t = reference.getTheme("github-dark");
        expect(
          normalizedRuns(result.code, t.fg, t.bg)
            .map((r) => r.text)
            .join(""),
        ).toBe(source);
      }
    },
  );
});
