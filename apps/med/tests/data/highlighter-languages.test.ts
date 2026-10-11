import { afterEach, describe, expect, it, vi } from "vitest";
import { createTwinkleplopAdapter } from "../../src/web/highlighting/adapter";
import type { TokenizeResult } from "@twinkleplop/core";

function ranges(result: TokenizeResult, source: string) {
  const spans: { kind: string; start: number; end: number; text: string }[] = [];
  for (let index = 0; index < result.tokens.length; index += 3) {
    const kind = result.tokens[index];
    const start = result.tokens[index + 1];
    const end = result.tokens[index + 2];
    expect(start).toBeGreaterThanOrEqual(spans.at(-1)?.end ?? 0);
    expect(end).toBeGreaterThanOrEqual(start);
    expect(end).toBeLessThanOrEqual(source.length);
    spans.push({ kind: result.token_types[kind], start, end, text: source.slice(start, end) });
  }
  return spans;
}

afterEach(() => {
  vi.doUnmock("@twinkleplop/python");
  vi.resetModules();
});

describe("Twinkleplop language loading", () => {
  it("resolves registered aliases and rejects unsupported names", async () => {
    const { supportedLanguage, ensureLanguages, tokenize } =
      await import("../../src/web/highlighting/languages");
    expect(supportedLanguage("ts")).toBe("typescript");
    expect(supportedLanguage("jsx")).toBe("tsx");
    expect(supportedLanguage("md")).toBe("markdown");
    expect(supportedLanguage("sh")).toBe("bash");
    for (const name of ["zig", "unknown", "constructor", "toString", "__proto__"]) {
      expect(supportedLanguage(name)).toBeUndefined();
      await expect(ensureLanguages([name])).resolves.toBeUndefined();
      expect(tokenize("plain source", name)).toBeUndefined();
    }
  });

  it("shares concurrent language loads and initializes the tokenizer once", async () => {
    const factory = vi.fn<(source: string) => TokenizeResult>(() => ({
      tokens: new Uint32Array(),
      token_types: [],
    }));
    const initialize = vi.fn<() => typeof factory>(() => factory);
    vi.doMock("@twinkleplop/python", () => ({ tokenize: initialize }));
    const { ensureLanguages, tokenize } = await import("../../src/web/highlighting/languages");
    await Promise.all([
      ensureLanguages(["python"]),
      ensureLanguages(["python", "python"]),
      ensureLanguages(["python"]),
    ]);
    expect(initialize).toHaveBeenCalledTimes(1);
    tokenize("def main(): pass", "python");
    expect(factory).toHaveBeenCalledWith("def main(): pass");
  });

  it("permits retry after tokenizer initialization fails", async () => {
    const factory = vi.fn<(source: string) => TokenizeResult>(() => ({
      tokens: new Uint32Array(),
      token_types: [],
    }));
    const initialize = vi
      .fn<() => typeof factory>()
      .mockImplementationOnce(() => {
        throw new Error("temporary initialization failure");
      })
      .mockReturnValue(factory);
    vi.doMock("@twinkleplop/python", () => ({ tokenize: initialize }));
    const { ensureLanguages, tokenize } = await import("../../src/web/highlighting/languages");
    await expect(ensureLanguages(["python"])).rejects.toThrow("temporary initialization failure");
    await expect(ensureLanguages(["python"])).resolves.toBeUndefined();
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(tokenize("def main(): pass", "python")).toBeDefined();
  });

  it.each(["\n", "\r\n"])(
    "highlights fenced TypeScript with valid UTF-16 %j source offsets",
    async (ending) => {
      const { prepareSource, tokenize } = await import("../../src/web/highlighting/languages");
      const source = [
        "# 😀 Example",
        "",
        "```ts",
        'const greeting = "😀 café";',
        "export const answer = 42;",
        "```",
        "",
      ].join(ending);
      await prepareSource("md", source);
      const spans = ranges(tokenize(source, "md")!, source);
      expect(spans.some((span) => span.kind === "keyword" && span.text === "export")).toBe(true);
      expect(spans.some((span) => span.kind === "number" && span.text === "42")).toBe(true);
      expect(spans.some((span) => span.kind === "code_fence")).toBe(true);
      const adapter = createTwinkleplopAdapter({
        tokenize,
        getTheme: () => ({ name: "test", fg: "#fff", bg: "#000" }),
      });
      expect(() => adapter.codeToHast(source, { lang: "markdown", theme: "test" })).not.toThrow();
    },
  );

  it("loads aliases for several fences and retains unsupported fenced code as text", async () => {
    const { prepareSource, tokenize } = await import("../../src/web/highlighting/languages");
    const source = [
      "```ts",
      "export const total = 42;",
      "```",
      "~~~py",
      "def name():",
      "    return 42",
      "~~~",
      "```zig",
      'const thing = @import("std");',
      "```",
    ].join("\n");
    await prepareSource("markdown", source);
    const spans = ranges(tokenize(source, "markdown")!, source);
    expect(spans.some((span) => span.kind === "keyword" && span.text === "export")).toBe(true);
    expect(spans.some((span) => span.kind === "keyword" && span.text === "def")).toBe(true);
    expect(
      spans.some((span) => span.kind === "raw_code_block" && span.text.includes("@import")),
    ).toBe(true);
  });

  it("highlights an unclosed fence through the end of source", async () => {
    const { prepareSource, tokenize } = await import("../../src/web/highlighting/languages");
    const source = "```typescript\nexport const count = 42;";
    await prepareSource("markdown", source);
    const spans = ranges(tokenize(source, "markdown")!, source);
    expect(spans.some((span) => span.kind === "keyword" && span.text === "export")).toBe(true);
    expect(spans.some((span) => span.kind === "number" && span.text === "42")).toBe(true);
  });

  it("preloads embedded languages even when Markdown itself is already loaded", async () => {
    const { ensureLanguages, tokenize } = await import("../../src/web/highlighting/languages");
    await ensureLanguages(["markdown"]);
    expect(tokenize("def name(): pass", "python")).toBeUndefined();
    await ensureLanguages(["markdown"], true);
    expect(tokenize("def name(): pass", "python")).toBeDefined();
  });
});

const languageSamples = {
  javascript:
    "const greeting = `Hello ${user.name} 😀`;\nconst pattern = /[a-z]+/giu;\n// comment\n",
  typescript:
    'interface Item<T> { value: T; }\nexport const item: Item<string> = { value: "😀" };\n',
  tsx: 'export const View = ({name}: {name: string}) => <div className="card">Hello {name} 😀</div>;\n',
  css: ':root { --accent: #ff00aa; }\n.card:hover::before { content: "😀"; color: var(--accent); }\n',
  html: '<!doctype html>\n<div title="😀">Hello &amp; world</div>\n<script>const count = 2;</script>\n<style>.card { color: red; }</style>\n',
  json: '{\n  "greeting": "😀",\n  "items": [true, null, 2.5]\n}\n',
  jsonc: '{\n  // comment\n  "greeting": "😀",\n  "items": [true, null,],\n}\n',
  markdown:
    "# 😀 Title\n\n**bold** and [link](https://example.com)\n\n```ts\nexport const count = 42;\n```\n",
  yaml: 'greeting: "😀"\nitems:\n  - &first { value: 42 }\n  - *first\ndescription: |\n  two lines\n  of text\n',
  toml: 'title = "😀"\n[package]\nversion = "1.0.0"\nitems = [1, 2, 3]\ncreated = 2026-09-24T10:00:00Z\n',
  bash: '#!/bin/bash\nname="😀"\nprintf "%s\\n" "$name"\ncat <<EOF\nhello $name\nEOF\n',
  go: 'package main\nimport "fmt"\nfunc main() { fmt.Println("😀") }\n',
  python:
    '@decorate\ndef greet(name: str) -> str:\n    """A greeting."""\n    return f"Hello {name} 😀"\n',
  rust: 'fn greet(name: &str) -> String {\n    format!("Hello {} 😀", name)\n}\n',
  sql: "-- 😀 comment\nSELECT name, COUNT(*) AS total FROM users\nWHERE name LIKE 'A%' GROUP BY name;\n",
  svelte:
    '<script lang="ts">\nlet name: string = "😀";\n</script>\n<style>p { color: red; }</style>\n{#if name}<p>Hello {name}</p>{/if}\n',
  diff: "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after 😀\n",
  ini: "; 😀 comment\n[section]\nname=value\nenabled=true\n",
  http: 'POST https://example.com/api HTTP/1.1\nContent-Type: application/json\n\n{"greeting": "😀"}\n',
  dotenv:
    '# 😀 comment\nAPI_URL="https://example.com"\nexport NAME=reader\nMESSAGE="Hello ${NAME}"\n',
  shellsession: '$ echo "😀"\n😀\n$ pwd\n/tmp/project\n',
  xml: '<?xml version="1.0"?>\n<!-- 😀 -->\n<note xs:id="1">Fish &amp; chips<![CDATA[ a < b ]]></note>\n',
};

describe("shipped tokenizer adapter smoke checks", () => {
  it.each(Object.entries(languageSamples))(
    "preserves %s source and valid token ranges",
    async (language, sample) => {
      const { prepareSource, tokenize } = await import("../../src/web/highlighting/languages");
      await prepareSource(language, sample);
      for (const source of [sample, sample.replaceAll("\n", "\r\n")]) {
        const result = tokenize(source, language);
        expect(result).toBeDefined();
        expect(ranges(result!, source).length).toBeGreaterThan(0);
        const instance = createTwinkleplopAdapter({
          tokenize,
          getTheme: () => ({ name: "test", fg: "#fff", bg: "#000" }),
        });
        const rendered = instance.codeToHast(source, { lang: language, theme: "test" });
        const pre = rendered.children[0] as import("hast").Element;
        const code = pre.children[0] as import("hast").Element;
        const text = (node: import("hast").RootContent): string =>
          node.type === "text"
            ? node.value
            : "children" in node
              ? node.children.map(text).join("")
              : "";
        expect(code.children.map(text)).toEqual(sample.split("\n"));
      }
    },
  );

  it("retains word decorations and embedded token colours in a real Pierre Markdown diff", async () => {
    const { prepareSource, tokenize } = await import("../../src/web/highlighting/languages");
    const { renderDiffWithHighlighter, parsePatchFiles } = await import("@pierre/diffs");
    const patch =
      "diff --git a/example.md b/example.md\n--- a/example.md\n+++ b/example.md\n@@ -8,3 +8,3 @@\n ```ts\n-export const count = 10;\n+export const count = 20;\n ```\n";
    const diff = parsePatchFiles(patch)[0].files[0];
    await Promise.all([
      prepareSource("markdown", diff.additionLines.join("")),
      prepareSource("markdown", diff.deletionLines.join("")),
    ]);
    const instance = createTwinkleplopAdapter({
      tokenize,
      getTheme: () => ({
        name: "test",
        fg: "#fff",
        bg: "#000",
        tokenColors: [{ scope: "keyword", settings: { foreground: "#ff0000" } }],
      }),
    });
    const rendered = renderDiffWithHighlighter(
      diff,
      instance as unknown as import("@pierre/diffs").DiffsHighlighter,
      {
        theme: "test",
        useTokenTransformer: true,
        lineDiffType: "word-alt",
        maxLineDiffLength: 1000,
        tokenizeMaxLineLength: 1000,
      },
    );
    const text = (node: import("hast").RootContent): string =>
      node.type === "text"
        ? node.value
        : "children" in node
          ? node.children.map(text).join("")
          : "";
    const elements = (node: import("hast").RootContent): import("hast").Element[] => [
      ...(node.type === "element" ? [node] : []),
      ...("children" in node ? node.children.flatMap(elements) : []),
    ];
    for (const [lines, changed] of [
      [rendered.code.deletionLines, "10"],
      [rendered.code.additionLines, "20"],
    ] as const) {
      expect(lines.map((line) => (line as import("hast").Element).properties["data-line"])).toEqual(
        [8, 9, 10],
      );
      expect(
        lines
          .flatMap(elements)
          .filter((node) => node.properties["data-diff-span"] !== undefined)
          .map(text)
          .join(""),
      ).toBe(changed);
      expect(
        lines
          .flatMap(elements)
          .some(
            (node) =>
              text(node) === "export" && String(node.properties.style).includes("color:#ff0000"),
          ),
      ).toBe(true);
    }
  });
});
