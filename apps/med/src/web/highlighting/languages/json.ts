import type { TokenizeResult } from "@twinkleplop/core";

// JSON after VS Code's JSON grammar, which Shiki uses: a string is a property
// name only in key position, comments are allowed, and a character that cannot
// start a value or separator inside an object or array is invalid. Token kinds
// are TextMate scope stacks, so every theme colors them as it colors Shiki's.
const OBJECT = 1;
const VALUE = 2;
const ARRAY = 3;

const isDigit = (c: number) => c >= 48 && c <= 57;
const isHex = (c: number) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isWord = (c: number) =>
  isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isSpace = (c: number) =>
  c === 32 ||
  (c >= 9 && c <= 13) ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;
// \" \/ \\ \b \f \n \r \t
const ESCAPES = new Set([34, 47, 92, 98, 102, 110, 114, 116]);
const CONSTANTS = ["true", "false", "null"];

/** `suffix` is "json" for JSON and "json.comments" for JSONC, as in Shiki's scopes. */
export function createJsonScanner(suffix: string) {
  const key = `string.${suffix}|support.type.property-name.${suffix}`;
  const string = `string.quoted.double.${suffix}`;
  const types = [
    key,
    `${key}|punctuation.support.type.property-name.begin.${suffix}`,
    `${key}|punctuation.support.type.property-name.end.${suffix}`,
    `${key}|constant.character.escape.${suffix}`,
    `${key}|invalid.illegal.unrecognized-string-escape.${suffix}`,
    string,
    `${string}|punctuation.definition.string.begin.${suffix}`,
    `${string}|punctuation.definition.string.end.${suffix}`,
    `${string}|constant.character.escape.${suffix}`,
    `${string}|invalid.illegal.unrecognized-string-escape.${suffix}`,
    `constant.numeric.${suffix}`,
    `constant.language.${suffix}`,
    `punctuation.definition.dictionary.begin.${suffix}`,
    `punctuation.definition.dictionary.end.${suffix}`,
    `punctuation.definition.array.begin.${suffix}`,
    `punctuation.definition.array.end.${suffix}`,
    `punctuation.separator.dictionary.key-value.${suffix}`,
    `punctuation.separator.dictionary.pair.${suffix}`,
    `punctuation.separator.array.${suffix}`,
    `invalid.illegal.expected-dictionary-separator.${suffix}`,
    `invalid.illegal.expected-array-separator.${suffix}`,
    `comment.block.${suffix}`,
    `comment.block.${suffix}|punctuation.definition.comment.${suffix}`,
    `comment.block.documentation.${suffix}`,
    `comment.block.documentation.${suffix}|punctuation.definition.comment.${suffix}`,
    "comment.line.double-slash.js",
    `comment.line.double-slash.js|punctuation.definition.comment.${suffix}`,
  ];
  // Indexes into `types`. A string's begin, end, escape, and invalid escape
  // kinds follow its body kind (KEY or STRING).
  const KEY = 0,
    STRING = 5,
    BEGIN = 1,
    END = 2,
    ESCAPE = 3,
    BAD_ESCAPE = 4,
    NUMBER = 10,
    CONSTANT = 11,
    OBJECT_BEGIN = 12,
    OBJECT_END = 13,
    ARRAY_BEGIN = 14,
    ARRAY_END = 15,
    KEY_VALUE = 16,
    PAIR = 17,
    ARRAY_SEPARATOR = 18,
    BAD_OBJECT = 19,
    BAD_ARRAY = 20,
    BLOCK = 21,
    DOC = 23,
    LINE = 25;

  return function scan(source: string): TokenizeResult {
    let tokens = new Uint32Array(Math.min(Math.max(source.length, 64), 1 << 20));
    let n = 0;
    const push = (kind: number, start: number, end: number) => {
      if (end <= start) return;
      if (n && tokens[n - 3] === kind && tokens[n - 1] === start) {
        tokens[n - 1] = end;
        return;
      }
      if (n + 3 > tokens.length) {
        const grown = new Uint32Array(tokens.length * 2);
        grown.set(tokens);
        tokens = grown;
      }
      tokens[n++] = kind;
      tokens[n++] = start;
      tokens[n++] = end;
    };
    const length = source.length;
    // Past the end, charCodeAt returns NaN, which fails every comparison below.
    const at = (i: number) => source.charCodeAt(i);

    const scanString = (start: number, body: number) => {
      push(body + BEGIN, start, start + 1);
      let i = start + 1;
      let from = i;
      while (i < length) {
        const c = source.charCodeAt(i);
        if (c === 34) {
          push(body, from, i);
          push(body + END, i, i + 1);
          return i + 1;
        }
        if (c === 92) {
          const next = at(i + 1);
          let end = 0;
          if (ESCAPES.has(next)) end = i + 2;
          else if (
            next === 117 &&
            isHex(at(i + 2)) &&
            isHex(at(i + 3)) &&
            isHex(at(i + 4)) &&
            isHex(at(i + 5))
          )
            end = i + 6;
          if (end) {
            push(body, from, i);
            push(body + ESCAPE, i, end);
          } else if (next >= 0 && next !== 10) {
            // An unknown escape covers one code point.
            end = i + (next >= 0xd800 && next <= 0xdbff && i + 2 < length ? 3 : 2);
            push(body, from, i);
            push(body + BAD_ESCAPE, i, end);
          } else {
            i += 1;
            continue;
          }
          i = from = end;
          continue;
        }
        i += 1;
      }
      push(body, from, length);
      return length;
    };

    // Comments begin with a slash; returns the index after the comment, or -1.
    const scanComment = (start: number) => {
      if (at(start) !== 47) return -1;
      const next = at(start + 1);
      if (next === 47) {
        push(LINE + 1, start, start + 2);
        const newline = source.indexOf("\n", start + 2);
        const end = newline < 0 ? length : newline + 1;
        push(LINE, start + 2, end);
        return end;
      }
      if (next !== 42) return -1;
      const doc = at(start + 2) === 42 && at(start + 3) !== 47;
      const kind = doc ? DOC : BLOCK;
      const open = start + (doc ? 3 : 2);
      push(kind + 1, start, open);
      const close = source.indexOf("*/", open);
      if (close < 0) {
        push(kind, open, length);
        return length;
      }
      push(kind, open, close);
      push(kind + 1, close, close + 2);
      return close + 2;
    };

    const stack: number[] = [];
    // A value, or a comment, at `i`; returns the index after it, or -1.
    const scanValue = (i: number) => {
      const c = source.charCodeAt(i);
      if (c === 34) return scanString(i, STRING);
      if (c === 123) {
        push(OBJECT_BEGIN, i, i + 1);
        stack.push(OBJECT);
        return i + 1;
      }
      if (c === 91) {
        push(ARRAY_BEGIN, i, i + 1);
        stack.push(ARRAY);
        return i + 1;
      }
      if (c === 45 || isDigit(c)) {
        let j = c === 45 ? i + 1 : i;
        if (at(j) === 48) j += 1;
        else if (isDigit(at(j))) while (isDigit(at(j))) j += 1;
        else return -1;
        if (at(j) === 46 && isDigit(at(j + 1))) {
          j += 2;
          while (isDigit(at(j))) j += 1;
        }
        if (at(j) === 69 || at(j) === 101) {
          let k = j + 1;
          if (at(k) === 43 || at(k) === 45) k += 1;
          if (isDigit(at(k))) {
            while (isDigit(at(k))) k += 1;
            j = k;
          }
        }
        push(NUMBER, i, j);
        return j;
      }
      if ((c === 116 || c === 102 || c === 110) && !isWord(at(i - 1))) {
        for (const word of CONSTANTS) {
          if (source.startsWith(word, i) && !isWord(at(i + word.length))) {
            push(CONSTANT, i, i + word.length);
            return i + word.length;
          }
        }
      }
      return scanComment(i);
    };

    let i = 0;
    while (i < length) {
      const c = source.charCodeAt(i);
      const context = stack.length ? stack[stack.length - 1] : 0;
      if (context === OBJECT) {
        let next = -1;
        if (c === 125) {
          push(OBJECT_END, i, i + 1);
          stack.pop();
          next = i + 1;
        } else if (c === 34) next = scanString(i, KEY);
        else if (c === 58) {
          push(KEY_VALUE, i, i + 1);
          stack.push(VALUE);
          next = i + 1;
        } else next = scanComment(i);
        if (next >= 0) i = next;
        else {
          if (!isSpace(c)) push(BAD_OBJECT, i, i + 1);
          i += 1;
        }
        continue;
      }
      if (context === VALUE) {
        // The value ends at a pair separator, or before the object's closing brace.
        if (c === 44) {
          push(PAIR, i, i + 1);
          stack.pop();
          i += 1;
          continue;
        }
        if (c === 125) {
          stack.pop();
          continue;
        }
      } else if (context === ARRAY && c === 93) {
        push(ARRAY_END, i, i + 1);
        stack.pop();
        i += 1;
        continue;
      }
      const next = scanValue(i);
      if (next >= 0) {
        i = next;
        continue;
      }
      if (context === ARRAY && c === 44) push(ARRAY_SEPARATOR, i, i + 1);
      else if (context && !isSpace(c)) push(context === ARRAY ? BAD_ARRAY : BAD_OBJECT, i, i + 1);
      i += 1;
    }
    return { tokens: tokens.slice(0, n), token_types: types };
  };
}

const scan = createJsonScanner("json");
export const tokenize = (_options?: { fidelity?: string }) => scan;
