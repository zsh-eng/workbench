import type { TokenizeResult } from "@twinkleplop/core";

const loaders = {
  java: () => import("./languages/java"),
  cpp: () => import("./languages/cpp"),
  xml: () => import("./languages/xml"),
  javascript: () => import("@twinkleplop/javascript"),
  typescript: () => import("@twinkleplop/typescript"),
  tsx: () => import("@twinkleplop/tsx"),
  css: () => import("@twinkleplop/css"),
  html: () => import("@twinkleplop/html"),
  json: () => import("@twinkleplop/json"),
  jsonc: () => import("@twinkleplop/jsonc"),
  markdown: () => import("@twinkleplop/markdown"),
  yaml: () => import("@twinkleplop/yaml"),
  toml: () => import("@twinkleplop/toml"),
  bash: () => import("@twinkleplop/bash"),
  go: () => import("@twinkleplop/go"),
  python: () => import("@twinkleplop/python"),
  rust: () => import("@twinkleplop/rust"),
  sql: () => import("@twinkleplop/sql"),
  svelte: () => import("@twinkleplop/svelte"),
  diff: () => import("@twinkleplop/diff"),
  ini: () => import("@twinkleplop/ini"),
  http: () => import("@twinkleplop/http"),
  dotenv: () => import("@twinkleplop/dotenv"),
  shellsession: () => import("@twinkleplop/shellsession"),
};
type Language = keyof typeof loaders;
const aliases: Record<string, Language> = {
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  js: "javascript",
  jsx: "tsx",
  ts: "typescript",
  md: "markdown",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  py: "python",
  rs: "rust",
  env: "dotenv",
  xsl: "xml",
};
export function supportedLanguage(name: string): Language | undefined {
  return Object.hasOwn(loaders, name)
    ? (name as Language)
    : Object.hasOwn(aliases, name)
      ? aliases[name]
      : undefined;
}
const tokenizers = new Map<Language, (source: string) => TokenizeResult>();
const pending = new Map<Language, Promise<void>>();
export async function ensureLanguages(names: readonly string[], preloadEmbedded = false) {
  await Promise.all(
    names.map(async (name) => {
      const language = supportedLanguage(name);
      if (!language) return;
      if (tokenizers.has(language)) {
        if (preloadEmbedded && language === "markdown")
          await ensureLanguages(Object.keys(loaders).filter((name) => name !== "markdown"));
        return;
      }
      let request = pending.get(language);
      if (!request) {
        request = loaders[language]()
          .then((module) => {
            tokenizers.set(language, module.tokenize({ fidelity: "high" }));
          })
          .finally(() => pending.delete(language));
        pending.set(language, request);
      }
      await request;
      if (preloadEmbedded && language === "markdown")
        await ensureLanguages(Object.keys(loaders).filter((name) => name !== "markdown"));
    }),
  );
}

// CommonMark fenced blocks. Preserve offsets in the normalized source used by
// the renderer. Unknown fence languages remain plain text inside the fence.
function fences(source: string) {
  const result: { start: number; end: number; language: string }[] = [];
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let offset = 0;
  let open: { marker: string; start: number; language: string } | undefined;
  for (const line of lines) {
    if (!open) {
      const match = /^ {0,3}(`{3,}|~{3,})\s*([^\s`~]*)[^\n]*\n$/.exec(line);
      if (match) open = { marker: match[1], language: match[2], start: offset + line.length };
    } else if (new RegExp(`^ {0,3}${open.marker[0]}{${open.marker.length},}\\s*$`).test(line)) {
      result.push({ start: open.start, end: offset, language: open.language });
      open = undefined;
    }
    offset += line.length;
  }
  if (open) result.push({ start: open.start, end: source.length, language: open.language });
  return result;
}
export async function prepareSource(language: string, source: string) {
  await ensureLanguages([language]);
  if (supportedLanguage(language) === "markdown")
    await ensureLanguages(fences(source.replace(/\r\n?/g, "\n")).map((block) => block.language));
}
export function tokenize(source: string, name: string): TokenizeResult | undefined {
  const language = supportedLanguage(name);
  const factory = language && tokenizers.get(language);
  if (!factory) return;
  const result = factory(source);
  if (language !== "markdown") return result;
  const embedded = fences(source).flatMap((block) => {
    const language = supportedLanguage(block.language);
    if (!language || language === "markdown") return [];
    const factory = tokenizers.get(language);
    return factory ? [{ ...block, result: factory(source.slice(block.start, block.end)) }] : [];
  });
  if (!embedded.length) return result;
  const types = [...result.token_types];
  const spans: [number, number, number][] = [];
  for (let i = 0; i < result.tokens.length; i += 3) {
    const [kind, start, end] = result.tokens.subarray(i, i + 3);
    // A Markdown token can include the newline before a fence body. Subtract
    // each embedded interval instead of removing only contained tokens.
    let cursor = start;
    for (const block of embedded) {
      if (block.end <= cursor || block.start >= end) continue;
      if (block.start > cursor) spans.push([kind, cursor, block.start]);
      cursor = Math.max(cursor, block.end);
    }
    if (cursor < end) spans.push([kind, cursor, end]);
  }
  for (const block of embedded) {
    for (let i = 0; i < block.result.tokens.length; i += 3) {
      const [kind, start, end] = block.result.tokens.subarray(i, i + 3);
      const type = block.result.token_types[kind];
      let mapped = types.indexOf(type);
      if (mapped < 0) {
        mapped = types.length;
        types.push(type);
      }
      spans.push([mapped, block.start + start, block.start + end]);
    }
  }
  spans.sort((a, b) => a[1] - b[1]);
  return { tokens: Uint32Array.from(spans.flat()), token_types: types };
}
