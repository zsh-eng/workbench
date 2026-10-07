import type { TokenizeResult } from "@twinkleplop/core";

// A small XML scanner with the token names of Twinkleplop's HTML grammar, so
// themes color both the same way. Unlike HTML, no element has special content:
// <script> in XML is an ordinary element, and CDATA stays one string.
const TYPES = [
  "punctuation",
  "tag_name",
  "attr_name",
  "operator",
  "string",
  "comment",
  "doctype",
  "entity",
] as const;
type Kind = (typeof TYPES)[number];
const KIND = Object.fromEntries(TYPES.map((type, index) => [type, index])) as Record<Kind, number>;

const NAME = /[A-Za-z_:À-￯][\w.:\-·À-￯]*/y;
const SPACE = /\s+/y;
const ENTITY = /&(?:#\d+|#x[\da-fA-F]+|[A-Za-z][\w.-]*);/y;

function scan(source: string): TokenizeResult {
  const tokens: number[] = [];
  const push = (kind: Kind, start: number, end: number) => {
    if (end > start) tokens.push(KIND[kind], start, end);
  };
  const sticky = (pattern: RegExp, at: number) => {
    pattern.lastIndex = at;
    return pattern.exec(source)?.[0].length ?? 0;
  };
  // Attributes up to the end of a tag or declaration; returns the position after it.
  const attributes = (at: number, close: string) => {
    let i = at;
    while (i < source.length) {
      i += sticky(SPACE, i);
      if (source.startsWith(close, i)) {
        push("punctuation", i, i + close.length);
        return i + close.length;
      }
      if (source[i] === ">" || source.startsWith("/>", i)) {
        const end = source[i] === ">" ? i + 1 : i + 2;
        push("punctuation", i, end);
        return end;
      }
      if (source[i] === "<") return i;
      const name = sticky(NAME, i);
      if (name) {
        push("attr_name", i, i + name);
        i += name;
        continue;
      }
      if (source[i] === "=") {
        push("operator", i, i + 1);
        i += 1;
        continue;
      }
      if (source[i] === '"' || source[i] === "'") {
        const end = source.indexOf(source[i], i + 1);
        const stop = end < 0 ? source.length : end + 1;
        push("string", i, stop);
        i = stop;
        continue;
      }
      i += 1;
    }
    return i;
  };

  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("<", i);
    const textEnd = open < 0 ? source.length : open;
    // Character and entity references in text.
    for (
      let at = source.indexOf("&", i);
      at >= 0 && at < textEnd;
      at = source.indexOf("&", at + 1)
    ) {
      const length = sticky(ENTITY, at);
      if (length) push("entity", at, at + length);
    }
    if (open < 0) break;
    i = open;
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      const stop = end < 0 ? source.length : end + 3;
      push("comment", i, stop);
      i = stop;
    } else if (source.startsWith("<![CDATA[", i)) {
      push("punctuation", i, i + 9);
      const end = source.indexOf("]]>", i + 9);
      const stop = end < 0 ? source.length : end;
      push("string", i + 9, stop);
      push("punctuation", stop, Math.min(stop + 3, source.length));
      i = Math.min(stop + 3, source.length);
    } else if (source.startsWith("<!", i)) {
      // A declaration such as DOCTYPE, with an optional internal subset in brackets.
      let depth = 0;
      let j = i + 2;
      for (; j < source.length; j++) {
        if (source[j] === "[") depth++;
        else if (source[j] === "]") depth--;
        else if (source[j] === ">" && depth <= 0) break;
      }
      push("doctype", i, Math.min(j + 1, source.length));
      i = j + 1;
    } else if (source.startsWith("<?", i)) {
      push("punctuation", i, i + 2);
      const name = sticky(NAME, i + 2);
      push("tag_name", i + 2, i + 2 + name);
      i = attributes(i + 2 + name, "?>");
    } else {
      const closing = source[i + 1] === "/";
      const nameAt = i + (closing ? 2 : 1);
      const name = sticky(NAME, nameAt);
      if (!name) {
        i += 1;
        continue;
      }
      push("punctuation", i, nameAt);
      push("tag_name", nameAt, nameAt + name);
      i = attributes(nameAt + name, ">");
    }
  }
  return { tokens: Uint32Array.from(tokens), token_types: [...TYPES] };
}

export const tokenize = (_options?: { fidelity?: string }) => scan;
