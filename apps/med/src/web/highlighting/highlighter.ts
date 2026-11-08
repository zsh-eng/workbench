import { attachResolvedThemes, getSharedHighlighter, type DiffsTheme } from "@pierre/diffs";

/**
 * Syntax colour outside Pierre's diff and file views: Markdown code blocks
 * and the file editor's worker. Both use Pierre's own highlighter, the
 * WebAssembly one in `@pierre/highlights`, so a code block reads exactly like
 * the same code in a diff.
 *
 * A worker cannot load a theme by name. The page resolves Med's theme
 * (`resolveSyntaxTheme` in pierre-theme.ts) and sends it whole; the worker
 * keeps the latest one of each name and gives it to its highlighter.
 */
export type SyntaxThemeData = DiffsTheme;

export interface StyledToken {
  content: string;
  offset: number;
  /** Inline CSS, such as `color:#9fd0b4;font-style:italic`. */
  style: string;
}

const themes = new Map<string, SyntaxThemeData>();
const attached = new Map<string, SyntaxThemeData>();

/** Makes a resolved theme available to the highlighter by its name. */
export function loadTheme(theme: SyntaxThemeData) {
  if (!theme.name) throw new Error("Syntax theme needs a name");
  themes.set(theme.name, theme);
}

function styleOf(token: {
  color?: string;
  fontStyle?: number;
  htmlStyle?: Record<string, string>;
}) {
  if (token.htmlStyle)
    return Object.entries(token.htmlStyle)
      .map(([key, value]) => `${key}:${value}`)
      .join(";");
  const parts: string[] = [];
  if (token.color) parts.push(`color:${token.color}`);
  const font = token.fontStyle ?? 0;
  if (font & 1) parts.push("font-style:italic");
  if (font & 2) parts.push("font-weight:bold");
  if (font & 4) parts.push("text-decoration:underline");
  return parts.join(";");
}

/**
 * The source's tokens, one array for each line, in the named theme, which
 * `loadTheme` must have given first. An unknown language reads as plain text.
 */
export async function tokenLines(
  source: string,
  language: string,
  themeName: string,
): Promise<StyledToken[][]> {
  const lang = language as never;
  const highlighter = await getSharedHighlighter({
    themes: [],
    langs: [lang],
    preferredHighlighter: "highlights" as const,
  });
  const theme = themes.get(themeName);
  if (!theme) throw new Error(`The syntax theme ${themeName} is not loaded`);
  if (attached.get(themeName) !== theme) {
    attachResolvedThemes(theme, highlighter);
    attached.set(themeName, theme);
  }
  const { tokens } = highlighter.codeToTokens(source, {
    lang,
    theme: themeName,
    tokenizeMaxLineLength: 20000,
  } as never);
  return tokens.map((line) =>
    line.map((token) => ({ content: token.content, offset: token.offset, style: styleOf(token) })),
  );
}
