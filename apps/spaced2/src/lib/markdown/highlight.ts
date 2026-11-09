import { codeToTokens, isSupportedLanguage } from "@pierre/highlights";
import dawn from "@pierre/highlights/themes/rose-pine-dawn";
import moon from "@pierre/highlights/themes/rose-pine-moon";

/**
 * Code colors from Pierre's WebAssembly highlighter, as Med uses. Each token
 * carries both Rosé Pine themes as CSS variables (`--hls-light`,
 * `--hls-dark`), so a theme change needs no new render; index.css chooses
 * one. Moon is the dark theme that cards used before.
 */
const themes = { light: dawn, dark: moon };

export interface Token {
  content: string;
  style: string;
}

/** Lines of tokens, or undefined for a language the highlighter does not know. */
export function highlightLines(
  source: string,
  language: string,
): Token[][] | undefined {
  if (!isSupportedLanguage(language)) return;
  const { tokens } = codeToTokens(source, {
    lang: language,
    themes,
    defaultColor: false,
    tokenizeMaxLineLength: 20_000,
  });
  return tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      style: Object.entries(token.htmlStyle ?? {})
        .map(([key, value]) => `${key}:${value}`)
        .join(";"),
    })),
  );
}
