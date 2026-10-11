import type { TokenizeResult } from "@twinkleplop/core";
import { createWriter, scopeTable } from "./token-writer";

// Rust after the Rust grammar that Shiki uses (rust-syntax; see
// upstream/GRAMMARS.md). Braces are not regions there: only calls, function
// signatures, generic arguments, attributes, and `use` items are. Each region
// adds a meta scope and tries its own patterns in its own order, which
// decides, for example, whether `Vec` in `Vec::new` is a type (top level) or a
// namespace (inside a call).
const { types, kind } = scopeTable();

// Leaf scopes. A token's kind is the scope of its regions, then the leaf.
const LEAVES: string[] = [];
const leaf = (scope: string) => LEAVES.push(scope) - 1;
const rs = (scope: string) => leaf(scope.replace(/(\S+)/g, "$1.rust").replace(/ /g, "|"));
// A token with only its regions' scopes, such as a word in an attribute.
const PLAIN = leaf("");
const VARIABLE = rs("variable.other");
const SELF = rs("variable.language.self");
const SUPER = rs("variable.language.super");
const CAPS = rs("constant.other.caps");
const BOOL = rs("constant.language.bool");
const OPTION = rs("entity.name.type.option");
const RESULT = rs("entity.name.type.result");
const FUNCTION = rs("entity.name.function");
const TYPE = rs("entity.name.type");
const NUMERIC_TYPE = rs("entity.name.type.numeric");
const PRIMITIVE = rs("entity.name.type.primitive");
const MODULE = rs("entity.name.module");
const NAMESPACE = rs("entity.name.namespace");
const LIFETIME = rs("entity.name.type.lifetime");
const LIFETIME_MARK = rs("punctuation.definition.lifetime");
const MACRO = rs("meta.macro entity.name.function.macro");
const TYPE_MACRO = rs("meta.macro entity.name.type.macro");
const MACRO_RULES = rs("meta.macro.rules entity.name.function.macro.rules");
const MACRO_RULES_NAME = rs("meta.macro.rules entity.name.function.macro");
const MACRO_RULES_TYPE = rs("meta.macro.rules entity.name.type.macro");
const MACRO_RULES_BRACE = rs("meta.macro.rules punctuation.brackets.curly");
const DOLLAR = rs("keyword.operator.macro.dollar");
const STORAGE = rs("storage.type");
const CRATE = rs("keyword.other.crate");
const KEYWORD = rs("keyword.other");
const FN = rs("keyword.other.fn");
const COMMA = rs("punctuation.comma");
const CURLY = rs("punctuation.brackets.curly");
const ROUND = rs("punctuation.brackets.round");
const SQUARE = rs("punctuation.brackets.square");
const ANGLE = rs("punctuation.brackets.angle");
const SEMI = rs("punctuation.semi");
const ATTRIBUTE_MARK = rs("punctuation.definition.attribute");
const ATTRIBUTE_BRACKET = rs("punctuation.brackets.attribute");
const LINE = rs("comment.line.double-slash");
const LINE_MARK = rs("comment.line.double-slash punctuation.definition.comment");
const DOC = rs("comment.line.documentation");
const DOC_MARK = rs("comment.line.documentation punctuation.definition.comment");
const COMPARISON = rs("keyword.operator.comparison");
const BORROW = rs("keyword.operator.borrow.and");
const LIFETIME_BORROW = rs("keyword.operator.borrow");
const DEREF = rs("keyword.operator.dereference");

// No prototype: names such as `toString` must not look like keywords.
const KEYWORDS: Record<string, number> = Object.create(null);
const keywords = (list: string, scope: number) => {
  for (const word of list.split(" ")) KEYWORDS[word] = scope;
};
keywords(
  "await break continue do else for if loop match return try while yield",
  rs("keyword.control"),
);
keywords("extern let macro mod", rs("keyword.other storage.type"));
keywords("const abstract static", rs("storage.modifier"));
keywords("type", rs("keyword.declaration.type storage.type"));
keywords("enum", rs("keyword.declaration.enum storage.type"));
keywords("trait", rs("keyword.declaration.trait storage.type"));
keywords("struct", rs("keyword.declaration.struct storage.type"));
keywords(
  "as async become box dyn move final gen impl in override priv pub ref typeof union unsafe unsized use virtual where",
  KEYWORD,
);
keywords("fn", FN);
keywords("crate", CRATE);
keywords("mut", rs("storage.modifier.mut"));
const DECLARATIONS: Record<string, number> = Object.assign(Object.create(null), {
  trait: rs("entity.name.type.trait"),
  struct: rs("entity.name.type.struct"),
  enum: rs("entity.name.type.enum"),
  type: rs("entity.name.type.declaration"),
});
const NUMERIC_TYPES = new Set(
  "f32 f64 i128 i16 i32 i64 i8 isize u128 u16 u32 u64 u8 usize".split(" "),
);

// Operators in the grammar's order; the first that matches wins.
const OPERATORS: [RegExp, number][] = [
  [/(?:[\^|]|\|\||&&|<<|>>|!)(?!=)/y, rs("keyword.operator.logical")],
  [/&(?![&=])/y, BORROW],
  [/(?:[-%&*+/^|]|<<|>>)=/y, rs("keyword.operator.assignment")],
  [/(?<![<>])=(?![=>])/y, rs("keyword.operator.assignment.equal")],
  [/=(?:=)?(?!>)|!=|<=|(?<!=)>=/y, COMPARISON],
  [/(?:[%+]|\*(?!\w))(?!=)|-(?!>)|\/(?!\/)/y, rs("keyword.operator.math")],
  [/::/y, rs("keyword.operator.namespace")],
  [/\*(?=\w)/y, DEREF],
  [/@/y, rs("keyword.operator.subpattern")],
  [/\.(?!\.)/y, rs("keyword.operator.access.dot")],
  [/\.{2}[.=]?/y, rs("keyword.operator.range")],
  [/:(?!:)/y, rs("keyword.operator.key-value")],
  [/->|<-/y, rs("keyword.operator.arrow.skinny")],
  [/=>/y, rs("keyword.operator.arrow.fat")],
  [/\$/y, DOLLAR],
  [/\?/y, rs("keyword.operator.question")],
];
// First characters of the operators above.
const OPERATOR_START = new Set([..."^|&!-%*+/=<>:.@$?"].map((c) => c.charCodeAt(0)));
const NAMESPACE_OPERATOR = OPERATORS[6]![1];
const KEY_VALUE = OPERATORS[11]![1];

const STRING = rs("string.quoted.double");
const STRING_MARK = rs("string.quoted.double punctuation.definition.string");
const BYTE_PREFIX = rs("string.quoted.double string.quoted.byte.raw");
const RAW_HASHES = rs("string.quoted.double punctuation.definition.string.raw");
const CHAR = rs("string.quoted.single.char");
const CHAR_MARK = rs("string.quoted.single.char punctuation.definition.char");
const CHAR_PREFIX = rs("string.quoted.single.char string.quoted.byte.raw");
const INTERPOLATION = rs("string.quoted.double meta.interpolation");
const INTERPOLATION_MARK = rs(
  "string.quoted.double meta.interpolation punctuation.definition.interpolation",
);
// Escapes, in a double-quoted string (0) or a char (1).
const escapeLeaves = (parent: string) => ({
  escape: rs(`${parent} constant.character.escape`),
  backslash: rs(`${parent} constant.character.escape constant.character.escape.backslash`),
  bit: rs(`${parent} constant.character.escape constant.character.escape.bit`),
  unicode: rs(`${parent} constant.character.escape constant.character.escape.unicode`),
  brace: rs(
    `${parent} constant.character.escape constant.character.escape.unicode constant.character.escape.unicode.punctuation`,
  ),
});
const ESCAPES = [escapeLeaves("string.quoted.double"), escapeLeaves("string.quoted.single.char")];
const N = {
  decimal: rs("constant.numeric.decimal"),
  dot: rs("constant.numeric.decimal punctuation.separator.dot.decimal"),
  exponent: rs("constant.numeric.decimal keyword.operator.exponent"),
  sign: rs("constant.numeric.decimal keyword.operator.exponent.sign"),
  mantissa: rs("constant.numeric.decimal constant.numeric.decimal.exponent.mantissa"),
  suffix: rs("constant.numeric.decimal entity.name.type.numeric"),
  hex: rs("constant.numeric.hex"),
  hexSuffix: rs("constant.numeric.hex entity.name.type.numeric"),
  oct: rs("constant.numeric.oct"),
  octSuffix: rs("constant.numeric.oct entity.name.type.numeric"),
  bin: rs("constant.numeric.bin"),
  binSuffix: rs("constant.numeric.bin entity.name.type.numeric"),
};
const META_TYPE = rs("meta.macro.metavariable.type");
const META_TYPE_NAME = rs("meta.macro.metavariable.type entity.name.type.metavariable");
const META_CRATE = rs("meta.macro.metavariable.type keyword.other.crate");
const META_NAME = rs("meta.macro.metavariable variable.other.metavariable.name");
const META_SPEC = rs("meta.macro.metavariable variable.other.metavariable.specifier");
const META_KEY_VALUE = rs("meta.macro.metavariable keyword.operator.key-value");
const META_TYPE_SPEC = rs("meta.macro.metavariable.type variable.other.metavariable.specifier");
const META_TYPE_KEY_VALUE = rs("meta.macro.metavariable.type keyword.operator.key-value");
const META_DOLLAR = rs("meta.macro.metavariable keyword.operator.macro.dollar");
const META_TYPE_DOLLAR = rs("meta.macro.metavariable.type keyword.operator.macro.dollar");

const SUFFIX = "(?:f32|f64|i128|i16|i32|i64|i8|isize|u128|u16|u32|u64|u8|usize)";
const DECIMAL = new RegExp(
  `\\d[_\\d]*(\\.?)[_\\d]*(?:([Ee])([-+]?)([_\\d]+))?(${SUFFIX})?\\b`,
  "y",
);
const RADIX = new RegExp(`0(?:(x)([A-F_a-f\\d]+)|(o)([0-7_]+)|(b)([01_]+))(${SUFFIX})?\\b`, "y");
const ESCAPE = /\\(?:(x[0-7][A-Fa-f\d])|(u\{[A-Fa-f\d]{4,6}\})|[^\n])/y;
const INTERPOLATION_RE = /\{[^"{}\n]*\}/y;
const METAVARIABLE_SPEC =
  /([ \t]*)(:)([ \t]*)(block|expr(?:_2021)?|ident|item|lifetime|literal|meta|pat(?:_param)?|path|stmt|tt|ty|vis)\b/y;
const MACRO_RULES_RE = /macro_rules!([ \t]+)(?:([0-9_a-z]+)|([A-Z][0-9_a-z]*))([ \t]+)\{/y;

// Region modes and the meta scope each adds.
const TOP = 0;
const CALL = 1;
const SIGNATURE = 2;
const ARGUMENTS = 3;
const ATTRIBUTE = 4;
const USE = 5;
const EXTERN = 6;
const QUALIFIED = 7;
const META = [
  "",
  "meta.function.call.rust",
  "meta.function.definition.rust",
  "",
  "meta.attribute.rust",
  "meta.use.rust",
  "meta.import.rust",
  "",
];
const MAX_DEPTH = 64;

interface Frame {
  mode: number;
  kinds: Int32Array;
}
const framesByPrefix = new Map<string, Int32Array>();
function kindsFor(prefix: string) {
  let kinds = framesByPrefix.get(prefix);
  if (!kinds) {
    kinds = new Int32Array(LEAVES.length).fill(-1);
    framesByPrefix.set(prefix, kinds);
  }
  return kinds;
}

const isWordCode = (c: number) =>
  (c >= 48 && c <= 57) ||
  (c >= 65 && c <= 90) ||
  (c >= 97 && c <= 122) ||
  c === 95 ||
  (c >= 0x80 && /[\p{L}\p{N}\p{M}\p{Pc}]/u.test(String.fromCharCode(c)));
// The grammar's names are ASCII: [0-9A-Z_a-z].
const isNameCode = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isUpper = (c: number) => c >= 65 && c <= 90;
const isLower = (c: number) => c >= 97 && c <= 122;
const isDigit = (c: number) => c >= 48 && c <= 57;

export function scan(source: string): TokenizeResult {
  const out = createWriter(source.length, types);
  const length = source.length;
  const at = (i: number) => source.charCodeAt(i);
  const stack: Frame[] = [];
  const prefixes: string[] = [""];
  let frame: Frame = { mode: TOP, kinds: kindsFor("") };
  // The index after the last token that ended a region.
  let endedAt = -1;
  const emit = (leafId: number, start: number, end: number) => {
    let k = frame.kinds[leafId]!;
    if (k < 0) {
      const prefix = prefixes[prefixes.length - 1]!;
      const scope = LEAVES[leafId]!;
      if (!prefix && !scope) return;
      k = frame.kinds[leafId] = kind(prefix && scope ? `${prefix}|${scope}` : prefix || scope);
    }
    out.push(k, start, end);
  };
  const enter = (mode: number) => {
    stack.push(frame);
    const parent = prefixes[prefixes.length - 1]!;
    const meta = META[mode]!;
    // Past MAX_DEPTH, regions keep their parent's scopes.
    const prefix = !meta || stack.length > MAX_DEPTH ? parent : parent ? `${parent}|${meta}` : meta;
    prefixes.push(prefix);
    frame = { mode, kinds: kindsFor(prefix) };
  };
  const leave = () => {
    if (!stack.length) return;
    frame = stack.pop()!;
    prefixes.pop();
  };
  // The grammar's `(?=::<.*>\()` at `i`: a `>(` later on the line. Keep the
  // line's last `>(`, so many tests on one long line stay linear.
  let callLine = -1;
  let callLineEnd = -1;
  let lastCall = -1;
  const turbofish = (i: number) => {
    if (i < callLine || i >= callLineEnd) {
      callLine = source.lastIndexOf("\n", i) + 1;
      const end = source.indexOf("\n", i);
      callLineEnd = end < 0 ? length : end;
      lastCall = source.lastIndexOf(">(", callLineEnd - 2);
    }
    return lastCall >= i + 3;
  };
  const exec = (pattern: RegExp, i: number) => {
    pattern.lastIndex = i;
    return pattern.exec(source);
  };
  const nameEnd = (i: number) => {
    while (i < length && isNameCode(at(i))) i++;
    return i;
  };
  // `\b` before `i`: a word character on exactly one side.
  const boundary = (i: number) => isWordCode(at(i - 1)) !== isWordCode(at(i));

  const lineComment = (i: number) => {
    let end = source.indexOf("\n", i);
    if (end < 0) end = length;
    const doc = at(i + 2) === 47;
    emit(doc ? DOC_MARK : LINE_MARK, i, i + (doc ? 3 : 2));
    emit(doc ? DOC : LINE, i + (doc ? 3 : 2), end);
    return end;
  };
  // Block comments nest, and a nested comment adds its scope inside its
  // parent's, up to MAX_DEPTH. `/**/` is an empty block, `/**` documentation.
  const blockComment = (i: number) => {
    // The scope stack of each open comment, with the region prefix.
    const open: string[] = [];
    const nest = (scope: string) => {
      const parent = open.at(-1) ?? prefixes[prefixes.length - 1]!;
      open.push(!parent ? scope : open.length >= MAX_DEPTH ? parent : `${parent}|${scope}`);
    };
    let from = i;
    const flush = (to: number) => {
      if (to <= from) return;
      out.push(kind(open.at(-1)!), from, to);
      from = to;
    };
    let j = i;
    while (j < length) {
      if (at(j) === 47 && at(j + 1) === 42) {
        flush(j);
        if (source.startsWith("/**/", j)) {
          nest("comment.block.rust");
          flush(j + 4);
          open.pop();
          j += 4;
          if (!open.length) return j;
          continue;
        }
        nest(at(j + 2) === 42 ? "comment.block.documentation.rust" : "comment.block.rust");
        j += 2;
        continue;
      }
      if (at(j) === 42 && at(j + 1) === 47) {
        flush(j + 2);
        open.pop();
        j += 2;
        if (!open.length) return j;
        continue;
      }
      j++;
    }
    flush(length);
    return length;
  };
  const escape = (j: number, set: (typeof ESCAPES)[number]) => {
    const m = exec(ESCAPE, j);
    if (!m) return j;
    emit(set.backslash, j, j + 1);
    if (m[1]) emit(set.bit, j + 1, j + 1 + m[1].length);
    else if (m[2]) {
      emit(set.unicode, j + 1, j + 2);
      emit(set.brace, j + 2, j + 3);
      emit(set.unicode, j + 3, j + m[0].length - 1);
      emit(set.brace, j + m[0].length - 1, j + m[0].length);
    } else emit(set.escape, j + 1, j + 2);
    return j + m[0].length;
  };
  // A string from its opening quote at `q`; `prefix` is its `b`, `r`, or `br`.
  const string = (start: number, q: number) => {
    if (q > start) emit(BYTE_PREFIX, start, q);
    if (at(q) === 35 || (at(q - 1) === 114 && at(q) === 34)) return rawString(q);
    emit(STRING_MARK, q, q + 1);
    let j = q + 1;
    let from = j;
    while (j < length) {
      const c = at(j);
      if (c === 34) {
        emit(STRING, from, j);
        emit(STRING_MARK, j, j + 1);
        return j + 1;
      }
      if (c === 92) {
        const next = exec(ESCAPE, j) ? escape((emit(STRING, from, j), j), ESCAPES[0]!) : -1;
        // A backslash before a line break is not an escape; it stays text.
        if (next < 0) {
          j++;
          continue;
        }
        j = next;
        from = j;
        continue;
      }
      if (c === 123) {
        const m = exec(INTERPOLATION_RE, j);
        if (m) {
          emit(STRING, from, j);
          emit(INTERPOLATION_MARK, j, j + 1);
          emit(INTERPOLATION, j + 1, j + m[0].length - 1);
          emit(INTERPOLATION_MARK, j + m[0].length - 1, j + m[0].length);
          j += m[0].length;
          from = j;
          continue;
        }
      }
      j++;
    }
    emit(STRING, from, length);
    return length;
  };
  const rawString = (j: number) => {
    let hashes = j;
    while (at(hashes) === 35) hashes++;
    emit(RAW_HASHES, j, hashes);
    emit(STRING_MARK, hashes, hashes + 1);
    const close = `"${"#".repeat(hashes - j)}`;
    const end = source.indexOf(close, hashes + 1);
    const stop = end < 0 ? length : end;
    emit(STRING, hashes + 1, stop);
    if (end < 0) return length;
    emit(STRING_MARK, end, end + 1);
    emit(RAW_HASHES, end + 1, end + close.length);
    return end + close.length;
  };
  const char = (start: number, q: number) => {
    if (q > start) emit(CHAR_PREFIX, start, q);
    emit(CHAR_MARK, q, q + 1);
    let j = q + 1;
    let from = j;
    while (j < length) {
      const c = at(j);
      if (c === 39) {
        emit(CHAR, from, j);
        emit(CHAR_MARK, j, j + 1);
        return j + 1;
      }
      if (c === 92) {
        const next = exec(ESCAPE, j) ? escape((emit(CHAR, from, j), j), ESCAPES[1]!) : -1;
        // A backslash before a line break is not an escape; it stays text.
        if (next < 0) {
          j++;
          continue;
        }
        j = next;
        from = j;
        continue;
      }
      j++;
    }
    emit(CHAR, from, length);
    return length;
  };
  const number = (i: number) => {
    const radix = at(i) === 48 ? exec(RADIX, i) : null;
    if (radix) {
      const [body, suffix] = radix[1]
        ? [N.hex, N.hexSuffix]
        : radix[3]
          ? [N.oct, N.octSuffix]
          : [N.bin, N.binSuffix];
      const end = i + radix[0].length;
      const suffixStart = end - (radix[7]?.length ?? 0);
      emit(body, i, suffixStart);
      emit(suffix, suffixStart, end);
      return end;
    }
    const m = exec(DECIMAL, i);
    if (!m) return -1;
    const end = i + m[0].length;
    const suffixStart = end - (m[5]?.length ?? 0);
    let j = i;
    const dot = m[1] ? source.indexOf(".", i) : -1;
    const exponent = m[2] ? suffixStart - (m[4]!.length + m[3]!.length + 1) : -1;
    const bodyEnd = exponent >= 0 ? exponent : suffixStart;
    if (dot >= 0 && dot < bodyEnd) {
      emit(N.decimal, j, dot);
      emit(N.dot, dot, dot + 1);
      j = dot + 1;
    }
    emit(N.decimal, j, bodyEnd);
    if (exponent >= 0) {
      emit(N.exponent, exponent, exponent + 1);
      emit(N.sign, exponent + 1, exponent + 1 + m[3]!.length);
      emit(N.mantissa, exponent + 1 + m[3]!.length, suffixStart);
    }
    emit(N.suffix, suffixStart, end);
    return end;
  };

  // The name being matched: its start, end, text, and first character.
  let wi = 0;
  let we = 0;
  let wt = "";
  let wc = 0;
  const keyword = (): number => {
    const scope = boundary(wi) ? KEYWORDS[wt] : undefined;
    if (scope === undefined) return -1;
    emit(scope, wi, we);
    return we;
  };
  const lvariable = (): number => {
    if (!boundary(wi)) return -1;
    if (wt === "self" || wt === "Self") emit(SELF, wi, we);
    else if (wt === "super") emit(SUPER, wi, we);
    else return -1;
    return we;
  };
  const constant = (): number => {
    if (!boundary(wi)) return -1;
    if (isUpper(wc) && isUpper(at(wi + 1)) && /^[A-Z]{2}[0-9A-Z_]*$/.test(wt)) {
      emit(CAPS, wi, we);
      return we;
    }
    if (wt === "const") {
      let j = wi + 5;
      while (at(j) === 32 || at(j) === 9) j++;
      if (j > wi + 5 && isUpper(at(j))) {
        emit(STORAGE, wi, we);
        const end = nameEnd(j);
        emit(CAPS, j, end);
        return end;
      }
    }
    if (wt === "true" || wt === "false") {
      emit(BOOL, wi, we);
      return we;
    }
    return -1;
  };
  const gtype = (): number => {
    if (!boundary(wi)) return -1;
    if (wt === "Some" || wt === "None") emit(OPTION, wi, we);
    else if (wt === "Ok" || wt === "Err") emit(RESULT, wi, we);
    else return -1;
    return we;
  };
  const fn = (): number => {
    if (wt === "pub" && at(we) === 40 && boundary(wi)) {
      emit(KEYWORD, wi, we);
      emit(ROUND, we, we + 1);
      return we + 1;
    }
    if (wt === "fn" && boundary(wi)) {
      let j = we;
      while (at(j) === 32 || at(j) === 9) j++;
      const nameStart = j;
      if (source.startsWith("r#", j)) j += 2;
      const end = nameEnd(j);
      if (j > we && end > j && (at(end) === 40 || at(end) === 60) && stack.length < 2 * MAX_DEPTH) {
        enter(SIGNATURE);
        emit(FN, wi, we);
        emit(FUNCTION, nameStart, end);
        emit(at(end) === 40 ? ROUND : ANGLE, end, end + 1);
        return end + 1;
      }
    }
    // A call name can be a raw identifier, `r#name`.
    let end = we;
    if (
      wt === "r" &&
      at(we) === 35 &&
      !/^(?:crate|[Ss]elf|super)/.test(source.slice(we + 1, we + 6))
    )
      end = Math.max(we, nameEnd(we + 1));
    if (at(end) === 40 && stack.length < 2 * MAX_DEPTH) {
      enter(CALL);
      emit(FUNCTION, wi, end);
      emit(ROUND, end, end + 1);
      return end + 1;
    }
    if (at(end) === 58 && at(end + 1) === 58 && at(end + 2) === 60 && turbofish(end)) {
      enter(CALL);
      emit(FUNCTION, wi, end);
      return end;
    }
    return -1;
  };
  const type = (): number => {
    if (NUMERIC_TYPES.has(wt) && !(isUpper(at(wi - 1)) || isLower(at(wi - 1)))) {
      emit(NUMERIC_TYPE, wi, we);
      return we;
    }
    if (!boundary(wi)) return -1;
    const upper = isUpper(wc) || (wc === 95 && isUpper(at(wi + 1)));
    if (upper && at(we) === 60 && stack.length < 2 * MAX_DEPTH) {
      emit(TYPE, wi, we);
      enter(ARGUMENTS);
      emit(ANGLE, we, we + 1);
      return we + 1;
    }
    if (wt === "bool" || wt === "char" || wt === "str") {
      emit(PRIMITIVE, wi, we);
      return we;
    }
    const declaration = DECLARATIONS[wt];
    if (declaration !== undefined) {
      let j = we;
      while (at(j) === 32 || at(j) === 9) j++;
      const nameStart = j;
      if (at(j) === 95) j++;
      if (j > we && isUpper(at(j))) {
        const end = nameEnd(j);
        emit(KEYWORDS[wt]!, wi, we);
        emit(declaration, nameStart, end);
        return end;
      }
    }
    if (upper && at(we) !== 33) {
      emit(TYPE, wi, we);
      return we;
    }
    return -1;
  };
  const macro = (): number => {
    if (at(we) !== 33) return -1;
    if (isLower(wc) || wc === 95) emit(MACRO, wi, we + 1);
    else if (isUpper(wc)) emit(TYPE_MACRO, wi, we + 1);
    else return -1;
    return we + 1;
  };
  const namespace = (): number => {
    if (isNameCode(at(wi - 1)) || at(we) !== 58 || at(we + 1) !== 58) return -1;
    if (wt.endsWith("super") || wt.endsWith("self")) return -1;
    emit(NAMESPACE, wi, we);
    emit(NAMESPACE_OPERATOR, we, we + 2);
    return we + 2;
  };
  const stringPrefix = (): number => {
    if (
      (wt === "b" || wt === "r" || wt === "br") &&
      (at(we) === 34 || (wt !== "b" && at(we) === 35 && /^#*"/.test(source.slice(we, we + 260))))
    ) {
      return string(wi, we);
    }
    if (wt === "b" && at(we) === 39) return char(wi, we);
    return -1;
  };
  const variable = (): number => {
    if (!boundary(wi)) return -1;
    if (at(wi - 1) === 46 && at(wi - 2) !== 46) return -1;
    let j = wi;
    if (source.startsWith("r#", wi) && !/^r#(?:crate|[Ss]elf|super)/.test(source.slice(wi, wi + 8)))
      j += 2;
    const end = j === wi ? we : nameEnd(j);
    for (let k = j; k < end; k++) if (isUpper(at(k))) return -1;
    if (isWordCode(at(end))) return -1;
    emit(VARIABLE, wi, end);
    return end;
  };

  // Each region's word patterns, in the grammar's order for that region.
  const orders: (() => number)[][] = [];
  orders[TOP] = [
    lvariable,
    constant,
    gtype,
    fn,
    type,
    keyword,
    macro,
    namespace,
    stringPrefix,
    variable,
  ];
  orders[CALL] = orders[SIGNATURE] = [
    keyword,
    lvariable,
    constant,
    gtype,
    fn,
    macro,
    namespace,
    stringPrefix,
    type,
    variable,
  ];
  orders[ARGUMENTS] = [keyword, lvariable, type, variable];
  orders[ATTRIBUTE] = [keyword, stringPrefix, gtype, type];
  orders[USE] = [keyword, namespace, type, lvariable];
  orders[EXTERN] = [keyword];
  orders[QUALIFIED] = [gtype, lvariable, type];
  // A name at `i`. Returns the index after what it emitted, or -1 when no
  // word pattern of the region applies.
  const word = (i: number): number => {
    wi = i;
    we = nameEnd(i);
    if (we === i) return -1;
    wt = source.slice(i, we);
    wc = at(i);
    for (const pattern of orders[frame.mode]!) {
      const next = pattern();
      if (next >= 0) return next;
    }
    return -1;
  };

  // A name that no word pattern matched. Only the numeric type pattern can
  // start inside it, after a non-letter: `from_u32`.
  const unmatchedName = (i: number) => {
    const end = nameEnd(i);
    let tail = end;
    if (frame.mode !== EXTERN)
      for (let k = Math.max(i + 1, end - 5); k < end - 1; k++)
        if (!isUpper(at(k - 1)) && !isLower(at(k - 1)) && NUMERIC_TYPES.has(source.slice(k, end))) {
          tail = k;
          break;
        }
    emit(PLAIN, i, tail);
    emit(NUMERIC_TYPE, tail, end);
    return end;
  };

  // A spaced `<` or `>` is a comparison; elsewhere it is an angle bracket.
  const spacedComparison = (i: number): number => {
    if (at(i - 1) !== 32 && at(i - 1) !== 9) return -1;
    if (at(i + 1) !== 32 && at(i + 1) !== 9) return -1;
    let b = i - 1;
    while (at(b) === 32 || at(b) === 9) b--;
    const before = at(b);
    const closer = before === 41 || before === 93 || before === 125;
    if (!isWordCode(before) && !(closer && b + 1 !== endedAt)) return -1;
    let a = i + 1;
    while (at(a) === 32 || at(a) === 9) a++;
    const after = at(a);
    if (!isWordCode(after) && after !== 40 && after !== 91 && after !== 123) return -1;
    emit(COMPARISON, i, i + 1);
    if (after === 40 || after === 91 || after === 123)
      emit(after === 40 ? ROUND : after === 91 ? SQUARE : CURLY, a, a + 1);
    return after === 40 || after === 91 || after === 123 ? a + 1 : a;
  };

  let i = 0;
  while (i < length) {
    const c = at(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i++;
      continue;
    }
    const mode = frame.mode;
    if ((c === 60 || c === 62) && mode !== QUALIFIED) {
      const next = spacedComparison(i);
      if (next >= 0) {
        i = next;
        continue;
      }
    }
    // Region ends come before the region's patterns.
    if (
      (c === 41 && mode === CALL) ||
      ((c === 123 || c === 59) && mode === SIGNATURE) ||
      (c === 62 && (mode === ARGUMENTS || mode === QUALIFIED)) ||
      (c === 93 && mode === ATTRIBUTE) ||
      (c === 59 && (mode === USE || mode === EXTERN))
    ) {
      const scope =
        c === 41
          ? ROUND
          : c === 123
            ? CURLY
            : c === 59
              ? SEMI
              : c === 62
                ? ANGLE
                : ATTRIBUTE_BRACKET;
      emit(scope, i, i + 1);
      leave();
      endedAt = i + 1;
      i++;
      continue;
    }
    if (c === 47 && at(i + 1) === 42) {
      i = blockComment(i);
      continue;
    }
    if (c === 47 && at(i + 1) === 47) {
      i = lineComment(i);
      continue;
    }
    if (mode === TOP) {
      if (c === 60 && at(i + 1) === 91 && stack.length < 2 * MAX_DEPTH) {
        emit(ANGLE, i, i + 1);
        emit(SQUARE, i + 1, i + 2);
        enter(QUALIFIED);
        i += 2;
        continue;
      }
      if (c === 36) {
        const next = metavariable(i);
        if (next > i) {
          i = next;
          continue;
        }
      }
      if (c === 109 && source.startsWith("macro_rules!", i) && !isNameCode(at(i - 1))) {
        const m = exec(MACRO_RULES_RE, i);
        if (m) {
          emit(MACRO_RULES, i, i + 12);
          const nameStart = i + 12 + m[1]!.length;
          const name = m[2] ?? m[3]!;
          emit(m[2] ? MACRO_RULES_NAME : MACRO_RULES_TYPE, nameStart, nameStart + name.length);
          emit(MACRO_RULES_BRACE, i + m[0].length - 1, i + m[0].length);
          i += m[0].length;
          continue;
        }
      }
      if (c === 109 && source.startsWith("mod", i)) {
        const m = /^mod[ \t]+((?:r#(?!crate|[Ss]elf|super))?[a-z][0-9A-Z_a-z]*)/.exec(
          source.slice(i, i + 200),
        );
        if (m && !isNameCode(at(i - 1))) {
          emit(STORAGE, i, i + 3);
          const nameStart = i + m[0].length - m[1]!.length;
          emit(MODULE, nameStart, i + m[0].length);
          i += m[0].length;
          continue;
        }
      }
      if (c === 101 && source.startsWith("extern", i) && boundary(i)) {
        const m = /^extern([ \t]+)crate\b/.exec(source.slice(i, i + 40));
        if (m) {
          enter(EXTERN);
          emit(STORAGE, i, i + 6);
          emit(CRATE, i + 6 + m[1]!.length, i + m[0].length);
          i += m[0].length;
          continue;
        }
      }
      if (
        c === 117 &&
        source.startsWith("use", i) &&
        boundary(i) &&
        /\s/.test(source[i + 3] ?? "")
      ) {
        enter(USE);
        emit(KEYWORD, i, i + 3);
        i += 3;
        continue;
      }
    }
    if (c === 35 && (mode === TOP || mode === CALL)) {
      const bang = at(i + 1) === 33 ? 1 : 0;
      if (at(i + 1 + bang) === 91 && stack.length < 2 * MAX_DEPTH) {
        enter(ATTRIBUTE);
        emit(ATTRIBUTE_MARK, i, i + 1);
        if (bang) emit(PLAIN, i + 1, i + 2);
        emit(ATTRIBUTE_BRACKET, i + 1 + bang, i + 2 + bang);
        i += 2 + bang;
        continue;
      }
    }
    if (isNameCode(c) && !isDigit(c)) {
      const next = word(i);
      if (next > i) {
        i = next;
        continue;
      }
      i = unmatchedName(i);
      continue;
    }
    if (isDigit(c)) {
      const constants = mode === TOP || mode === CALL || mode === SIGNATURE;
      let next = constants && !isWordCode(at(i - 1)) ? number(i) : -1;
      // Not a number literal, such as `1f128`: the variable rule takes it.
      if (next < 0 && orders[mode]!.includes(variable)) {
        wi = i;
        we = nameEnd(i);
        next = variable();
      }
      if (next > i) {
        i = next;
        continue;
      }
      i = unmatchedName(i);
      continue;
    }
    if (c === 39) {
      const lifetimes = mode !== USE && mode !== EXTERN;
      const m = lifetimes
        ? /^'([A-Z_a-z][0-9A-Z_a-z]*)(?!')\b/.exec(source.slice(i, i + 256))
        : null;
      if (m) {
        emit(LIFETIME_MARK, i, i + 1);
        emit(LIFETIME, i + 1, i + m[0].length);
        i += m[0].length;
        continue;
      }
      if (mode === TOP || mode === CALL || mode === SIGNATURE || mode === ATTRIBUTE) {
        i = char(i, i);
        continue;
      }
    }
    if (c === 34 && (mode === TOP || mode === CALL || mode === SIGNATURE || mode === ATTRIBUTE)) {
      i = string(i, i);
      continue;
    }
    if (c === 38 && at(i + 1) === 39 && mode === QUALIFIED) {
      const m = /^&'([A-Z_a-z][0-9A-Z_a-z]*)(?!')\b/.exec(source.slice(i, i + 256));
      if (m) {
        emit(LIFETIME_BORROW, i, i + 1);
        emit(LIFETIME_MARK, i + 1, i + 2);
        emit(LIFETIME, i + 2, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    // Operators (keywords) come before punctuation, except in qualified paths.
    if (mode !== QUALIFIED && OPERATOR_START.has(c)) {
      let matched = -1;
      for (const [pattern, scope] of OPERATORS) {
        pattern.lastIndex = i;
        const m = pattern.exec(source);
        if (m && m[0].length) {
          emit(scope, i, i + m[0].length);
          matched = i + m[0].length;
          break;
        }
      }
      if (matched > i) {
        i = matched;
        continue;
      }
    }
    if (c === 44) emit(COMMA, i, i + 1);
    else if (c === 123 || c === 125) emit(CURLY, i, i + 1);
    else if (c === 40 || c === 41) emit(ROUND, i, i + 1);
    else if (c === 59) emit(SEMI, i, i + 1);
    else if (c === 91 || c === 93) emit(SQUARE, i, i + 1);
    else if ((c === 60 || c === 62) && at(i - 1) !== 61) emit(ANGLE, i, i + 1);
    else emit(PLAIN, i, i + 1);
    i++;
  }
  return out.result();

  // `$crate`, `$Type`, or `$name`, with an optional `:fragment`.
  function metavariable(i: number): number {
    const c = at(i + 1);
    const typeLike = isUpper(c) || source.startsWith("crate", i + 1);
    if (!typeLike && !isLower(c)) return i;
    const end = nameEnd(i + 1);
    emit(typeLike ? META_TYPE_DOLLAR : META_DOLLAR, i, i + 1);
    const crate = source.slice(i + 1, end) === "crate";
    emit(typeLike ? (crate ? META_CRATE : META_TYPE_NAME) : META_NAME, i + 1, end);
    const spec = exec(METAVARIABLE_SPEC, end);
    if (!spec) return end;
    const colon = end + spec[1]!.length;
    emit(typeLike ? META_TYPE_KEY_VALUE : META_KEY_VALUE, colon, colon + 1);
    const name = colon + 1 + spec[3]!.length;
    emit(typeLike ? META_TYPE_SPEC : META_SPEC, name, name + spec[4]!.length);
    void META_TYPE;
    void KEY_VALUE;
    return end + spec[0].length;
  }
}

export const tokenize = (_options?: { fidelity?: string }) => scan;
