import { expect, test } from "vitest";
import { definitionText } from "../../src/shared/definition-text";

test("a TypeScript function shows its declaration, without the body's brace, and its JSDoc", () => {
  const text = [
    "import { trails } from './trails';",
    "",
    "/**",
    ' * Lowercases and strips accents, so "pinnacle" matches "Pinnacle".',
    " *",
    " * @param value The text a person typed.",
    " */",
    "export function normalize(value: string): string {",
    "  return value.toLowerCase();",
    "}",
  ].join("\n");
  expect(definitionText(text, 8)).toEqual({
    signature: ["export function normalize(value: string): string"],
    doc: [
      'Lowercases and strips accents, so "pinnacle" matches "Pinnacle".',
      "",
      "@param value The text a person typed.",
    ],
  });
});

test("a declaration over several lines goes on until its brackets close", () => {
  const text = [
    "// Splits filter tokens such as `under:12km`.",
    "// Unknown tokens stay in the text.",
    "export function parseQuery(",
    "  input: string,",
    "  options: { strict?: boolean } = {},",
    "): SearchQuery {",
    "  return { text: input };",
    "}",
  ].join("\n");
  expect(definitionText(text, 3)).toEqual({
    signature: [
      "export function parseQuery(",
      "  input: string,",
      "  options: { strict?: boolean } = {},",
      "): SearchQuery",
    ],
    doc: ["Splits filter tokens such as `under:12km`.", "Unknown tokens stay in the text."],
  });
});

test("a one-line block comment and a decorator above a class method", () => {
  const text = [
    "class Index {",
    "  /** The trails whose names hold the query. */",
    "  @memoize",
    "  find(query: string): Trail[] {",
    "    return [];",
    "  }",
    "}",
  ].join("\n");
  expect(definitionText(text, 4)).toEqual({
    signature: ["find(query: string): Trail[]"],
    doc: ["The trails whose names hold the query."],
  });
});

test("Go and Rust line comments, and no comment past a blank line", () => {
  const go = ["// Best is the trail with the highest score.", "func Best(trails []Trail) Trail {"];
  expect(definitionText(go.join("\n"), 2)).toEqual({
    signature: ["func Best(trails []Trail) Trail"],
    doc: ["Best is the trail with the highest score."],
  });
  const rust = ["/// Kilometres in a mile.", "pub const MILE_KM: f64 = 1.609;"];
  expect(definitionText(rust.join("\n"), 2).doc).toEqual(["Kilometres in a mile."]);
  const apart = ["// A note about the file.", "", "const limit = 10;"];
  expect(definitionText(apart.join("\n"), 3)).toEqual({
    signature: ["const limit = 10;"],
    doc: [],
  });
});

test("a Python function's docstring, under its declaration", () => {
  const text = [
    "def score(trail, query):",
    '    """How well a trail matches the query.',
    "",
    "    Higher is better.",
    '    """',
    "    return 0",
  ].join("\n");
  expect(definitionText(text, 1)).toEqual({
    signature: ["def score(trail, query):"],
    doc: ["How well a trail matches the query.", "", "Higher is better."],
  });
  expect(definitionText('def f():\n    """One line."""\n', 1).doc).toEqual(["One line."]);
  // A shebang and a comment line that a Python file starts with are not docs.
  expect(definitionText("#!/usr/bin/env python\nx = 1\n", 2).doc).toEqual([]);
});

test("a line out of the file, and a declaration that never closes", () => {
  expect(definitionText("const a = 1;", 4)).toEqual({ signature: [], doc: [] });
  const open = ["function f(", ...Array.from({ length: 10 }, (_, at) => `  a${at},`)].join("\n");
  const { signature } = definitionText(open, 1);
  expect(signature).toHaveLength(7);
  expect(signature.at(-1)).toBe("…");
});
