import type { TokenizeResult } from "@twinkleplop/core";
import { createWriter, scopeTable } from "./token-writer";

// Go after the Go grammar that Shiki uses (go-syntax; see upstream/GRAMMARS.md).
// Its scopes are almost flat: each token kind is one scope, or a string or
// number scope with one child. Identifiers take their scope from the nearest
// construct: a declaration, a parameter list, a struct field, a call, a
// composite literal, or an assignment. Regular expressions below mirror the
// grammar's line-bounded lookaheads.
const { types, kind } = scopeTable();
const go = (scope: string) => kind(`${scope}.go`);
const inString = (string: string, scope: string) => kind(`${string}.go|${scope}.go`);

const VARIABLE = go("variable.other");
const ASSIGNED = go("variable.other.assignment");
const CONSTANT = go("variable.other.constant");
const PROPERTY = go("variable.other.property");
const LABEL = go("variable.other.label");
const IMPORT_ALIAS = go("variable.other.import");
const PARAMETER = go("variable.parameter");
const TYPE = go("entity.name.type");
const PACKAGE = go("entity.name.type.package");
const FUNCTION = go("entity.name.function");
const CALL = go("entity.name.function.support");
const BUILTIN = go("entity.name.function.support.builtin");
const INVALID_NAME = go("invalid.illegal.identifier");
const LINE = go("comment.line.double-slash");
const LINE_MARK = kind("comment.line.double-slash.go|punctuation.definition.comment.go");
const BLOCK = go("comment.block");
const BLOCK_MARK = kind("comment.block.go|punctuation.definition.comment.go");
const COMMA = go("punctuation.other.comma");
const PERIOD = go("punctuation.other.period");
const COLON = go("punctuation.other.colon");
const SEMICOLON = go("punctuation.terminator");
const KEYWORD_FUNC = go("keyword.function");
const KEYWORD_TYPE = go("keyword.type");
const KEYWORD_STRUCT = go("keyword.struct");
const KEYWORD_INTERFACE = go("keyword.interface");
const KEYWORD_MAP = go("keyword.map");
const KEYWORD_CONTROL = go("keyword.control");
const KEYWORD_IMPORT = go("keyword.control.import");
const KEYWORD_PACKAGE = go("keyword.package");

const BRACKETS: Record<string, [number, number]> = {
  "(": [go("punctuation.definition.begin.bracket.round"), 41],
  "[": [go("punctuation.definition.begin.bracket.square"), 93],
  "{": [go("punctuation.definition.begin.bracket.curly"), 125],
};
const CLOSERS: Record<number, number> = {
  41: go("punctuation.definition.end.bracket.round"),
  93: go("punctuation.definition.end.bracket.square"),
  125: go("punctuation.definition.end.bracket.curly"),
};
const IMPORTS_OPEN = go("punctuation.definition.imports.begin.bracket.round");
const IMPORTS_CLOSE = go("punctuation.definition.imports.end.bracket.round");

// No prototype: names such as `toString` must not look like keywords.
const words: Record<string, number> = Object.create(null);
const define = (list: string, scope: number) => {
  for (const word of list.split(" ")) words[word] = scope;
};
define("true false", go("constant.language.boolean"));
define("nil", go("constant.language.null"));
define("iota", go("constant.language.iota"));
define(
  "break case continue default defer else fallthrough for go goto if range return select switch",
  KEYWORD_CONTROL,
);
define("chan", go("keyword.channel"));
define("const", go("keyword.const"));
define("var", go("keyword.var"));
define("func", KEYWORD_FUNC);
define("interface", KEYWORD_INTERFACE);
define("map", KEYWORD_MAP);
define("struct", KEYWORD_STRUCT);
define("import", KEYWORD_IMPORT);
define("type", KEYWORD_TYPE);
define("bool", go("storage.type.boolean"));
define("byte", go("storage.type.byte"));
define("error", go("storage.type.error"));
define(
  "complex64 complex128 float32 float64 int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64",
  go("storage.type.numeric"),
);
define("rune", go("storage.type.rune"));
define("string", go("storage.type.string"));
define("uintptr", go("storage.type.uintptr"));
define("any", go("entity.name.type.any"));
define("comparable", go("entity.name.type.comparable"));
const BUILTINS = new Set(
  "append cap close complex copy delete imag len panic print println real recover min max clear".split(
    " ",
  ),
);

const OPERATORS: [string, number][] = [
  ["<-", go("keyword.operator.channel")],
  ["--", go("keyword.operator.decrement")],
  ["++", go("keyword.operator.increment")],
  ["...", go("keyword.operator.ellipsis")],
];
const COMPARISON = go("keyword.operator.comparison");
const LOGICAL = go("keyword.operator.logical");
const ASSIGNMENT = go("keyword.operator.assignment");
const ARITHMETIC = go("keyword.operator.arithmetic");
const BITWISE = go("keyword.operator.arithmetic.bitwise");
const ADDRESS = go("keyword.operator.address");

const STRING = "string.quoted.double";
const RAW = "string.quoted.raw";
const RUNE = "string.quoted.rune";
const S = {
  body: go(STRING),
  begin: inString(STRING, "punctuation.definition.string.begin"),
  end: inString(STRING, "punctuation.definition.string.end"),
  escape: inString(STRING, "constant.character.escape"),
  badEscape: inString(STRING, "invalid.illegal.unknown-escape"),
  placeholder: inString(STRING, "constant.other.placeholder"),
  import: inString(STRING, "entity.name.import"),
};
const R = {
  body: go(RAW),
  begin: inString(RAW, "punctuation.definition.string.begin"),
  end: inString(RAW, "punctuation.definition.string.end"),
  placeholder: inString(RAW, "constant.other.placeholder"),
};
const RU = {
  body: go(RUNE),
  begin: inString(RUNE, "punctuation.definition.string.begin"),
  end: inString(RUNE, "punctuation.definition.string.end"),
  value: inString(RUNE, "constant.other.rune"),
  invalid: inString(RUNE, "invalid.illegal.unknown-rune"),
};
const N = {
  decimal: go("constant.numeric.decimal"),
  point: go("constant.numeric.decimal.point"),
  hex: go("constant.numeric.hexadecimal"),
  binary: go("constant.numeric.binary"),
  octal: go("constant.numeric.octal"),
  separator: go("punctuation.separator.constant.numeric"),
  hexUnit: go("keyword.other.unit.hexadecimal"),
  binaryUnit: go("keyword.other.unit.binary"),
  octalUnit: go("keyword.other.unit.octal"),
  imaginary: go("keyword.other.unit.imaginary"),
  exponent: go("keyword.other.unit.exponent.decimal"),
  exponentValue: go("constant.numeric.exponent.decimal"),
  hexExponent: go("keyword.other.unit.exponent.hexadecimal"),
  hexExponentValue: go("constant.numeric.exponent.hexadecimal"),
  plus: go("keyword.operator.plus.exponent.decimal"),
  minus: go("keyword.operator.minus.exponent.decimal"),
  hexPlus: go("keyword.operator.plus.exponent.hexadecimal"),
  hexMinus: go("keyword.operator.minus.exponent.hexadecimal"),
  invalid: go("invalid.illegal.constant.numeric"),
};

// Pieces of the grammar's type expressions, bounded to one line.
const B = "[\\]*\\[]";
const BW = "[\\]*.\\[\\w]";
const CHAN = `(?:[ \\t]*${B}*(?:<-[ \\t]*)?\\bchan\\b(?:[ \\t]*<-)?[ \\t]*)+`;
const FUNC_TYPE = `${BW}*(?:\\bfunc\\b\\([^)\\n]*\\)(?:${CHAN})?[ \\t]*)+(?:${BW}+|\\([^)\\n]*\\))?`;
const PLAIN_TYPE = `(?:${B}*[*.\\w]+(?:\\[[^\\]\\n]+\\])?)+`;
const GENERIC_TYPE = `(?:(?:[*.~\\w]+|\\[(?:[*.\\w]*(?:\\[[^\\]\\n]*\\])?(?:,[ \\t]+)?)+\\])[*.\\w]*)+`;
const NAMES = "(?:\\b\\w+,[ \\t]*)*\\b\\w+";
const sticky = (pattern: string, flags = "") => new RegExp(pattern, `y${flags}`);
const PARAMETER_PAIR = sticky(`(${NAMES})[ \\t]+((?:${CHAN})?(?:${FUNC_TYPE}|${PLAIN_TYPE}))`);
const GENERIC_PAIR = sticky(`(${NAMES})[ \\t]+((?:${CHAN})?(?:${FUNC_TYPE}|${GENERIC_TYPE}))`);
const NAMES_BEFORE_BODY = sticky(
  `(${NAMES})[ \\t]+(?=(?:${CHAN})?${B}*\\b(?:struct|interface)\\b[ \\t]*\\{)`,
);
const NAMES_AT_EOL = sticky("((?:\\b\\w+,[ \\t]*)+)(?=[ \\t]*(?:/[*/].*)?$)", "m");
const DECLARED_NAMES = sticky(
  `([.\\w]+(?:,[ \\t]*[.\\w]+)*)[ \\t]*((?:${CHAN}(?:\\([^)\\n]+\\))?)?(?!${B}*\\b(?:struct|func|map)\\b)(?:${BW}+(?:,[ \\t]*${BW}+)*)?[ \\t]*=?)?`,
);
// Name lists before `:=` and before `=`, without the grammar's lookaheads.
const SHORT_NAMES = sticky("\\w+(?:,[ \\t]*\\w+)*");
const SHORT_AFTER = sticky("[ \\t]*:=");
const TARGET_NAMES = sticky("[*.\\w]+(?:,[ \\t]*[*.\\w]+)*");
const TARGET_AFTER = sticky("[ \\t]*=(?!=)");
const PROPERTY_NAME = sticky("[.\\w]+:(?!=)");
const LABEL_LINE = sticky("\\w+:[ \\t]*$", "m");
const JUMP_LINE = sticky("(?:break|goto|continue)\\b[ \\t]+(\\w+)[ \\t]*(?:/[*/].*)?$", "m");
const SLICE_INDEX = sticky(
  "(?:\\b[-%&*+./<>|\\w]+:|:\\b[-%&*+./<>|\\w]+)(?:\\b[-%&*+./<>|\\w]+)?(?::\\b[-%&*+./<>|\\w]+)?(?=\\])",
);
const CONTROL_RUN = sticky("[-\\]!%*+./:<=>\\[\\w]+");
const BEFORE_BRACE = sticky("[ \\t]*\\{");
// Last characters of the tokens in CONTROL_BEFORE.
const CONTROL_LAST = new Set([..."efr;<>=|&-%*+/"].map((c) => c.charCodeAt(0)));
const CONTROL_BEFORE = /(?:\brange|;|\bif|\bfor|[<>]|<=|>=|==|!=|\w[-%*+/]=?|\|\||&&)$/;
const RESULT_BEFORE_BODY = sticky(
  `[ \\t]*((?:${CHAN})?(?!${B}*\\b(?:struct|interface)\\b)[-\\]*.\\[\\w]+)?[ \\t]*(?=\\{)`,
);
const RESULT_AT_EOL = sticky(`[ \\t]*((?:${CHAN})?[-\\]*.<>\\[\\w]+[ \\t]*(?:/[*/].*)?)$`, "m");
const LITERAL_RESULT = sticky(
  `(${CHAN})?([ \\t]*(?:${B}*[*.\\w]+)?(?:\\[(?:[*.\\w]*(?:\\[[^\\]\\n]*\\])?(?:,[ \\t]+)?)+\\]|\\([^)\\n]*\\))?[*.\\w]*[ \\t]*(?=\\{)|[ \\t]*(?:${B}*(?!\\bfunc\\b)[*.\\w]+(?:\\[(?:[*.\\w]*(?:\\[[^\\]\\n]*\\])?(?:,[ \\t]+)?)+\\])?[*.\\w]*|\\([^)\\n]*\\)))?`,
);
const PARENTHESIZED_TYPE = sticky(
  `\\(${B}*[.\\w]+(?:\\[(?:[\\]*.\\[{}\\w]+(?:,[ \\t]*[\\]*.\\[{}\\w]+)*)?\\])?\\)(?=\\()`,
);
const INLINE_FUNC = sticky("(\\([^/\\n]*?\\)[ \\t]+\\([^/\\n]*?\\))[ \\t]+(?=\\{)");
const SINGLE_TYPE = sticky(
  `([*.\\w]+)[ \\t]+(?!(?:=[ \\t]*)?${B}*\\b(?:struct|interface)\\b)(.+)$`,
  "m",
);
const MAP_VALUE = sticky(
  `(?:${CHAN})?(?!${B}*\\b(?:func|struct|map)\\b)${B}*[.\\w]+(?:\\[(?:[\\]*.\\[{}\\w]+(?:,[ \\t]*[\\]*.\\[{}\\w]+)*)?\\])?`,
);
const MAKE_TYPE = sticky(
  `(?:(?:${B}*(?:<-[ \\t]*)?\\bchan\\b(?:[ \\t]*<-)?[ \\t]*)+(?:\\([^)\\n]+\\))?)?${B}*(?:(?!\\bmap\\b)[.\\w]+)?(\\[(?:\\S+(?:,[ \\t]*\\S+)*)?\\])?,?`,
);
const TYPE_ASSERTION = sticky(
  `(?:${CHAN})?${B}*[.\\w]+(?:\\[(?:[\\]*.\\[{}\\w]+(?:,[ \\t]*[\\]*.\\[{}\\w]+)*)?\\])?(?=\\))`,
);
const TYPE_SWITCH = sticky(
  "[ \\t]*(\\w+[ \\t]*:=)?[ \\t]*([-\\]%&(-+./<>\\[|\\w]+)(\\.\\(\\btype\\b\\)[ \\t]*)\\{",
);
const SWITCH_HEAD = sticky(
  "[ \\t]*((?:[.\\w]+(?:[ \\t]*[-!%&+,/:<=>|]+[ \\t]*[.\\w]+)*[ \\t]*[-!%&+,/:<=>|]+)?[ \\t]*[-\\]%&(-+./<>\\[|\\w]*[ \\t]*(?:;[ \\t]*[-\\]%&(-+./<>\\[|\\w]+[ \\t]*)?)\\{",
);
const TYPE_CASE = sticky("([!*,.<=>\\w \\t]+)(:)([ \\t]*/[*/][ \\t]*.*)?$", "m");
const VALUE_CASE = sticky("(.+):[ \\t]*(?:/[*/].*)?$", "m");
const PLACEHOLDER = sticky(
  "%(?:\\[\\d+\\])?(?:[- #+0]{0,2}(?:(?:\\d+|\\*)?(?:\\.?(?:\\d+|\\*|(?:\\[\\d+\\])\\*?)?(?:\\[\\d+\\])?)?))?[%EFGTUXb-gopqstvwx]",
);
const ESCAPE = sticky(
  "\\\\(?:[0-7]{3}|[\"'\\\\abfnrtv]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})",
);
const RUNE_VALUE = sticky(
  "(?:\\\\(?:[0-7]{3}|[\"'\\\\abfnrtv]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})|[^\\n])(?=')",
);
const NUMBER_RUN = sticky("\\.?\\d(?:[.0-9A-Z_a-z]|(?<=[EPep])[-+])*");

const isWordCode = (c: number) =>
  (c >= 48 && c <= 57) ||
  (c >= 65 && c <= 90) ||
  (c >= 97 && c <= 122) ||
  c === 95 ||
  (c >= 0x80 && /[\p{L}\p{N}\p{M}\p{Pc}]/u.test(String.fromCharCode(c)));
const isDigit = (c: number) => c >= 48 && c <= 57;
// The regular expressions' `\w`, which is ASCII only.
const isAsciiWord = (c: number) =>
  isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isHex = (c: number) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

// Region modes. Each mirrors one begin/end rule of the grammar.
const STATEMENTS = 0;
const PARAMETERS = 1;
const GENERICS = 2;
const STRUCT = 3;
const INTERFACE = 4;
const CONSTANTS = 5;
const VARIABLES = 6;
const IMPORTS = 7;
const TYPES = 8;
const TYPE_SWITCH_BODY = 9;
const MAP_KEY = 10;
const NEW_CALL = 11;
// Statements in the braces of an expression switch, which add a case rule.
const SWITCH_BODY = 12;
// Kinds of statement brackets in a captured span.
const TYPE_REST = 1;
const CASE_TYPES = 2;
const MAX_DEPTH = 200;

export function scan(source: string): TokenizeResult {
  const out = createWriter(source.length, types);
  const push = out.push;
  const length = source.length;
  const at = (i: number) => source.charCodeAt(i);
  const exec = (pattern: RegExp, i: number) => {
    pattern.lastIndex = i;
    return pattern.exec(source);
  };
  const wordEnd = (i: number) => {
    while (i < length && isWordCode(at(i))) i++;
    return i;
  };
  const spaces = (i: number) => {
    while (at(i) === 32 || at(i) === 9) i++;
    return i;
  };
  // Line ends and the next `{` on a line hold for every index before them, so
  // remember the last answers; many calls on one long line stay linear.
  let lineFrom = -1;
  let lineTo = -1;
  const lineEnd = (i: number) => {
    if (i < lineFrom || i > lineTo) {
      const end = source.indexOf("\n", i);
      lineFrom = i;
      lineTo = end < 0 ? length : end;
    }
    return lineTo;
  };
  let braceFrom = -1;
  let braceTo = -1;
  const braceOnLine = (i: number) => {
    if (i < braceFrom || i > braceTo) {
      let j = i;
      while (j < length && at(j) !== 123 && at(j) !== 10) j++;
      braceFrom = i;
      braceTo = j;
    }
    return at(braceTo) === 123;
  };
  // End of a dotted name chain after the word that ends at `e`. Every word in
  // a chain has one chain end, so remember the last chain; long lines stay linear.
  let chainFrom = -1;
  let chainTo = -1;
  const chainEnd = (e: number) => {
    if (e >= chainFrom && e <= chainTo) return chainTo;
    let k = e;
    while (at(k) === 46 && isWordCode(at(k + 1))) k = wordEnd(k + 1);
    chainFrom = e;
    chainTo = k;
    return k;
  };
  // The grammar's name lists with a lookahead, such as `a, b :=`. Backtracking
  // into a list cannot satisfy the lookahead, so a list matches exactly when
  // the lookahead holds after its longest run. Each start inside a list has
  // that one end; test it once per list so long lines stay linear.
  const listRule = (names: RegExp, after: RegExp, first: (c: number) => boolean) => {
    let from = -1;
    let to = -1;
    let ok = false;
    return (i: number) => {
      if (!first(at(i))) return -1;
      if (i < from || i >= to) {
        const list = exec(names, i);
        if (!list) return -1;
        from = i;
        to = i + list[0].length;
        ok = exec(after, to) !== null;
      }
      return ok ? to : -1;
    };
  };
  const shortAssignment = listRule(SHORT_NAMES, SHORT_AFTER, isAsciiWord);
  const assignmentTargets = listRule(
    TARGET_NAMES,
    TARGET_AFTER,
    (c) => isAsciiWord(c) || c === 42 || c === 46,
  );
  // True when only spaces precede `i` on its line: the grammar's `^\s*`.
  const lineIndent = (i: number) => {
    let j = i - 1;
    while (at(j) === 32 || at(j) === 9) j--;
    return j < 0 || at(j) === 10;
  };
  const word = (start: number, end: number, fallback: number) => {
    push(words[source.slice(start, end)] ?? fallback, start, end);
  };

  // Comments, strings, runes, and numbers have no context. Each returns the
  // index after the token, or -1 when none starts at `i`.
  const literal = (i: number, limit: number): number => {
    const c = at(i);
    if (c === 47 && at(i + 1) === 47) {
      push(LINE_MARK, i, i + 2);
      const end = Math.min(lineEnd(i), limit);
      push(LINE, i + 2, end);
      return end;
    }
    if (c === 47 && at(i + 1) === 42) {
      push(BLOCK_MARK, i, i + 2);
      const close = source.indexOf("*/", i + 2);
      const end = close < 0 || close + 2 > limit ? limit : close;
      push(BLOCK, i + 2, end);
      if (end === close) push(BLOCK_MARK, close, close + 2);
      return end === close ? close + 2 : end;
    }
    if (c === 34) return quoted(i, limit, S.body, S.begin, S.end, true);
    if (c === 96) return quoted(i, limit, R.body, R.begin, R.end, false);
    if (c === 39) {
      push(RU.begin, i, i + 1);
      let j = i + 1;
      const value = exec(RUNE_VALUE, j);
      if (value) {
        push(RU.value, j, j + value[0].length);
        j += value[0].length;
      }
      const close = source.indexOf("'", j);
      const end = close < 0 || close >= limit ? limit : close;
      push(RU.invalid, j, end);
      if (end === close) push(RU.end, close, close + 1);
      return end === close ? close + 1 : end;
    }
    if (isDigit(c) && !isWordCode(at(i - 1))) {
      const run = exec(NUMBER_RUN, i)![0];
      const end = Math.min(i + run.length, limit);
      number(i, end);
      return end;
    }
    return -1;
  };
  const quoted = (
    i: number,
    limit: number,
    body: number,
    begin: number,
    end: number,
    escapes: boolean,
  ) => {
    push(begin, i, i + 1);
    const quote = at(i);
    let j = i + 1;
    let from = j;
    while (j < limit) {
      const c = at(j);
      if (c === quote) {
        push(body, from, j);
        push(end, j, j + 1);
        return j + 1;
      }
      if (escapes && c === 92) {
        push(body, from, j);
        const escape = exec(ESCAPE, j);
        if (escape) {
          push(S.escape, j, j + escape[0].length);
          j += escape[0].length;
        } else if (j + 1 < limit && !"\"'0-7Uabfnrtuvx".includes(source[j + 1]!)) {
          push(S.badEscape, j, j + 2);
          j += 2;
        } else j += 1;
        from = j;
        continue;
      }
      if (c === 37) {
        const placeholder = exec(PLACEHOLDER, j);
        if (placeholder) {
          push(body, from, j);
          push(escapes ? S.placeholder : R.placeholder, j, j + placeholder[0].length);
          j += placeholder[0].length;
          from = j;
          continue;
        }
      }
      j += 1;
    }
    push(body, from, limit);
    return limit;
  };
  // Numbers follow the grammar's complete-literal patterns; any other run of
  // number characters is invalid.
  const number = (start: number, end: number) => {
    const text = source.slice(start, end);
    // A digit run; its inner separators nest in the run's scope.
    const digits = (from: number, to: number, scope: number) => {
      if (!text.includes("_")) {
        push(scope, from, to);
        return;
      }
      const separator = kind(`${types[scope]}|${types[N.separator]}`);
      for (let j = from; j < to; j++) {
        const inner =
          at(j) === 95 && j > from && j + 1 < to && isHex(at(j - 1)) && isHex(at(j + 1));
        push(inner ? separator : scope, j, j + 1);
      }
    };
    const imaginary = (j: number) => {
      if (at(j) === 105 && j + 1 === end) {
        push(N.imaginary, j, end);
        return end;
      }
      return j;
    };
    if (/^\d+$/.test(text)) {
      push(N.decimal, start, end);
      return;
    }
    let m = /^0[xX]/.test(text)
      ? /^(0[xX])_?([0-9a-fA-F_]*)(\.[0-9a-fA-F_]*)?(?:([pP])([+-]?)([0-9_]+))?(i)?$/.exec(text)
      : null;
    if (m && (m[2] || m[3]) && (m[4] || !m[3]) && !/__|_$|^_/.test(m[2])) {
      push(N.hexUnit, start, start + 2);
      let j = start + 2 + (text[2] === "_" ? 1 : 0);
      digits(j, j + m[2].length, N.hex);
      j += m[2].length;
      if (m[3]) {
        push(N.hex, j, j + 1);
        digits(j + 1, j + m[3].length, N.hex);
        j += m[3].length;
      }
      if (m[4]) {
        push(N.hexExponent, j, j + 1);
        j += 1;
        if (m[5]) push(m[5] === "+" ? N.hexPlus : N.hexMinus, j, j + 1);
        j += m[5].length;
        digits(j, j + m[6].length, N.hexExponentValue);
        j += m[6].length;
      }
      imaginary(j);
      return;
    }
    m = /^(0[bB])_?([01_]+)(i)?$/.exec(text);
    if (m) {
      push(N.binaryUnit, start, start + 2);
      const j = start + 2 + (text[2] === "_" ? 1 : 0);
      digits(j, j + m[2].length, N.binary);
      imaginary(j + m[2].length);
      return;
    }
    m = /^(0[oO])_?([0-7_]+)(i)?$/.exec(text);
    if (m) {
      push(N.octalUnit, start, start + 2);
      const j = start + 2 + (text[2] === "_" ? 1 : 0);
      digits(j, j + m[2].length, N.octal);
      imaginary(j + m[2].length);
      return;
    }
    m = /^([0-9][0-9_]*)?(\.)?([0-9][0-9_]*)?(?:([eE])([+-]?)([0-9][0-9_]*))?(i)?$/.exec(text);
    if (m && (m[1] || m[3]) && !/_$/.test(m[1] ?? "") && (m[2] || m[4] || !m[3])) {
      let j = start;
      if (m[1]) {
        digits(j, j + m[1].length, N.decimal);
        j += m[1].length;
      }
      if (m[2]) push(N.point, j, ++j);
      if (m[3]) {
        digits(j, j + m[3].length, N.decimal);
        j += m[3].length;
      }
      if (m[4]) {
        push(N.exponent, j, ++j);
        if (m[5]) push(m[5] === "+" ? N.plus : N.minus, j, ++j);
        digits(j, j + m[6].length, N.exponentValue);
        j += m[6].length;
      }
      imaginary(j);
      return;
    }
    push(N.invalid, start, end);
  };

  // The end of the last `*` and `&` run, which is the same from each of its
  // characters; a long run stays linear.
  let addressFrom = -1;
  let addressTo = -1;
  const operator = (i: number): number => {
    for (const [text, scope] of OPERATORS)
      if (source.startsWith(text, i)) {
        push(scope, i, i + text.length);
        return i + text.length;
      }
    const c = at(i);
    const next = at(i + 1);
    // Address: `*` or `&` runs before a name, a bracket, or a receive.
    if ((c === 42 || c === 38) && !isWordCode(at(i - 1))) {
      let j = i;
      if (i > addressFrom && i < addressTo) j = addressTo;
      else {
        while (at(j) === 42 || at(j) === 38) j++;
        addressFrom = i;
        addressTo = j;
      }
      const after = at(j);
      if (
        !isDigit(after) &&
        (isWordCode(after) || after === 91 || after === 93 || (after === 60 && at(j + 1) === 45))
      ) {
        push(ADDRESS, i, j);
        return j;
      }
    }
    if ((c === 61 || c === 33) && next === 61) return emit(COMPARISON, i, 2);
    if ((c === 60 || c === 62) && next === 61) return emit(COMPARISON, i, 2);
    if (c === 60 && next !== 60) return emit(COMPARISON, i, 1);
    if (c === 62 && next !== 62) return emit(COMPARISON, i, 1);
    if ((c === 38 && next === 38) || (c === 124 && next === 124)) return emit(LOGICAL, i, 2);
    if (c === 33) return emit(LOGICAL, i, 1);
    if (c === 61) return emit(ASSIGNMENT, i, 1);
    if ((c === 60 && next === 60) || (c === 62 && next === 62))
      return at(i + 2) === 61 ? emit(ASSIGNMENT, i, 3) : emit(BITWISE, i, 2);
    if (c === 38 && next === 94)
      return at(i + 2) === 61 ? emit(ASSIGNMENT, i, 3) : emit(BITWISE, i, 2);
    if ("-%*+/:^|&".includes(source[i]!) && next === 61) return emit(ASSIGNMENT, i, 2);
    if (c === 45 || c === 37 || c === 42 || c === 43 || c === 47) return emit(ARITHMETIC, i, 1);
    if (c === 38 || c === 94 || c === 124 || c === 126) return emit(BITWISE, i, 1);
    if (c === 44) return emit(COMMA, i, 1);
    if (c === 46) return emit(PERIOD, i, 1);
    if (c === 58) return emit(COLON, i, 1);
    if (c === 59) return emit(SEMICOLON, i, 1);
    return -1;
  };
  const emit = (scope: number, i: number, width: number) => {
    push(scope, i, i + width);
    return i + width;
  };

  // Tokenize a captured span: names, delimiters, operators, and literals,
  // with other words in `fallback`. Parentheses inside are parameter lists,
  // and brackets hold generic parameters, as in the grammar's type captures.
  // Where a capture includes the grammar's bracket regions instead, the
  // `statements` brackets hold statements: TYPE_REST for `[` after a space in
  // a `type` declaration, CASE_TYPES for every bracket in a type case.
  const span = (start: number, end: number, fallback: number, depth = 0, statements = 0) => {
    let i = start;
    while (i < end) {
      const c = at(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        i++;
        continue;
      }
      const next = literal(i, end);
      if (next >= 0) {
        i = next;
        continue;
      }
      if (isWordCode(c)) {
        const e = Math.min(wordEnd(i), end);
        const text = source.slice(i, e);
        if (text === "map" && at(e) === 91 && depth < MAX_DEPTH) {
          push(KEYWORD_MAP, i, e);
          i = group(e, end, TYPE, depth + 1);
          continue;
        }
        word(i, e, fallback);
        i = e;
        continue;
      }
      const before = at(i - 1);
      if (
        depth < MAX_DEPTH &&
        ((statements === TYPE_REST &&
          c === 91 &&
          !isWordCode(before) &&
          before !== 42 &&
          before !== 46) ||
          (statements === CASE_TYPES && (c === 40 || c === 91 || c === 123)))
      ) {
        i = statementGroup(i, end, depth + 1);
        continue;
      }
      if ((c === 40 || c === 91) && depth < MAX_DEPTH) {
        i = group(i, end, fallback, depth + 1);
        continue;
      }
      if (c === 123 || c === 125 || c === 41 || c === 93) {
        push(c === 123 ? BRACKETS["{"]![0] : CLOSERS[c]!, i, i + 1);
        i++;
        continue;
      }
      const after = operator(i);
      i = after >= 0 ? after : i + 1;
    }
  };
  // Declared or assigned names: each word takes `scope`, also a keyword.
  const names = (start: number, end: number, scope: number) => {
    let i = start;
    while (i < end) {
      const c = at(i);
      if (isWordCode(c)) {
        const e = Math.min(wordEnd(i), end);
        push(scope, i, e);
        i = e;
      } else if (c === 32 || c === 9) i++;
      else {
        const after = operator(i);
        i = after >= 0 ? after : i + 1;
      }
    }
  };
  // A bracketed group of statements inside a span.
  const statementGroup = (i: number, end: number, depth: number) => {
    const [scope, close] = BRACKETS[source[i]!]!;
    let level = 0;
    let j = i;
    for (; j < end; j++) {
      const c = at(j);
      if (c === at(i)) level++;
      else if (c === close && --level === 0) break;
    }
    push(scope, i, i + 1);
    caseSpan(i + 1, j, depth, false, 1);
    if (j < end) push(CLOSERS[close]!, j, j + 1);
    return Math.min(j + 1, end);
  };
  // A bracketed group inside a span: `(` holds parameters, `[` generics.
  const group = (i: number, end: number, fallback: number, depth: number) => {
    const open = source[i]!;
    const [scope, close] = BRACKETS[open]!;
    let level = 0;
    let j = i;
    for (; j < end; j++) {
      const c = at(j);
      if (c === at(i)) level++;
      else if (c === close && --level === 0) break;
    }
    push(scope, i, i + 1);
    if (open === "(") parameterSpan(i + 1, j, depth);
    else span(i + 1, j, fallback === TYPE ? TYPE : fallback, depth);
    if (j < end) push(CLOSERS[close]!, j, j + 1);
    return Math.min(j + 1, end);
  };
  // Parameters in a captured span, such as a function type's results.
  const parameterSpan = (start: number, end: number, depth: number) => {
    let i = start;
    while (i < end) {
      const c = at(i);
      if (isWordCode(c) && !(source.slice(i, wordEnd(i)) in words)) {
        const pair = exec(PARAMETER_PAIR, i);
        if (pair && i + pair[0].length <= end) {
          span(i, i + pair[1]!.length, PARAMETER, depth);
          const typeStart = i + pair[0].length - pair[2]!.length;
          span(typeStart, i + pair[0].length, TYPE, depth);
          i += pair[0].length;
          continue;
        }
        const e = Math.min(wordEnd(i), end);
        push(TYPE, i, e);
        i = e;
        continue;
      }
      if (c === 44) {
        push(COMMA, i, i + 1);
        i++;
        continue;
      }
      const stop = nextComma(i, end);
      span(i, stop, TYPE, depth);
      i = stop;
    }
  };
  const nextComma = (i: number, end: number) => {
    let level = 0;
    for (let j = i; j < end; j++) {
      const c = at(j);
      if (c === 40 || c === 91) level++;
      else if (c === 41 || c === 93) level--;
      else if (c === 44 && level === 0 && j > i) return j;
      if (isWordCode(c) && j > i && !isWordCode(at(j - 1)) && level === 0) return j;
    }
    return end;
  };

  // Words in statements, where the grammar tries functions, types, then
  // variables. Returns the index after what it emitted.
  const statementWord = (i: number, mode: number, depth: number): number => {
    const e = wordEnd(i);
    const text = source.slice(i, e);
    const before = at(i - 1);
    const known = words[text];

    if (text === "func") {
      if (i === 0 || before === 10) return functionDeclaration(i, e, depth);
      if (at(e) === 40) {
        const inline = exec(INLINE_FUNC, e);
        if (inline) {
          push(KEYWORD_FUNC, i, e);
          span(e, e + inline[1]!.length, TYPE, depth);
          return e + inline[1]!.length;
        }
        return functionLiteral(i, e, depth);
      }
    }
    if (text === "package") {
      const name = spaces(e);
      if (name > e) {
        push(KEYWORD_PACKAGE, i, e);
        const end = wordEnd(name);
        push(isDigit(at(name)) ? INVALID_NAME : PACKAGE, name, end);
        return end;
      }
    }
    if (text === "import") {
      const j = spaces(e);
      if (j > e || at(e) === 10) {
        push(KEYWORD_IMPORT, i, e);
        return importSpec(j, depth);
      }
    }
    if (text === "type" && lineIndent(i)) {
      const j = spaces(e);
      if (at(j) === 40) {
        push(KEYWORD_TYPE, i, e);
        return region(j, TYPES, depth);
      }
      const single = exec(SINGLE_TYPE, j);
      if (single && j > e) {
        push(KEYWORD_TYPE, i, e);
        span(j, j + single[1]!.length, TYPE, depth);
        const restStart = j + single[0].length - single[2]!.length;
        span(restStart, j + single[0].length, TYPE, depth, TYPE_REST);
        return j + single[0].length;
      }
      const nameEnd = wordEnd(j);
      if (nameEnd > j) {
        push(KEYWORD_TYPE, i, e);
        let k = nameEnd;
        while (at(k) === 46 && isWordCode(at(k + 1))) k = wordEnd(k + 1);
        span(j, k, TYPE, depth);
        if (at(k) === 91) return typeParameters(k, depth);
        return k;
      }
    }
    if ((text === "const" || text === "var") && depth < MAX_DEPTH) {
      push(known!, i, e);
      const j = spaces(e);
      if (at(j) === 40) return region(j, text === "const" ? CONSTANTS : VARIABLES, depth);
      return declaredNames(j, text === "const" ? CONSTANT : ASSIGNED, depth);
    }
    if ((text === "struct" || text === "interface") && depth < MAX_DEPTH) {
      const j = spaces(e);
      if (at(j) === 123) {
        push(known!, i, e);
        return region(j, text === "struct" ? STRUCT : INTERFACE, depth);
      }
    }
    if (text === "map" && at(e) === 91 && depth < MAX_DEPTH) {
      push(KEYWORD_MAP, i, e);
      return mapType(e, depth);
    }
    if (text === "switch" && depth < MAX_DEPTH) {
      push(KEYWORD_CONTROL, i, e);
      // Both switch heads end with `{` on this line.
      const braced = braceOnLine(e);
      const typeSwitch = braced ? exec(TYPE_SWITCH, e) : null;
      if (typeSwitch) {
        let j = e + typeSwitch[0].length - 1;
        const [, assigned = "", subject, guard] = typeSwitch;
        let k = spaces(e);
        if (assigned) {
          const nameEnd = wordEnd(k);
          push(ASSIGNED, k, nameEnd);
          k = spaces(nameEnd);
          push(ASSIGNMENT, k, k + 2);
          k = spaces(k + 2);
        }
        statementSpan(k, k + subject!.length, depth);
        k += subject!.length;
        span(k, k + guard!.length, VARIABLE, depth);
        void j;
        return region(e + typeSwitch[0].length - 1, TYPE_SWITCH_BODY, depth);
      }
      const head = braced ? exec(SWITCH_HEAD, e) : null;
      if (head) {
        const brace = e + head[0].length - 1;
        caseSpan(e, brace, depth);
        return region(brace, SWITCH_BODY, depth);
      }
      return e;
    }
    if (text === "case" && lineIndent(i)) {
      if (mode === TYPE_SWITCH_BODY) {
        const j = spaces(e);
        const typeCase = exec(TYPE_CASE, j);
        push(KEYWORD_CONTROL, i, e);
        if (typeCase && j > e) {
          span(j, j + typeCase[1]!.length, TYPE, depth);
          const colon = j + typeCase[1]!.length;
          push(COLON, colon, colon + 1);
          return colon + 1;
        }
        // The statements' case line rule starts first after indentation.
        const valueCase = i > 0 && at(i - 1) !== 10 && j > e ? exec(VALUE_CASE, j) : null;
        if (valueCase) {
          const colon = j + valueCase[1]!.length;
          caseSpan(j, colon, depth);
          push(COLON, colon, colon + 1);
          return colon + 1;
        }
        const colon = source.indexOf(":", e);
        const end = colon < 0 ? length : colon;
        span(e, end, TYPE, depth, CASE_TYPES);
        if (colon >= 0) push(COLON, colon, colon + 1);
        return colon < 0 ? length : colon + 1;
      }
      const j = spaces(e);
      const valueCase = exec(VALUE_CASE, j);
      // In a switch body, this line rule wins only when indentation makes it
      // start before the body's case rule.
      if (valueCase && j > e && (mode !== SWITCH_BODY || (i > 0 && at(i - 1) !== 10))) {
        push(KEYWORD_CONTROL, i, e);
        const colon = j + valueCase[1]!.length;
        caseSpan(j, colon, depth);
        push(COLON, colon, colon + 1);
        return colon + 1;
      }
    }
    // The switch body's case rule: `case` to the next `:`, also over lines.
    if (text === "case" && mode === SWITCH_BODY) {
      push(KEYWORD_CONTROL, i, e);
      return caseSpan(e, length, depth, true);
    }
    if ((text === "break" || text === "goto" || text === "continue") && lineIndent(i)) {
      const jump = exec(JUMP_LINE, i);
      if (jump) {
        push(KEYWORD_CONTROL, i, e);
        const label = source.indexOf(jump[1]!, e);
        push(LABEL, label, label + jump[1]!.length);
        return label + jump[1]!.length;
      }
    }
    if ((text === "new" || text === "make") && at(e) === 40 && depth < MAX_DEPTH) {
      push(BUILTIN, i, e);
      push(BRACKETS["("]![0], e, e + 1);
      let j = e + 1;
      if (text === "make") {
        const made = exec(MAKE_TYPE, j);
        if (made && made[0].length) {
          span(j, j + made[0].length, TYPE, depth);
          j += made[0].length;
        }
      }
      return region(j, text === "new" ? NEW_CALL : STATEMENTS, depth, 41);
    }
    // The grammar tries built-in functions first, also after a period.
    if (BUILTINS.has(text) && at(e) === 40) {
      push(BUILTIN, i, e);
      return e;
    }
    // After a period, any other name before `(` is a call, also a keyword's name.
    if (before === 46 && at(balanced(e)) === 40) {
      push(CALL, i, e);
      const callEnd = balanced(e);
      if (callEnd > e) span(e, callEnd, TYPE, depth);
      return callEnd;
    }
    if (known !== undefined) {
      push(known, i, e);
      return e;
    }

    const run = controlRun(i);
    if (run > i) {
      caseSpan(i, run, depth);
      return run;
    }
    // Composite literal: a type name, possibly qualified or generic, before `{`.
    const nameEnd = chainEnd(e);
    const k = balanced(nameEnd);
    if (at(k) === 123) {
      span(i, nameEnd, TYPE, depth);
      if (k > nameEnd) span(nameEnd, k, TYPE, depth);
      return k;
    }
    // Call: a name, with optional generic arguments, before `(`.
    const callEnd = balanced(e);
    if (at(callEnd) === 40) {
      push(before === 46 ? CALL : isDigit(at(i)) ? INVALID_NAME : CALL, i, e);
      if (callEnd > e) span(e, callEnd, TYPE, depth);
      return callEnd;
    }
    // The regular expressions below need one of these characters next.
    const afterName = at(spaces(e));
    const afterChain = at(spaces(nameEnd));
    const short = afterName === 44 || afterName === 58 ? shortAssignment(i) : -1;
    if (short > i) {
      names(i, short, ASSIGNED);
      return short;
    }
    const targets =
      afterChain === 44 || afterChain === 61 || afterChain === 42 || afterName === 42
        ? assignmentTargets(i)
        : -1;
    if (targets > i) {
      names(i, targets, ASSIGNED);
      return targets;
    }
    if (at(e) === 58 && lineIndent(i) && exec(LABEL_LINE, i)) {
      push(LABEL, i, e);
      return e;
    }
    if (before === 91 && isWordCode(at(i - 2))) {
      const slice = exec(SLICE_INDEX, i);
      if (slice) {
        span(i, i + slice[0].length, VARIABLE, depth);
        return i + slice[0].length;
      }
    }
    const property = at(nameEnd) === 58 ? exec(PROPERTY_NAME, i) : null;
    if (property) {
      span(i, i + property[0].length, PROPERTY, depth);
      return i + property[0].length;
    }
    push(VARIABLE, i, e);
    return e;
  };
  // Skip balanced brackets that start at `i`.
  // The index after the `]` that closes the `[` at `i` on its line, else `i`.
  // Pair a line's brackets once: this runs at many words, and an unclosed `[`
  // would otherwise rescan to the line end each time.
  const closes = new Map<number, number>();
  let pairedFrom = 0;
  let pairedTo = -1;
  const balanced = (i: number) => {
    if (at(i) !== 91) return i;
    if (i < pairedFrom || i >= pairedTo) {
      pairedFrom = source.lastIndexOf("\n", i - 1) + 1;
      pairedTo = lineEnd(i);
      closes.clear();
      const open: number[] = [];
      for (let j = pairedFrom; j < pairedTo; j++) {
        const c = at(j);
        if (c === 91) open.push(j);
        else if (c === 93 && open.length) closes.set(open.pop()!, j + 1);
      }
    }
    return closes.get(i) ?? i;
  };
  // A statement fragment in a captured span, such as a switch subject.
  const statementSpan = (start: number, end: number, depth: number) => {
    let i = start;
    while (i < end) {
      const c = at(i);
      if (isWordCode(c) && !isDigit(c)) {
        const e = Math.min(wordEnd(i), end);
        const text = source.slice(i, e);
        if (words[text] !== undefined) push(words[text]!, i, e);
        else if (balanced(e) < end && at(balanced(e)) === 40) push(CALL, i, e);
        else push(VARIABLE, i, e);
        i = e;
        continue;
      }
      span(i, i + 1, VARIABLE, depth);
      i++;
    }
  };
  // A case or switch expression: calls, short assignments, and variables.
  // Inside brackets the grammar applies all statement rules again. With
  // `toColon`, the span ends after the first `:` outside brackets.
  const caseSpan = (start: number, end: number, depth: number, toColon = false, nested = 0) => {
    let i = start;
    while (i < end) {
      const c = at(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        i++;
        continue;
      }
      if (toColon && c === 58 && !nested) {
        push(COLON, i, i + 1);
        return i + 1;
      }
      const next = literal(i, end);
      if (next >= 0) {
        i = next;
        continue;
      }
      if (isWordCode(c)) {
        const e = Math.min(wordEnd(i), end);
        const text = source.slice(i, e);
        const short = shortAssignment(i);
        const targets = short > i ? -1 : assignmentTargets(i);
        if (words[text] !== undefined) push(words[text]!, i, e);
        else if (nested && BUILTINS.has(text) && at(e) === 40) push(BUILTIN, i, e);
        // Outside brackets, these spans have no built-in function rule.
        else if (at(balanced(e)) === 40 && balanced(e) <= end) push(CALL, i, e);
        else if (short > i && short <= end) {
          names(i, short, ASSIGNED);
          i = short;
          continue;
        } else if (targets > i && targets <= end) {
          names(i, targets, ASSIGNED);
          i = targets;
          continue;
        } else push(VARIABLE, i, e);
        i = e;
        continue;
      }
      if (c === 40 || c === 91 || c === 123) {
        push(BRACKETS[source[i]!]![0], i, i + 1);
        nested++;
        i++;
        continue;
      }
      if (c === 41 || c === 93 || c === 125) {
        push(CLOSERS[c]!, i, i + 1);
        if (nested) nested--;
        i++;
        continue;
      }
      const after = operator(i);
      i = after >= 0 ? after : i + 1;
    }
    return i;
  };

  // `func` at the start of a line: receiver, name, parameters, and results.
  const functionDeclaration = (i: number, e: number, depth: number) => {
    push(KEYWORD_FUNC, i, e);
    let j = spaces(e);
    if (at(j) === 40) {
      const close = source.indexOf(")", j);
      const lineStop = lineEnd(j);
      if (close > j + 1 && close < lineStop) {
        push(BRACKETS["("]![0], j, j + 1);
        const receiver = /^[ \t]*(\w+[ \t]+)?([*.\w]+(?:\[(?:[*.\w]+(?:,[ \t]+)?)*\])?)/.exec(
          source.slice(j + 1, close),
        );
        let k = j + 1;
        if (receiver) {
          const nameStart =
            k + receiver[0].length - receiver[2]!.length - (receiver[1]?.length ?? 0);
          if (receiver[1]) push(PARAMETER, nameStart, nameStart + receiver[1].trimEnd().length);
          const typeStart = k + receiver[0].length - receiver[2]!.length;
          span(typeStart, typeStart + receiver[2]!.length, TYPE, depth);
          k += receiver[0].length;
        }
        span(k, close, VARIABLE, depth);
        push(CLOSERS[41]!, close, close + 1);
        j = spaces(close + 1);
      }
    }
    const nameEnd = wordEnd(j);
    if (nameEnd > j && (at(nameEnd) === 40 || at(nameEnd) === 91)) {
      push(isDigit(at(j)) ? INVALID_NAME : FUNCTION, j, nameEnd);
      j = nameEnd;
    }
    return signature(j, depth, true);
  };
  // A function literal or type: one parameter list, then its results.
  const functionLiteral = (i: number, e: number, depth: number) => {
    push(KEYWORD_FUNC, i, e);
    return signature(e, depth, false);
  };
  // The grammar's function regions: parameter lists and generic brackets,
  // ending at the results before the body.
  const signature = (i: number, depth: number, declaration: boolean): number => {
    let j = i;
    while (j < length) {
      const k = skipSpace(j);
      const c = at(k);
      const comment = c === 47 && (at(k + 1) === 47 || at(k + 1) === 42) ? literal(k, length) : -1;
      if (comment >= 0) {
        j = comment;
        continue;
      }
      if (c === 40 && depth < MAX_DEPTH) {
        j = region(k, PARAMETERS, depth + 1);
        if (!declaration) {
          const result = exec(LITERAL_RESULT, j);
          if (result && result[0].length) {
            span(j, j + result[0].length, TYPE, depth);
            return j + result[0].length;
          }
          return j;
        }
        const body = exec(RESULT_BEFORE_BODY, j);
        if (body) {
          span(j, j + body[0].length, TYPE, depth);
          return j + body[0].length;
        }
        const eol = exec(RESULT_AT_EOL, j);
        if (eol) {
          span(j, j + eol[0].length, TYPE, depth);
          return j + eol[0].length;
        }
        continue;
      }
      if ((c === 91 || c === 42 || c === 46 || isWordCode(c)) && declaration && depth < MAX_DEPTH) {
        // The generic rule's `[*.\w]+` before `[`, such as `iter.Seq2[V]`.
        let nameEnd = k;
        while (isWordCode(at(nameEnd)) || at(nameEnd) === 42 || at(nameEnd) === 46) nameEnd++;
        if (at(nameEnd) === 91) {
          if (nameEnd > k) span(k, nameEnd, TYPE, depth);
          j = region(nameEnd, GENERICS, depth + 1);
          continue;
        }
      }
      return k;
    }
    return j;
  };
  const skipSpace = (i: number) => {
    while (i < length) {
      const c = at(i);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      i++;
    }
    return i;
  };
  // `type Name[T any]`: the generic parameters, then the defined type.
  const typeParameters = (i: number, depth: number) => region(i, GENERICS, depth + 1);

  const importSpec = (i: number, depth: number): number => {
    if (at(i) === 40) {
      push(IMPORTS_OPEN, i, i + 1);
      return region(i + 1, IMPORTS, depth, 41);
    }
    const spec = /^([.\w]+)?[ \t]*(")([^"\n]*)(")/.exec(source.slice(i, lineEnd(i)));
    if (!spec) return i;
    if (spec[1]) span(i, i + spec[1].length, IMPORT_ALIAS, depth);
    const quote = i + spec[0].length - spec[3]!.length - 2;
    push(S.begin, quote, quote + 1);
    push(S.import, quote + 1, quote + 1 + spec[3]!.length);
    push(S.end, quote + 1 + spec[3]!.length, quote + 2 + spec[3]!.length);
    return i + spec[0].length;
  };
  // Names after `const` or `var`, with an optional type before `=`.
  const declaredNames = (i: number, scope: number, depth: number) => {
    const declared = exec(DECLARED_NAMES, i);
    if (!declared || !declared[0].length) return i;
    names(i, i + declared[1]!.length, scope);
    const typeStart = i + declared[0].length - (declared[2]?.length ?? 0);
    if (declared[2]) span(typeStart, i + declared[0].length, TYPE, depth);
    return i + declared[0].length;
  };
  const mapType = (i: number, depth: number) => {
    const close = region(i, MAP_KEY, depth + 1);
    const value = exec(MAP_VALUE, close);
    if (value && value[0].length) {
      span(close, close + value[0].length, TYPE, depth);
      return close + value[0].length;
    }
    return close;
  };
  // Struct fields: names with a type, or an embedded type.
  const structField = (i: number, depth: number): number => {
    let b = i - 1;
    while (at(b) === 32 || at(b) === 9) b--;
    // After `{` on the same line, a field ends before the closing brace.
    const inline = at(b) === 123;
    const lineStop = lineEnd(i);
    let rest = source.slice(i, lineStop);
    if (inline) {
      const close = rest.indexOf("}");
      if (close >= 0) rest = rest.slice(0, close).trimEnd();
    }
    const nested =
      /^(\w+(?:[ \t]*,[ \t]*\b\w+)*(?:[ \t]*[\]*[]*)?)\b(struct|interface|func)\b[ \t]*([{(])/.exec(
        rest,
      );
    if (nested) {
      span(i, i + nested[1]!.length, PROPERTY, depth);
      const keyword = i + nested[1]!.length;
      push(words[nested[2]!]!, keyword, keyword + nested[2]!.length);
      const open = i + nested[0].length - 1;
      return nested[3] === "("
        ? region(open, PARAMETERS, depth + 1)
        : region(open, nested[2] === "interface" ? INTERFACE : STRUCT, depth + 1);
    }
    // The generic parameter rule comes next: `*pkg.Map[K, V]`.
    const generic = /^[*.\w]+(?=\[)/.exec(rest);
    if (generic) {
      const open = i + generic[0].length;
      span(i, open, TYPE, depth);
      return region(open, GENERICS, depth + 1);
    }
    if (!isWordCode(at(i))) return -1;
    const embedded =
      /^((?:[ \t]*[\]*[]*(?:<-[ \t]*)?\bchan\b(?:[ \t]*<-)?[ \t]*)*[*.\w]+[ \t]*)(?=["/`]|$)/.exec(
        rest,
      );
    if (embedded) {
      span(i, i + embedded[1]!.length, TYPE, depth);
      return i + embedded[1]!.length;
    }
    const field = /^(\w+(?:[ \t]*,[ \t]*\b\w+)*)[ \t]*([^"/`\n]+)/.exec(rest);
    if (field) {
      span(i, i + field[1]!.length, PROPERTY, depth);
      const typeStart = i + field[0].length - field[2]!.length;
      span(typeStart, i + field[0].length, TYPE, depth);
      return i + field[0].length;
    }
    return -1;
  };

  // Scan a region from its opening bracket at `i` (or from `i` when `close`
  // is given) to the matching close. Returns the index after the close.
  const region = (i: number, mode: number, depth: number, close?: number): number => {
    let j = i;
    let closer = close ?? -1;
    if (close === undefined) {
      const open = source[i]!;
      const bracket = BRACKETS[open];
      if (!bracket) return i;
      push(mode === IMPORTS ? IMPORTS_OPEN : bracket[0], i, i + 1);
      closer = bracket[1];
      j = i + 1;
    }
    let lineChecked = -1;
    while (j < length) {
      const c = at(j);
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        j++;
        continue;
      }
      if (c === closer) {
        push(mode === IMPORTS ? IMPORTS_CLOSE : CLOSERS[closer]!, j, j + 1);
        return j + 1;
      }
      if (mode === IMPORTS && !(c === 47 && (at(j + 1) === 47 || at(j + 1) === 42))) {
        const after = importSpec(j, depth);
        if (after > j) {
          j = after;
          continue;
        }
      }
      const next = literal(j, length);
      if (next >= 0) {
        j = next;
        continue;
      }
      // Line-start patterns of block regions.
      if (lineChecked !== j && lineIndent(j) && isWordCode(c)) {
        lineChecked = j;
        if (mode === CONSTANTS || mode === VARIABLES) {
          const after = declaredNames(j, mode === CONSTANTS ? CONSTANT : ASSIGNED, depth);
          if (after > j) {
            j = after;
            continue;
          }
        }
      }
      if (mode === STRUCT && (isWordCode(c) || c === 42)) {
        const after = structField(j, depth);
        if (after > j) {
          j = after;
          continue;
        }
      }
      if (isWordCode(c) && (mode === STATEMENTS || mode === SWITCH_BODY)) {
        j = statementWord(j, mode, depth);
        continue;
      }
      if (isWordCode(c)) {
        const e = wordEnd(j);
        const text = source.slice(j, e);
        if (mode === PARAMETERS || mode === GENERICS) {
          const after = parameterWord(j, e, text, mode, depth);
          if (after > j) {
            j = after;
            continue;
          }
        }
        if (mode === INTERFACE && words[text] === undefined) {
          const k = chainEnd(e);
          const callEnd = balanced(k);
          if (at(callEnd) === 40) {
            push(CALL, j, e);
            if (callEnd > e) span(e, callEnd, TYPE, depth);
            j = callEnd;
            continue;
          }
          span(j, k, TYPE, depth);
          j = k;
          continue;
        }
        if (
          (mode === TYPES || mode === MAP_KEY || mode === NEW_CALL) &&
          words[text] === undefined
        ) {
          if (mode === NEW_CALL && at(balanced(e)) === 40) {
            push(CALL, j, e);
            j = e;
            continue;
          }
          push(TYPE, j, e);
          j = e;
          continue;
        }
        if (mode === TYPES && (text === "struct" || text === "interface")) {
          const k = spaces(e);
          if (at(k) === 123) {
            push(words[text]!, j, e);
            j = region(k, text === "struct" ? STRUCT : INTERFACE, depth + 1);
            continue;
          }
        }
        j = statementWord(j, mode, depth);
        continue;
      }
      // A condition before a block: `if ok {`, `range items {`.
      if (c !== 91 && c !== 93) {
        const run = controlRun(j);
        if (run > j) {
          caseSpan(j, run, depth);
          j = run;
          continue;
        }
      }
      if (c === 40 || c === 91 || c === 123) {
        if (depth >= MAX_DEPTH) {
          push(BRACKETS[source[j]!]![0], j, j + 1);
          j++;
          continue;
        }
        if (c === 40 && !isWordCode(at(j - 1))) {
          const conversion = exec(PARENTHESIZED_TYPE, j);
          if (conversion) {
            const end = j + conversion[0].length;
            push(BRACKETS["("]![0], j, j + 1);
            span(j + 1, end - 1, TYPE, depth);
            push(CLOSERS[41]!, end - 1, end);
            j = end;
            continue;
          }
        }
        if (c === 40 && at(j - 1) === 46) {
          // `.(T)` or `.(type)` after a value.
          const assertion = exec(TYPE_ASSERTION, j + 1);
          if (assertion || source.startsWith("type)", j + 1)) {
            push(BRACKETS["("]![0], j, j + 1);
            const end = assertion ? j + 1 + assertion[0].length : j + 5;
            span(j + 1, end, TYPE, depth);
            if (!assertion) push(KEYWORD_TYPE, j + 1, j + 5);
            push(CLOSERS[41]!, end, end + 1);
            j = end + 1;
            continue;
          }
        }
        // Interface and struct bodies include the grammar's parameter rules:
        // `(` holds parameters and `[` generic parameters.
        const childMode =
          mode === PARAMETERS ||
          mode === GENERICS ||
          ((mode === INTERFACE || mode === STRUCT) && c !== 123)
            ? c === 40
              ? PARAMETERS
              : GENERICS
            : mode === TYPES || mode === MAP_KEY
              ? mode
              : STATEMENTS;
        j = region(j, childMode, depth + 1);
        continue;
      }
      if (c === 41 || c === 93 || c === 125) {
        j++;
        continue;
      }
      const after = operator(j);
      j = after >= 0 ? after : j + 1;
    }
    return j;
  };
  // A parameter word: names with a type, names before a struct type, a
  // trailing list of names, or a bare type.
  const parameterWord = (j: number, e: number, text: string, mode: number, depth: number) => {
    if (text === "struct" || text === "interface") {
      const k = spaces(e);
      if (at(k) === 123) {
        push(words[text]!, j, e);
        return region(k, text === "struct" ? STRUCT : INTERFACE, depth + 1);
      }
    }
    if (text === "func" && at(e) === 40) return functionLiteral(j, e, depth);
    if (text === "map" && at(e) === 91) {
      push(KEYWORD_MAP, j, e);
      return mapType(e, depth);
    }
    if (words[text] !== undefined) {
      push(words[text]!, j, e);
      return e;
    }
    const bodyNames = exec(NAMES_BEFORE_BODY, j);
    if (bodyNames) {
      span(j, j + bodyNames[1]!.length, PARAMETER, depth);
      return j + bodyNames[1]!.length;
    }
    if (at(j - 1) === 40 || lineIndent(j)) {
      const trailing = exec(NAMES_AT_EOL, j);
      if (trailing) {
        span(j, j + trailing[1]!.length, PARAMETER, depth);
        return j + trailing[1]!.length;
      }
    }
    const pair = exec(mode === GENERICS ? GENERIC_PAIR : PARAMETER_PAIR, j);
    if (pair) {
      span(j, j + pair[1]!.length, PARAMETER, depth);
      const typeStart = j + pair[0].length - pair[2]!.length;
      span(typeStart, j + pair[0].length, TYPE, depth);
      return j + pair[0].length;
    }
    let k = e;
    while (at(k) === 46 && isWordCode(at(k + 1))) k = wordEnd(k + 1);
    if (at(k) === 91) {
      span(j, k, TYPE, depth);
      return region(k, GENERICS, depth + 1);
    }
    span(j, k, TYPE, depth);
    return k;
  };
  // The grammar's after-control rule: one run of expression characters
  // between a condition keyword or operator and `{`. Each start inside a run
  // gives the same end, so scan a run once; a long line stays linear.
  let runStart = -1;
  let runEnd = -1;
  let runBrace = false;
  const controlRun = (i: number) => {
    let b = i;
    while (at(b - 1) === 32 || at(b - 1) === 9) b--;
    if (!CONTROL_LAST.has(at(b - 1))) return -1;
    if (b === 0 || !CONTROL_BEFORE.test(source.slice(Math.max(0, b - 6), b))) return -1;
    if (i < runStart || i >= runEnd) {
      const run = exec(CONTROL_RUN, i);
      if (!run) return -1;
      runStart = i;
      runEnd = i + run[0].length;
      runBrace = exec(BEFORE_BRACE, runEnd) !== null;
    }
    return runBrace ? runEnd : -1;
  };

  region(0, STATEMENTS, 0, -1);
  return out.result();
}

export const tokenize = (_options?: { fidelity?: string }) => scan;
