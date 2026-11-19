import type { StyledToken } from "../highlighting/highlighter";

// A highlighted code block's HTML, written from its tokens as rehype-stringify
// writes the same spans: `&` and `<` in text, and `&` and `"` in an attribute,
// as hexadecimal references. A tree of spans to serialize would cost several
// times the highlighting.
const escapeText = (text: string) =>
  text.replace(/[&<]/g, (character) => (character === "&" ? "&#x26;" : "&#x3C;"));
const escapeAttribute = (text: string) =>
  text.replace(/[&"]/g, (character) => (character === "&" ? "&#x26;" : "&#x22;"));

/** Each line's tokens as spans with their style; lines end with `\n`. */
export const codeHtml = (lines: StyledToken[][]) =>
  lines
    .map((line) =>
      line
        .map(
          (token) =>
            `<span style="${escapeAttribute(token.style)}">${escapeText(token.content)}</span>`,
        )
        .join(""),
    )
    .join("\n");
