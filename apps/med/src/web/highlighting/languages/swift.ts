import type { TokenizeResult } from "@twinkleplop/core";
import { createWriter, scopeTable } from "./token-writer";
import {
  blockFunctions,
  blockMethods,
  classNames,
  functions,
  methods,
  properties,
  typeNames,
} from "./swift-builtins";

// Swift after the Swift grammar that Shiki uses (swift-tmlanguage; see
// upstream/GRAMMARS.md). The grammar nests regions deeply: a type body
// holds functions, a function body holds calls, and a call holds labeled
// arguments, each with its own meta scope and its own patterns. Each region
// here is a loop that tries the region's end, then its patterns in the
// grammar's order, at each position of the line, as a TextMate engine does.
// Lines are read one at a time with a trailing "\n", so a pattern cannot look
// past its line, and positions and anchors are relative to the line.
const { types, kind } = scopeTable();

// ASCII classes: 1 digit, 2 identifier start (letter or "_").
const ASCII = new Uint8Array(128);
for (let c = 48; c < 58; c++) ASCII[c] = 1;
for (let c = 65; c < 91; c++) ASCII[c] = ASCII[c + 32] = 2;
ASCII[95] = 2;
const UNICODE_START = /[_\p{L}]/u;
const UNICODE_PART = /[_\p{L}\p{N}\p{M}]/u;
const UNICODE_WORD = /[\p{L}\p{M}\p{Nd}\p{Pc}]/u;
const UNICODE_SPACE = /\s/;
const char = (c: number) => String.fromCharCode(c);
const isIdStart = (c: number) =>
  c < 128 ? ASCII[c] === 2 : c > 127 && UNICODE_START.test(char(c));
const isIdPart = (c: number) => (c < 128 ? ASCII[c] > 0 : c > 127 && UNICODE_PART.test(char(c)));
const isWord = (c: number) => (c < 128 ? ASCII[c] > 0 : c > 127 && UNICODE_WORD.test(char(c)));
const isDigit = (c: number) => c >= 48 && c <= 57;
const isHex = (c: number) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isSpace = (c: number) =>
  c === 32 || (c >= 9 && c <= 13) || (c > 127 && UNICODE_SPACE.test(char(c)));

// Operator heads, and the combining marks that may follow them.
const OPERATOR_ASCII = new Uint8Array(128);
for (const c of "-!%&*+/<=>?^|~") OPERATOR_ASCII[c.charCodeAt(0)] = 1;
const OPERATOR_HEAD =
  /[\u00a1-\u00a7\u00a9\u00ab\u00ac\u00ae\u00b0\u00b1\u00b6\u00bb\u00bf\u00d7\u00f7\u2016\u2017\u2020-\u2027\u2030-\u203e\u2041-\u2053\u2055-\u205e\u2190-\u23ff\u2500-\u2775\u2794-\u2bff\u2e00-\u2e7f\u3001-\u3003\u3008-\u3030]/;
const OPERATOR_MARK = /[\u0300-\u036f\u1dc0-\u1dff\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f]/;
const isOperatorHead = (c: number) =>
  c < 128 ? OPERATOR_ASCII[c] === 1 : c > 127 && OPERATOR_HEAD.test(char(c));
const isOperatorChar = (c: number) => isOperatorHead(c) || (c > 127 && OPERATOR_MARK.test(char(c)));
// [-!%&*+./<=>^|~], which may not touch "->", "&", "==", or ":" in types.
const NEAR = new Uint8Array(128);
for (const c of "-!%&*+./<=>^|~") NEAR[c.charCodeAt(0)] = 1;
const nearOperator = (c: number) => c < 128 && NEAR[c] === 1;

// ---------------------------------------------------------------- scopes

// A frame is a stack of region scopes. Tokens take a frame and a leaf.
interface Frame {
  scope: string;
  base: number;
  leaves: number[];
  children: Map<string, Frame>;
}
const frame = (scope: string): Frame => ({
  scope,
  base: scope ? kind(scope) : -1,
  leaves: [],
  children: new Map(),
});
const ROOT = frame("");
function sub(parent: Frame, name: string): Frame {
  let child = parent.children.get(name);
  if (!child) {
    child = frame(parent.scope ? `${parent.scope}|${name}` : name);
    parent.children.set(name, child);
  }
  return child;
}
const LEAVES: string[] = [];
const leafIds = new Map<string, number>();
// A leaf from TextMate scopes; "a b" is scope a, then b inside it.
function exact(scopes: string): number {
  let id = leafIds.get(scopes);
  if (id === undefined) leafIds.set(scopes, (id = LEAVES.push(scopes) - 1));
  return id;
}
const sw = (scopes: string) => scopes.replace(/(\S+)/g, "$1.swift").replace(/ /g, "|");
const leaf = (scopes: string) => exact(sw(scopes));
// An identifier's leaf and the leaf of its backticks inside it.
type Name = readonly [number, number];
const named = (scopes: string): Name => [
  leaf(scopes),
  leaf(`${scopes} punctuation.definition.identifier`),
];

const SHEBANG = "comment.line.number-sign.swift";
const BLOCK_DOC = "comment.block.documentation.swift";
const BLOCK_PLAYGROUND = "comment.block.documentation.playground.swift";
const BLOCK_COMMENT = "comment.block.swift";
const LINE_DOC = "comment.line.triple-slash.documentation.swift";
const LINE_PLAYGROUND = "comment.line.double-slash.documentation.swift";
const LINE_COMMENT = "comment.line.double-slash.swift";
const COMMENT_BEGIN = leaf("punctuation.definition.comment.begin");
const COMMENT_END = leaf("punctuation.definition.comment.end");
const COMMENT_MARK = leaf("punctuation.definition.comment");
const LEADING_SPACE = leaf("punctuation.whitespace.comment.leading");
const STRAY_COMMENT_END = leaf("invalid.illegal.unexpected-end-of-block-comment");

const BOOLEAN = leaf("constant.language.boolean");
const NIL = leaf("constant.language.nil");
const OBJECT_LITERAL = leaf("support.function.object-literal");
const BUILTIN_MACRO = leaf("support.function.builtin-macro");
const KEY_PATH = leaf("support.function.key-path");
const SELECTOR = leaf("support.function.selector-reference");
const ARGUMENTS_BEGIN = leaf("punctuation.definition.arguments.begin");
const ARGUMENTS_END = leaf("punctuation.definition.arguments.end");
const PARAMETER_LABEL = leaf("support.variable.parameter");
const ARGUMENT_LABEL = leaf("punctuation.separator.argument-label");
const ARGUMENT_LABEL_BEGIN = leaf("punctuation.separator.argument-label.begin");
const NOT_ALLOWED = leaf("invalid.illegal.character-not-allowed-here");
const NUMERIC = leaf("constant.numeric");
const KEYWORD_OTHER = leaf("keyword.other");
const KEY_VALUE = leaf("punctuation.separator.key-value");
const PLATFORM = leaf("keyword.other.platform.os");
const ALL_PLATFORMS = leaf("keyword.other.platform.all");

const FLOAT = leaf("constant.numeric.float.decimal");
const LEADING_ZERO = leaf("invalid.illegal.numeric.float.missing-leading-zero");
const NUMBER_RULES: [RegExp, number, boolean][] = [
  // [pattern after the sign, leaf, blocked after "x." as in a tuple member]
  [
    /[0-9][0-9_]*(?=\.[0-9]|[Ee])(?:\.[0-9][0-9_]*)?(?:[Ee][-+]?[0-9][0-9_]*)?\b(?!\.[0-9])/y,
    FLOAT,
    true,
  ],
  [
    /0x[0-9A-Fa-f][_0-9A-Fa-f]*(?:\.[0-9A-Fa-f][_0-9A-Fa-f]*)?[Pp][-+]?[0-9][0-9_]*\b(?!\.[0-9])/y,
    leaf("constant.numeric.float.hexadecimal"),
    true,
  ],
  [
    /0x[0-9A-Fa-f][_0-9A-Fa-f]*(?:\.[0-9A-Fa-f][_0-9A-Fa-f]*)?[Pp][-+]?\w*\b(?!\.[0-9])/y,
    leaf("invalid.illegal.numeric.float.invalid-exponent"),
    true,
  ],
  [
    /0x[0-9A-Fa-f][_0-9A-Fa-f]*\.[0-9][.\w]*/y,
    leaf("invalid.illegal.numeric.float.missing-exponent"),
    true,
  ],
  [
    /0[box]_[_0-9A-Fa-f]*(?:[EPep][-+]?\w+)?[.\w]+/y,
    leaf("invalid.illegal.numeric.leading-underscore"),
    false,
  ],
  [/0b[01][01_]*\b(?!\.[0-9])/y, leaf("constant.numeric.integer.binary"), true],
  [/0o[0-7][0-7_]*\b(?!\.[0-9])/y, leaf("constant.numeric.integer.octal"), true],
  [/[0-9][0-9_]*\b(?!\.[0-9])/y, leaf("constant.numeric.integer.decimal"), true],
  [/0x[0-9A-Fa-f][_0-9A-Fa-f]*\b(?!\.[0-9])/y, leaf("constant.numeric.integer.hexadecimal"), true],
  [/[0-9][.\w]*/y, leaf("invalid.illegal.numeric.other"), false],
];

const LINE_STRING = "string.quoted.double.single-line.swift";
const RAW_LINE_STRING = "string.quoted.double.single-line.raw.swift";
const BLOCK_STRING = "string.quoted.double.block.swift";
const RAW_BLOCK_STRING = "string.quoted.double.block.raw.swift";
const STRING_BEGIN = leaf("punctuation.definition.string.begin");
const STRING_END = leaf("punctuation.definition.string.end");
const EXTRA_CLOSE = leaf(
  "punctuation.definition.string.end invalid.illegal.extra-closing-delimiter",
);
const RAW_BEGIN = leaf("punctuation.definition.string.begin.raw");
const RAW_END = leaf("punctuation.definition.string.end.raw");
const RAW_EXTRA_CLOSE = leaf(
  "punctuation.definition.string.end.raw invalid.illegal.extra-closing-delimiter",
);
const RETURN = leaf("invalid.illegal.returns-not-allowed");
const ESCAPE = leaf("constant.character.escape");
const UNICODE_ESCAPE = leaf("constant.character.escape.unicode");
const BAD_ESCAPE = exact("invalid.illegal.escape-not-recognized");
const NEWLINE_ESCAPE = leaf("constant.character.escape.newline");
const AFTER_OPENING = leaf("invalid.illegal.content-after-opening-delimiter");
const BEFORE_CLOSING = leaf("invalid.illegal.content-before-closing-delimiter");
const EMBEDDED = "meta.embedded.line.swift";
const EMBEDDED_SOURCE = "source.swift";
const EMBEDDED_BEGIN = leaf("punctuation.section.embedded.begin");
const EMBEDDED_END = leaf("punctuation.section.embedded.end");

const CAST = leaf("keyword.operator.type-casting");
const PREFIX = leaf("keyword.operator.custom.prefix");
const POSTFIX = leaf("keyword.operator.custom.postfix");
const INFIX = leaf("keyword.operator.custom.infix");
const PREFIX_DOT = leaf("keyword.operator.custom.prefix.dot");
const POSTFIX_DOT = leaf("keyword.operator.custom.postfix.dot");
const INFIX_DOT = leaf("keyword.operator.custom.infix.dot");
const TERNARY = leaf("keyword.operator.ternary");

const SUPPORT_FUNCTION = leaf("support.function");
const SUPPORT_VARIABLE = leaf("support.variable");
const DYNAMIC_TYPE = leaf("support.function.dynamic-type");
const COMPOUND: Name = [
  leaf("entity.name.function.compound-name"),
  leaf("entity.name.function.compound-name punctuation.definition.entity"),
];
const CALL = "meta.function-call.swift";
const ANY_METHOD = named("support.function.any-method");
const TRAILING = named("meta.function-call.trailing-closure-only support.function.any-method");
const TRAILING_LABEL = named("support.function.any-method.trailing-closure-label");
const MEMBER = named("variable.other");
const DISCARD = leaf("support.variable.discard-value");
const CLOSURE_PARAMETER = leaf("variable.language.closure-parameter");
const TUPLE_BEGIN = leaf("punctuation.section.tuple.begin");
const TUPLE_END = leaf("punctuation.section.tuple.end");
const RETHROWS = leaf("invalid.illegal.rethrows-only-allowed-on-function-declarations");
const SCOPE_BEGIN = leaf("punctuation.section.scope.begin");
const SCOPE_END = leaf("punctuation.section.scope.end");
const SUBSCRIPT = "meta.subscript-expression.swift";
const AVAILABILITY = leaf("support.function.availability-condition");

const BRANCH = leaf("keyword.control.branch");
const TRANSFER = leaf("keyword.control.transfer");
const LOOP = leaf("keyword.control.loop");
const INLINE_ARRAY = leaf("keyword.other.inline-array");
const EXISTENTIAL = leaf("keyword.other.operator.type.existential");
const OPAQUE = leaf("keyword.other.operator.type.opaque");
const REPEAT_SPACE = leaf("punctuation.whitespace.trailing.repeat");
const DEFER = leaf("keyword.control.defer");
const AWAIT = leaf("keyword.control.await");
const AWAIT_TRY = leaf("invalid.illegal.try-must-precede-await");
const EXCEPTION = leaf("keyword.control.exception");
const DO_SPACE = leaf("punctuation.whitespace.trailing.do");
const THROWS = leaf("storage.modifier.exception");
const ASYNC = leaf("storage.modifier.async");
const THROWS_ASYNC = leaf("invalid.illegal.await-must-precede-throws");
const GET_THROWS_ASYNC = leaf("invalid.illegal.async-must-precede-throws");
const DECLARATION = leaf("keyword.other.declaration-specifier");
const MODIFIER = leaf("storage.modifier");
const FUNCTION_STORAGE = leaf("storage.type.function");
const ACCESS = leaf("keyword.other.declaration-specifier.accessibility");
const CAPTURE = leaf("keyword.other.capture-specifier");
const TYPE_KEYWORD = leaf("keyword.other.type");
const METATYPE = leaf("keyword.other.type.metatype");
const LANGUAGE = leaf("variable.language");
const IMPORT = leaf("keyword.control.import");
const CONSUME = leaf("keyword.control.consume");
const COPY = leaf("keyword.control.copy");
const storageType = (word: string) => leaf(`storage.type.${word}`);

const ATTRIBUTE = leaf("storage.modifier.attribute");
const ATTRIBUTE_MARK = leaf("storage.modifier.attribute punctuation.definition.attribute");
const ATTRIBUTE_TICK = leaf("storage.modifier.attribute punctuation.definition.identifier");
const FUNCTION_NAME = named("entity.name.function");
const SELECTOR_PIECE = leaf("entity.name.function");
const MISSING_COLON = leaf(
  "entity.name.function invalid.illegal.missing-colon-after-selector-piece",
);

const FUNCTION = "meta.definition.function.swift";
const FUNCTION_BODY = "meta.definition.function.body.swift";
const FUNCTION_BEGIN = leaf("punctuation.section.function.begin");
const FUNCTION_END = leaf("punctuation.section.function.end");
const STORAGE_INVALID = leaf("storage.type.function invalid.illegal.character-not-allowed-here");
const PARAMETER_CLAUSE = "meta.parameter-clause.swift";
const PARAMETERS_BEGIN = leaf("punctuation.definition.parameters.begin");
const PARAMETERS_END = leaf("punctuation.definition.parameters.end");
const PARAMETER = named("variable.parameter.function");
const SINGLE_PARAMETER = named("variable.parameter.function entity.name.function");
const EXTRA_COLON = leaf("invalid.illegal.extra-colon-in-parameter-list");
const ASSIGNMENT = leaf("keyword.operator.assignment");
const RESULT = "meta.function-result.swift";
const RESULT_ARROW = leaf("keyword.operator.function-result");
const GENERIC_PARAMETERS = "meta.generic-parameter-clause.swift";
const GENERIC_PARAMETERS_BEGIN = leaf("punctuation.separator.generic-parameter-clause.begin");
const GENERIC_PARAMETERS_END = leaf("punctuation.separator.generic-parameter-clause.end");
const GENERIC_PARAMETER = leaf("variable.language.generic-parameter");
const GENERIC_COMMA = leaf("punctuation.separator.generic-parameters");
const CONSTRAINT = "meta.generic-parameter-constraint.swift";
const CONSTRAINT_COLON = leaf("punctuation.separator.generic-parameter-constraint");
const INHERITED = "entity.other.inherited-class.swift";
const TYPE_NAME = "meta.type-name.swift";
const WHERE = "meta.generic-where-clause.swift";
const WHERE_KEYWORD = leaf("keyword.other.generic-constraint-introducer");
const SAME_TYPE = "meta.generic-where-clause.same-type-requirement.swift";
const SAME_TYPE_OPERATOR = leaf("keyword.operator.generic-constraint.same-type");
const CONFORMANCE = "meta.generic-where-clause.conformance-requirement.swift";
const CONFORMANCE_OPERATOR = leaf("keyword.operator.generic-constraint.conforms-to");
const TYPE_ARROW = leaf("keyword.operator.type.function");
const COMPOSITION = leaf("keyword.operator.type.composition");
const SUPPRESSION = leaf("keyword.operator.type.requirement-suppression");
const OPTIONAL = leaf("keyword.operator.type.optional");
const VARIADIC = leaf("keyword.operator.function.variadic-parameter");
const COMPOSITION_KEYWORD = leaf("keyword.other.type.composition");
const TUPLE_TYPE_BEGIN = leaf("punctuation.section.tuple-type.begin");
const TUPLE_TYPE_END = leaf("punctuation.section.tuple-type.end");
const COLLECTION_BEGIN = leaf("punctuation.section.collection-type.begin");
const COLLECTION_END = leaf("punctuation.section.collection-type.end");
const INFERRED = leaf("support.variable.inferred");
const EXTRA_DICTIONARY_COLON = leaf("invalid.illegal.extra-colon-in-dictionary-type");
const GENERIC_ARGUMENTS = "meta.generic-argument-clause.swift";
const GENERIC_ARGUMENTS_BEGIN = leaf("punctuation.separator.generic-argument-clause.begin");
const GENERIC_ARGUMENTS_END = leaf("punctuation.separator.generic-argument-clause.end");
const TYPE_BODY = "meta.definition.type.body.swift";
const TYPE_BEGIN = leaf("punctuation.definition.type.begin");
const TYPE_END = leaf("punctuation.definition.type.end");
const INHERITANCE = "meta.inheritance-clause.swift";
const EMPTY_INHERITANCE = leaf("invalid.illegal.empty-inheritance-clause");
const INHERITANCE_SEPARATOR = leaf("punctuation.separator.inheritance-clause");
const MORE_TYPES = "meta.inheritance-list.more-types";
const CLASS_STORAGE = leaf("storage.type.class");
const CASE = leaf("storage.type.enum.case");
const ENUM_MEMBER = leaf("variable.other.enummember");
const MORE_CASES = "meta.enum-case.more-cases";
const DISTINCT_LABELS = leaf("invalid.illegal.distinct-labels-not-allowed");
const LABEL_NAME = named("entity.name.function");
const ASSOCIATED_LABEL = leaf("entity.name.function variable.parameter.function");
const ASSOCIATED_PARAMETER = leaf("variable.parameter.function");
const ENTITY_TYPE = named("entity.name.type");
const IMPORT_SEPARATOR = leaf("punctuation.separator.import");
const TERMINATOR = leaf("punctuation.terminator.statement");
const OPERATOR_STORAGE = leaf("storage.type.function.operator");
const OPERATOR_NAME = leaf("entity.name.function.operator");
const OPERATOR_DOT = leaf("entity.name.function.operator invalid.illegal.dot-not-allowed-here");
const INHERITED_LEAF = leaf("entity.other.inherited-class");
const INHERITED_PRECEDENCE = leaf("entity.other.inherited-class support.type");
const ASSOCIATIVITY = leaf("keyword.other.operator.associativity");
const SUPPORT_TYPE = leaf("support.type");
const PREPROCESSOR = "meta.preprocessor.conditional.swift";
const PREPROCESSOR_MARK = leaf("punctuation.definition.preprocessor");
const PREPROCESSOR_KEYWORD = leaf("keyword.control.import.preprocessor.conditional");
const LOGICAL = leaf("keyword.operator.logical");
const CONDITION = leaf("keyword.other.condition");
const ARCHITECTURE = leaf("support.constant.platform.architecture");
const PLATFORM_OS = leaf("support.constant.platform.os");
const ENVIRONMENT = leaf("support.constant.platform.environment");
const MODULE = leaf("entity.name.type.module");
const COMPARISON = leaf("keyword.operator.comparison");
const INTEGER = leaf("constant.numeric.integer");
const PARAMETER_SEPARATOR = leaf("punctuation.separator.parameters");
const SOURCE_LOCATION_KEYWORD = leaf("keyword.control.import.preprocessor.sourcelocation");
const OPERATOR_BEGIN = leaf("punctuation.definition.operator.begin");
const OPERATOR_END = leaf("punctuation.definition.operator.end");
const PRECEDENCE_BEGIN = leaf("punctuation.definition.precedencegroup.begin");
const PRECEDENCE_END = leaf("punctuation.definition.precedencegroup.end");
const DECLARED_NAMES: Record<string, Name> = {};
for (const w of "class struct actor enum protocol typealias precedencegroup".split(" "))
  DECLARED_NAMES[w] = named(`entity.name.type.${w}`);
const ASSOCIATED_TYPE_NAME = named("variable.language.associatedtype");

// Regular expression literal contents.
const rx = (scopes: string) => exact(scopes.replace(/(\S+)/g, "$1.regexp").replace(/ /g, "|"));
const RX_ESCAPE = rx("constant.character.escape.backslash");
const RX_NUMERIC = rx("constant.character.numeric");
const RX_SET = "constant.other.character-class.set.regexp";
const RX_PROPERTY = rx("constant.other.character-class.set support.variable.character-property");
const RX_PROPERTY_MARK = rx(
  "constant.other.character-class.set punctuation.definition.character-class",
);
const RX_ANCHOR = rx("keyword.control.anchor");
const RX_CLASS = rx("constant.character.character-class");
const RX_CONTROL = rx("constant.character.entity.control-character");
const RX_OR = rx("keyword.operator.or");
const RX_QUANTIFIER = rx("keyword.operator.quantifier");
const RX_BACK_REFERENCE = rx("keyword.other.back-reference");
const RX_GROUP_NAME = rx("variable.other.group-name");
const RX_CLASS_MARK = rx("punctuation.definition.character-class");
const RX_NEGATION = rx("keyword.operator.negation");
const RX_GROUP_MARK = rx("punctuation.definition.group");
const RX_OPTIONS = rx("keyword.other.group-options");
const RX_OPTIONS_MARK = rx("keyword.other.group-options punctuation.definition.group");
const RX_OPTIONS_NAME = rx("keyword.other.group-options variable.other.group-name");
const RX_ABSENT = rx("keyword.control.conditional.absent");
const RX_TOGGLE = rx("keyword.other.option-toggle");
const RX_COMMENT_BEGIN = rx("punctuation.definition.comment.begin");
const RX_COMMENT_END = rx("punctuation.definition.comment.end");
const RX_LINE_COMMENT = rx("comment.line");
const RX_LINE_COMMENT_MARK = rx("comment.line punctuation.definition.comment");
const RX_EMBEDDED_BEGIN = rx("punctuation.section.embedded.begin");
const RX_EMBEDDED_END = rx("punctuation.section.embedded.end");
const RX_RETURN = rx("invalid.illegal.returns-not-allowed");
const RX_GROUP_NUMBER = rx("constant.numeric.integer.decimal");
const RX_SET_OPERATORS: Record<string, number> = {
  "&&": exact("keyword.operator.intersection.regexp.swift"),
  "--": exact("keyword.operator.subtraction.regexp.swift"),
  "~~": exact("keyword.operator.symmetric-difference.regexp.swift"),
};

// Builtin names and the patterns that color them.
const BLOCK_METHOD = 1;
const METHOD = 2;
const BLOCK_FUNCTION = 4;
const GLOBAL_FUNCTION = 8;
const PROPERTY = 16;
interface Builtin {
  type: number;
  flags: number;
}
const BUILTINS = new Map<string, Builtin>();
function builtins(list: string, type: number, flag: number) {
  for (const word of list.split(" ")) {
    let entry = BUILTINS.get(word);
    if (!entry) BUILTINS.set(word, (entry = { type: -1, flags: 0 }));
    if (entry.type < 0) entry.type = type;
    entry.flags |= flag;
  }
}
builtins(classNames, leaf("support.class"), 0);
// "Process" is a constant only before a dot.
builtins("CommandLine Process", leaf("support.constant"), 0);
builtins("Never", leaf("support.constant.never"), 0);
builtins(typeNames, SUPPORT_TYPE, 0);
builtins("Any", leaf("support.type.any"), 0);
builtins(blockMethods, -1, BLOCK_METHOD);
builtins(methods, -1, METHOD);
builtins(blockFunctions, -1, BLOCK_FUNCTION);
builtins(functions, -1, GLOBAL_FUNCTION);
builtins(properties, -1, PROPERTY);
const HASH_VARIABLES = new Set(
  "file filePath fileID line column function dsohandle isolation".split(" "),
);
const CALLER_VARIABLES = new Set(
  "__FILE__ __LINE__ __COLUMN__ __FUNCTION__ __DSO_HANDLE__".split(" "),
);
const MODIFIERS = new Set(
  "inout static final lazy mutating nonmutating optional indirect required override dynamic convenience infix prefix postfix distributed borrowing consuming".split(
    " ",
  ),
);
const ACCESS_WORDS = new Set("fileprivate private internal public open package".split(" "));
const DECLARED_TYPES = new Set(
  "class enum extension precedencegroup protocol struct actor".split(" "),
);
const IMPORT_KINDS = new Set("typealias struct class actor enum protocol var func".split(" "));
const PLATFORMS = new Set("iOS macOS OSX watchOS tvOS visionOS UIKitForMac".split(" "));
const PRECEDENCE_GROUPS = new Set(
  "BitwiseShift Assignment RangeFormation Casting Addition NilCoalescing Comparison LogicalConjunction LogicalDisjunction Default Ternary Multiplication FunctionArrow".split(
    " ",
  ),
);

// ---------------------------------------------------------------- engine

type Rule = (f: Frame, i: number, g: boolean) => number;
const NEVER: Rule = () => -1;
const MAX_DEPTH = 300;

let source = "";
let length = 0;
let text = "\n";
let lineStart = 0;
let nextStart = 0;
// Lines read so far. Anchors and entry positions last only for their line.
let line = 0;
let done = false;
let capturing = 0;
let depth = 0;
let scanStart = 0;
let out = createWriter(0, types);
// The end of a word where no expression pattern matched, so the patterns
// that may start inside a word fail there as well.
let failedUntil = -1;
let failedMode = -1;
// The last run of "#" in this line text. Each "#" in a run has the same run
// end, so raw strings and extended regexes stay linear on long runs.
// Where the current pattern is tried. A region that opens there is zero-width.
let ruleAt = -1;
let hashLine = -1;
let hashLength = -1;
let hashFrom = -1;
let hashTo = -1;

function nextLine(): boolean {
  if (nextStart > length) return false;
  lineStart = nextStart;
  line++;
  let end = source.indexOf("\n", lineStart);
  if (end < 0) end = length;
  text = `${source.slice(lineStart, end)}\n`;
  nextStart = end + 1;
  return true;
}
function put(f: Frame, l: number, start: number, end: number) {
  if (end <= start) return;
  let k = f.leaves[l];
  if (k === undefined) k = f.leaves[l] = kind(f.scope ? `${f.scope}|${LEAVES[l]}` : LEAVES[l]!);
  out.push(k, lineStart + start, Math.min(lineStart + end, length));
}
function plain(f: Frame, start: number, end: number) {
  if (f.base >= 0 && end > start)
    out.push(f.base, lineStart + start, Math.min(lineStart + end, length));
}
// An identifier with its backticks, after an optional "#".
function name(f: Frame, n: Name, start: number, end: number) {
  if (text.charCodeAt(start) === 35) put(f, n[0], start, ++start);
  if (text.charCodeAt(start) === 96) {
    put(f, n[1], start, start + 1);
    put(f, n[0], start + 1, end - 1);
    put(f, n[1], end - 1, end);
  } else put(f, n[0], start, end);
}

// A region starts at `from`, the end of its begin match, and returns where
// its end match ends. `outer` holds the region's name, `inner` its content.
// `enter` is where its parent's scan started, on line `entered`.
function region(
  outer: Frame,
  inner: Frame,
  end: Rule,
  rules: Rule,
  from: number,
  enter: number,
  entered: number,
) {
  const eol = from === text.length;
  let anchor = from;
  let anchored = line;
  let start = from;
  let i = from;
  for (;;) {
    if (i > text.length) {
      if (capturing || !nextLine()) {
        done = true;
        return 0;
      }
      i = start = 0;
      anchor = eol ? 0 : -1;
      anchored = line;
    }
    const g = i === start && i === anchor && anchored === line;
    let r = end(outer, i, g);
    if (r >= 0) {
      if (r !== start || start !== enter || entered !== line) return r;
      // An empty region that ends where it began: vscode-textmate keeps it
      // and gives it the rest of the line.
      plain(outer, i, text.length);
      i = text.length + 1;
      continue;
    }
    scanStart = start;
    ruleAt = i;
    r = rules(inner, i, g);
    if (done) return 0;
    if (r >= 0) {
      i = start = r;
      continue;
    }
    if (i < text.length) plain(inner, i, i + 1);
    i++;
  }
}
function open(outer: Frame, inner: Frame, end: Rule, rules: Rule, from: number): number {
  // Past MAX_DEPTH, a region's content stays in its parent. A zero-width
  // region does not match there, so the parent still advances.
  if (depth >= MAX_DEPTH) return from > ruleAt ? from : -1;
  depth++;
  const at = ruleAt;
  const r = region(outer, inner, end, rules, from, scanStart, line);
  ruleAt = at;
  depth--;
  return r;
}
// Tokenize a capture, text[start, end), with rules, as vscode-textmate does:
// the line ends at the capture, and regions close there.
function capture(f: Frame, start: number, end: number, rules: Rule) {
  const saved = text;
  const scan = scanStart;
  const at = ruleAt;
  text = saved.slice(0, end);
  capturing++;
  depth++;
  region(f, f, NEVER, rules, start, -1, line);
  depth--;
  capturing--;
  done = false;
  text = saved;
  scanStart = scan;
  ruleAt = at;
}

function identRun(i: number): number {
  if (!isIdStart(text.charCodeAt(i))) return -1;
  let j = i + 1;
  while (isIdPart(text.charCodeAt(j))) j++;
  return j;
}
// An identifier, quoted with backticks or not.
function identEnd(i: number): number {
  if (text.charCodeAt(i) !== 96) return identRun(i);
  const j = identRun(i + 1);
  return j > 0 && text.charCodeAt(j) === 96 ? j + 1 : -1;
}
function wordRun(i: number): number {
  while (isWord(text.charCodeAt(i))) i++;
  return i;
}
// \s* and \s* without "\n".
function spaces(i: number): number {
  while (isSpace(text.charCodeAt(i))) i++;
  return i;
}
function blanks(i: number): number {
  let c;
  while ((c = text.charCodeAt(i)) !== 10 && isSpace(c)) i++;
  return i;
}
const eol = (i: number) => i >= text.length || text.charCodeAt(i) === 10;
const wordStart = (i: number) => !isWord(text.charCodeAt(i - 1));
// `word\b` at i.
const startsWord = (i: number, word: string) =>
  text.startsWith(word, i) && !isWord(text.charCodeAt(i + word.length));
// \bword\b at i.
const isWordAt = (i: number, word: string) => wordStart(i) && startsWord(i, word);
const commentStart = (i: number) =>
  text.charCodeAt(i) === 47 && (text.charCodeAt(i + 1) === 47 || text.charCodeAt(i + 1) === 42);
const isArrow = (i: number) =>
  text.charCodeAt(i) === 45 &&
  text.charCodeAt(i + 1) === 62 &&
  !nearOperator(text.charCodeAt(i - 1)) &&
  !nearOperator(text.charCodeAt(i + 2));
const loneOperator = (i: number, c: number) =>
  text.charCodeAt(i) === c &&
  !nearOperator(text.charCodeAt(i - 1)) &&
  !nearOperator(text.charCodeAt(i + 1));
// The identifier after \s* starts with a letter or a backtick: (?=\s*`?[_\p{L}]).
const identifierAfter = (i: number) => {
  const j = blanks(i);
  return isIdStart(text.charCodeAt(text.charCodeAt(j) === 96 ? j + 1 : j));
};
const callAfter = (i: number) => text.charCodeAt(blanks(i)) === 40;
const callOrBlockAfter = (i: number) => {
  const c = text.charCodeAt(blanks(i));
  return c === 40 || c === 123;
};

// Simple ends.
const END_NOT_ANCHOR: Rule = (_f, i, g) => (g ? -1 : i);
const END_AFTER_BRACE: Rule = (_f, i) => (text.charCodeAt(i - 1) === 125 ? i : -1);
const END_BEFORE_BRACE: Rule = (_f, i) => (text.charCodeAt(i) === 123 ? i : -1);
const END_BEFORE_BRACE_OR_EOL: Rule = (_f, i) => (text.charCodeAt(i) === 123 || eol(i) ? i : -1);
const END_FUNCTION: Rule = (_f, i) => (text.charCodeAt(i - 1) === 125 || eol(i) ? i : -1);
const END_PROTOCOL_FUNCTION: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return eol(i) || c === 59 || c === 125 || commentStart(i) ? i : -1;
};
const END_ELEMENT: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return c === 93 || c === 41 || c === 44 ? i : -1;
};
const closing =
  (c: number, l: number): Rule =>
  (f, i) => {
    if (text.charCodeAt(i) !== c) return -1;
    put(f, l, i, i + 1);
    return i + 1;
  };
const END_ARGUMENTS = closing(41, ARGUMENTS_END);
const END_SUBSCRIPT = closing(93, ARGUMENTS_END);
const END_SCOPE = closing(125, SCOPE_END);
const END_FUNCTION_BODY = closing(125, FUNCTION_END);
const END_TYPE_BODY = closing(125, TYPE_END);
const END_EMBEDDED = closing(41, EMBEDDED_END);
const END_ASSOCIATED_VALUES = closing(41, PARAMETERS_END);
const END_OPERATOR_BODY = closing(125, OPERATOR_END);
const END_PRECEDENCE_BODY = closing(125, PRECEDENCE_END);
const END_PROTOCOL_BODY = closing(125, FUNCTION_END);
const END_RX_GROUP = closing(41, RX_GROUP_MARK);
const END_RX_COMMENT = closing(41, RX_COMMENT_END);
const END_RX_CLASS = closing(93, RX_CLASS_MARK);

// ---------------------------------------------------------------- rules

const EXPRESSION = 0;
const CONDITION_MODE = 1;
const ROOT_RULES: Rule = (f, i) => root(f, i);
const EXPRESSION_RULES: Rule = (f, i) => expression(f, i, EXPRESSION);
const CONDITION_RULES: Rule = (f, i) => expression(f, i, CONDITION_MODE);

// $self: compiler control, declarations, then expressions.
function root(f: Frame, i: number): number {
  if (i === 0) {
    const r = compilerControl(f);
    if (r >= 0) return r;
  }
  const c = text.charCodeAt(i);
  if (c >= 97 && c <= 122 && !isIdPart(text.charCodeAt(i - 1))) {
    const e = identRun(i);
    const w = text.slice(i, e);
    const r = declaration(f, i, e, w);
    if (r >= 0) return r;
    return wordAt(f, i, e, w, EXPRESSION);
  }
  return expression(f, i, EXPRESSION);
}

// #expressions; in a condition, without trailing closures and member names.
function expression(f: Frame, i: number, mode: number): number {
  const c = text.charCodeAt(i);
  if (c < 128) {
    if (ASCII[c] === 2 || c === 96) return word(f, i, mode);
    switch (c) {
      case 47: {
        const r = comment(f, i);
        if (r >= 0) return r;
        const s = regexLine(f, i);
        return s >= 0 ? s : operator(f, i);
      }
      case 42:
        return text.charCodeAt(i + 1) === 47 ? comment(f, i) : operator(f, i);
      case 35:
        return hash(f, i);
      case 34:
        return string(f, i);
      case 123:
        put(f, SCOPE_BEGIN, i, i + 1);
        return open(f, f, END_SCOPE, ROOT_RULES, i + 1);
      case 64:
        return attribute(f, i);
      case 36: {
        let j = i + 1;
        while (isDigit(text.charCodeAt(j))) j++;
        if (j === i + 1) return -1;
        put(f, CLOSURE_PARAMETER, i, j);
        return j;
      }
      case 45: {
        const r = number(f, i);
        return r >= 0 ? r : operator(f, i);
      }
      case 46: {
        const r = number(f, i);
        if (r >= 0) return r;
        const d = text.charCodeAt(i + 1);
        return d === 46 || isOperatorChar(d) ? operator(f, i) : -1;
      }
      case 40:
        if (isCallOwner(text.charCodeAt(i - 1))) return call(f, i, i);
        put(f, TUPLE_BEGIN, i, i + 1);
        return open(f, f, END_TUPLE, ELEMENT_RULES, i + 1);
      case 91:
        return isSubscriptOwner(text.charCodeAt(i - 1)) ? subscript(f, i, i) : -1;
      case 58:
        put(f, TERNARY, i, i + 1);
        return i + 1;
    }
    if (ASCII[c] === 1) return number(f, i);
    if (OPERATOR_ASCII[c] === 1) return operator(f, i);
    return isSpace(c) ? space(f, i) : -1;
  }
  if (isIdStart(c)) return word(f, i, mode);
  if (isOperatorHead(c)) return operator(f, i);
  return isSpace(c) ? space(f, i) : -1;
}

// (?<=[])>_`}\p{L}\p{N}\p{M}]) before a call's "(", and (?<=[_`\p{L}\p{N}\p{M}])
// before a subscript's "[".
const isSubscriptOwner = (c: number) => c === 96 || isIdPart(c);
const isCallOwner = (c: number) =>
  c === 93 || c === 41 || c === 62 || c === 125 || isSubscriptOwner(c);

// Blank space before a call's "(" or a subscript's "[".
function space(f: Frame, i: number): number {
  if (i === 0) {
    const r = comment(f, i);
    if (r >= 0) return r;
  }
  const p = text.charCodeAt(i - 1);
  const owner = isCallOwner(p);
  if (!owner) return -1;
  const j = spaces(i);
  const d = text.charCodeAt(j);
  if (d === 40) return call(f, i, j);
  return d === 91 && isSubscriptOwner(p) ? subscript(f, i, j) : -1;
}
function call(f: Frame, i: number, j: number): number {
  const C = sub(f, CALL);
  plain(C, i, j);
  put(C, ARGUMENTS_BEGIN, j, j + 1);
  return open(C, C, END_ARGUMENTS, ELEMENT_RULES, j + 1);
}
function subscript(f: Frame, i: number, j: number): number {
  const S = sub(f, SUBSCRIPT);
  plain(S, i, j);
  put(S, ARGUMENTS_BEGIN, j, j + 1);
  return open(S, S, END_SUBSCRIPT, ELEMENT_RULES, j + 1);
}
// (\))\s*((?:\b(?:async|throws|rethrows)\s)*)
const END_TUPLE: Rule = (f, i) => {
  if (text.charCodeAt(i) !== 41) return -1;
  put(f, TUPLE_END, i, i + 1);
  const j = spaces(i + 1);
  plain(f, i + 1, j);
  let k = j;
  for (;;) {
    const e = identRun(k);
    const w = e > 0 ? text.slice(k, e) : "";
    if ((w !== "async" && w !== "throws" && w !== "rethrows") || !isSpace(text.charCodeAt(e)))
      break;
    k = e + 1;
  }
  // The capture, colored by \brethrows\b and #async-throws.
  for (let m = j; m < k;) {
    const e = identRun(m);
    const w = text.slice(m, e);
    let end = e;
    if (w === "rethrows") put(f, RETHROWS, m, e);
    else if (w === "async") put(f, ASYNC, m, e);
    else {
      const s = spaces(e);
      if (s < k && startsWord(s, "async") && s + 5 < k) {
        end = s + 5;
        put(f, THROWS_ASYNC, m, end);
      } else put(f, THROWS, m, e);
    }
    const next = spaces(end);
    plain(f, end, Math.min(next, k));
    m = next;
  }
  return k;
};

// The argument list of a call, subscript, or parenthesized expression.
const ELEMENT_RULES: Rule = (f, i) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  const c = text.charCodeAt(i);
  if (c === 96 || isIdStart(c)) {
    const e = identEnd(i);
    if (e >= 0) {
      const j = spaces(e);
      if (text.charCodeAt(j) === 58) {
        name(f, ANY_METHOD, i, e);
        plain(f, e, j);
        put(f, ARGUMENT_LABEL, j, j + 1);
        return open(f, f, END_ELEMENT, EXPRESSION_RULES, j + 1);
      }
    }
  }
  if (c !== c || c === 93 || c === 41 || c === 44 || isSpace(c)) return -1;
  return open(f, f, END_ELEMENT, EXPRESSION_RULES, i);
};

function word(f: Frame, i: number, mode: number): number {
  const c = text.charCodeAt(i);
  const prev = text.charCodeAt(i - 1);
  if (c === 96 || isIdPart(prev)) {
    // Only the patterns without \b start here.
    if (c !== 96 && lineStart + i < failedUntil && mode === failedMode) return -1;
    const r = compound(f, i);
    return r >= 0 ? r : identifier(f, i, mode, prev === 46);
  }
  const e = identRun(i);
  return wordAt(f, i, e, text.slice(i, e), mode);
}

// The expression patterns for the word text[i, e) in the grammar's order.
function wordAt(f: Frame, i: number, e: number, w: string, mode: number): number {
  const prev = text.charCodeAt(i - 1);
  const dot = prev === 46;
  switch (w) {
    case "true":
    case "false":
      put(f, BOOLEAN, i, e);
      return e;
    case "nil":
      put(f, NIL, i, e);
      return e;
    case "is":
      put(f, CAST, i, e);
      return e;
    case "as": {
      const n = text.charCodeAt(e);
      const k = (n === 33 || n === 63) && !isWord(text.charCodeAt(e + 1)) ? e + 1 : e;
      put(f, CAST, i, k);
      return k;
    }
  }
  const b = BUILTINS.get(w);
  if (b) {
    if (b.type >= 0 && (w !== "Process" || text.charCodeAt(e) === 46)) {
      put(f, b.type, i, e);
      return e;
    }
    if (
      dot &&
      (((b.flags & BLOCK_METHOD) !== 0 && callOrBlockAfter(e)) ||
        ((b.flags & METHOD) !== 0 && callAfter(e)))
    ) {
      put(f, SUPPORT_FUNCTION, i, e);
      return e;
    }
  }
  if (w === "type" && text.charCodeAt(e) === 40) {
    const r = typeOf(f, i, e);
    if (r >= 0) return r;
  }
  if (b) {
    if (
      ((b.flags & BLOCK_FUNCTION) !== 0 && callOrBlockAfter(e)) ||
      ((b.flags & GLOBAL_FUNCTION) !== 0 && callAfter(e))
    ) {
      put(f, SUPPORT_FUNCTION, i, e);
      return e;
    }
  }
  if (dot) {
    const p = processArgument(i);
    if (p >= 0) {
      put(f, SUPPORT_VARIABLE, i, p);
      return p;
    }
    if (b && (b.flags & PROPERTY) !== 0) {
      put(f, SUPPORT_VARIABLE, i, e);
      return e;
    }
  }
  let r = compound(f, i);
  if (r >= 0) return r;
  if (!dot && (w === "if" || w === "guard" || w === "switch" || w === "for" || w === "while")) {
    put(f, w === "for" || w === "while" ? LOOP : BRANCH, i, e);
    return open(
      f,
      f,
      w === "while" ? END_BEFORE_BRACE_OR_EOL : END_BEFORE_BRACE,
      CONDITION_RULES,
      e,
    );
  }
  r = keyword(f, i, e, w, dot);
  if (r >= 0) return r;
  r = identifier(f, i, mode, dot);
  if (r < 0) {
    failedUntil = lineStart + e;
    failedMode = mode;
  }
  return r;
}

// (?<=(?:^|\W)(?:Process\.|CommandLine\.))(arguments|argc|unsafeArgv)
function processArgument(i: number): number {
  const owner = text.endsWith("Process.", i) ? 8 : text.endsWith("CommandLine.", i) ? 12 : 0;
  if (!owner || isWord(text.charCodeAt(i - owner - 1))) return -1;
  for (const w of ["arguments", "argc", "unsafeArgv"])
    if (text.startsWith(w, i)) return i + w.length;
  return -1;
}

// \b(type)(\()\s*(of)(:)
function typeOf(f: Frame, i: number, e: number): number {
  const j = spaces(e + 1);
  if (!text.startsWith("of:", j)) return -1;
  put(f, DYNAMIC_TYPE, i, e);
  put(f, ARGUMENTS_BEGIN, e, e + 1);
  plain(f, e + 1, j);
  put(f, PARAMETER_LABEL, j, j + 2);
  put(f, ARGUMENT_LABEL_BEGIN, j + 2, j + 3);
  return open(f, f, END_ARGUMENTS, EXPRESSION_RULES, j + 3);
}

// name(label:label:), a function named with its argument labels.
function compound(f: Frame, i: number): number {
  const e = identEnd(i);
  if (e < 0 || text.charCodeAt(e) !== 40) return -1;
  let j = e + 1;
  for (;;) {
    const k = identEnd(j);
    if (k < 0 || text.charCodeAt(k) !== 58) break;
    j = k + 1;
  }
  if (j === e + 1 || text.charCodeAt(j) !== 41) return -1;
  name(f, COMPOUND, i, e);
  plain(f, e, e + 1);
  for (let k = e + 1; k < j;) {
    const m = identEnd(k);
    if (m === k + 1 && text.charCodeAt(k) === 95) plain(f, k, m + 1);
    else {
      name(f, COMPOUND, k, m);
      put(f, COMPOUND[0], m, m + 1);
    }
    k = m + 1;
  }
  plain(f, j, j + 1);
  return j + 1;
}

// A call, "_", a trailing closure, or a member name.
function identifier(f: Frame, i: number, mode: number, dot: boolean): number {
  const e = identEnd(i);
  if (e < 0) return -1;
  const j = spaces(e);
  const d = text.charCodeAt(j);
  if (d === 40) return functionCall(f, i, e, j);
  if (e === i + 1 && text.charCodeAt(i) === 95 && wordStart(i) && !isWord(text.charCodeAt(e))) {
    put(f, DISCARD, i, e);
    return e;
  }
  if (mode !== EXPRESSION) return -1;
  if (d === 123) {
    name(f, TRAILING, i, e);
    return e;
  }
  if (d === 58 && text.charCodeAt(spaces(j + 1)) === 123) {
    name(f, TRAILING_LABEL, i, e);
    plain(f, e, j);
    put(f, ARGUMENT_LABEL, j, j + 1);
    return j + 1;
  }
  if (dot) {
    name(f, MEMBER, i, e);
    return e;
  }
  return -1;
}
function functionCall(f: Frame, i: number, e: number, j: number): number {
  const C = sub(f, CALL);
  name(C, ANY_METHOD, i, e);
  plain(C, e, j);
  put(C, ARGUMENTS_BEGIN, j, j + 1);
  return open(C, C, END_ARGUMENTS, ELEMENT_RULES, j + 1);
}

// #keywords, for the word text[i, e).
function keyword(f: Frame, i: number, e: number, w: string, dot: boolean): number {
  let l = -1;
  let end = e;
  switch (w) {
    case "if":
    case "else":
    case "guard":
    case "where":
    case "switch":
    case "case":
    case "default":
    case "fallthrough":
      if (!dot) l = BRANCH;
      break;
    case "continue":
    case "break":
    case "return":
    case "yield":
      if (!dot) l = TRANSFER;
      break;
    case "while":
    case "for":
    case "in":
    case "each":
      if (!dot) l = LOOP;
      break;
    case "of": {
      const j = spaces(e);
      const d = text.charCodeAt(j);
      if (isSpace(text.charCodeAt(i - 1)) && j > e && (d === 40 || d === 91 || isIdPart(d)))
        l = INLINE_ARRAY;
      break;
    }
    case "any":
      if (identifierAfter(e)) l = EXISTENTIAL;
      break;
    case "repeat":
    case "do":
      if (dot) break;
      put(f, w === "do" ? EXCEPTION : LOOP, i, e);
      end = spaces(e);
      put(f, w === "do" ? DO_SPACE : REPEAT_SPACE, e, end);
      return end;
    case "defer":
      if (!dot) l = DEFER;
      break;
    case "await": {
      if (dot) break;
      const j = spaces(e);
      if (j > e && startsWord(j, "try")) {
        l = AWAIT_TRY;
        end = j + 3;
      } else l = AWAIT;
      break;
    }
    case "catch":
    case "throw":
      if (!dot) l = EXCEPTION;
      break;
    case "try":
      if (!dot) l = EXCEPTION;
      else {
        const n = text.charCodeAt(e);
        if ((n === 33 || n === 63) && !isWord(text.charCodeAt(e + 1))) {
          l = EXCEPTION;
          end = e + 1;
        }
      }
      break;
    case "throws":
    case "rethrows":
      if (!dot) l = THROWS;
      break;
    case "async": {
      if (dot) break;
      const j = spaces(e);
      const k = identRun(j);
      const v = j > e && k > 0 ? text.slice(j, k) : "";
      if (v !== "let" && v !== "var") break;
      put(f, ASYNC, i, e);
      plain(f, e, j);
      put(f, DECLARATION, j, k);
      return k;
    }
    case "let":
    case "var":
    case "associatedtype":
    case "operator":
    case "typealias":
      if (!dot) l = DECLARATION;
      break;
    case "nonisolated":
      if (dot) break;
      l = MODIFIER;
      if (text.startsWith("(nonsending)", e)) end = e + 12;
      break;
    case "init": {
      l = FUNCTION_STORAGE;
      const n = text.charCodeAt(e);
      if (n === 33 || n === 63) end = e + 1;
      break;
    }
    case "func":
    case "deinit":
    case "subscript":
    case "didSet":
    case "set":
    case "willSet":
      if (!dot) l = FUNCTION_STORAGE;
      break;
    case "yielding": {
      if (dot) break;
      const j = spaces(e);
      if (j > e && (startsWord(j, "borrow") || startsWord(j, "mutate"))) {
        l = FUNCTION_STORAGE;
        end = j + 6;
      }
      break;
    }
    case "get":
      return getter(f, i, e);
    case "unowned":
      if (dot) break;
      l = CAPTURE;
      if (text.startsWith("(safe)", e)) end = e + 6;
      else if (text.startsWith("(unsafe)", e)) end = e + 8;
      break;
    case "weak":
      if (!dot) l = CAPTURE;
      break;
    case "dynamicType":
      if (dot) l = TYPE_KEYWORD;
      break;
    case "self":
      l = dot ? TYPE_KEYWORD : LANGUAGE;
      break;
    case "Protocol":
    case "Type":
      if (dot) l = METATYPE;
      break;
    case "super":
    case "Self":
      if (!dot) l = LANGUAGE;
      break;
    case "import":
      if (!dot) l = IMPORT;
      break;
    case "consume":
    case "copy": {
      const j = spaces(e);
      if (!dot && j > e && isIdStart(text.charCodeAt(text.charCodeAt(j) === 96 ? j + 1 : j)))
        l = w === "copy" ? COPY : CONSUME;
      break;
    }
    default:
      if (!dot && MODIFIERS.has(w)) l = MODIFIER;
      else if (!dot && ACCESS_WORDS.has(w)) l = ACCESS;
      else if (!dot && DECLARED_TYPES.has(w) && identifierAfter(e)) l = storageType(w);
      else if (CALLER_VARIABLES.has(w)) l = SUPPORT_VARIABLE;
  }
  if (l < 0) return -1;
  put(f, l, i, end);
  return end;
}

// \b(get)(?:\s+(throws\s+async)|\s+(async)(?:\s+(throws))?)?\b
function getter(f: Frame, i: number, e: number): number {
  put(f, FUNCTION_STORAGE, i, e);
  const j = spaces(e);
  if (j === e) return e;
  if (startsWord(j, "throws")) {
    const k = spaces(j + 6);
    if (k > j + 6 && startsWord(k, "async")) {
      plain(f, e, j);
      put(f, GET_THROWS_ASYNC, j, k + 5);
      return k + 5;
    }
  } else if (startsWord(j, "async")) {
    plain(f, e, j);
    put(f, ASYNC, j, j + 5);
    const k = spaces(j + 5);
    if (k > j + 5 && startsWord(k, "throws")) {
      plain(f, j + 5, k);
      put(f, THROWS, k, k + 6);
      return k + 6;
    }
    return j + 5;
  }
  return e;
}

// "#": literals, compiler variables, availability, and macros.
function hash(f: Frame, i: number): number {
  if (i === 0 && lineStart === 0 && text.charCodeAt(1) === 33) return comment(f, i);
  const r = hashLiteral(f, i);
  if (r >= 0) return r;
  const k = identRun(i + 1);
  const w = k > 0 ? text.slice(i + 1, k) : "";
  if (wordStart(i)) {
    if (HASH_VARIABLES.has(w)) {
      put(f, SUPPORT_VARIABLE, i, k);
      return k;
    }
    if ((w === "available" || w === "unavailable") && text.charCodeAt(k) === 40) {
      put(f, AVAILABILITY, i, k);
      put(f, ARGUMENTS_BEGIN, k, k + 1);
      return open(f, f, END_ARGUMENTS, AVAILABILITY_RULES, k + 1);
    }
  }
  const e = identEnd(i + 1);
  if (e < 0) return -1;
  const j = spaces(e);
  if (text.charCodeAt(j) === 40) return functionCall(f, i, e, j);
  name(f, ANY_METHOD, i, e);
  return e;
}
// The #literals that start with "#".
function hashLiteral(f: Frame, i: number): number {
  const r = rawString(f, i);
  if (r >= 0) return r;
  if (wordStart(i)) {
    const k = identRun(i + 1);
    switch (k > 0 ? text.slice(i + 1, k) : "") {
      case "colorLiteral":
      case "imageLiteral":
      case "fileLiteral":
        put(f, OBJECT_LITERAL, i, k);
        return k;
      case "externalMacro":
        put(f, BUILTIN_MACRO, i, k);
        return k;
      case "keyPath":
        put(f, KEY_PATH, i, k);
        return k;
      case "selector":
        if (text.charCodeAt(k) === 40) return selector(f, i, k);
    }
  }
  return hashRegex(f, i);
}
// \B(#selector)(\()(?:\s*([gs]etter)\s*(:))?
function selector(f: Frame, i: number, k: number): number {
  put(f, SELECTOR, i, k);
  put(f, ARGUMENTS_BEGIN, k, k + 1);
  let from = k + 1;
  const j = spaces(k + 1);
  if (text.startsWith("getter", j) || text.startsWith("setter", j)) {
    const m = spaces(j + 6);
    if (text.charCodeAt(m) === 58) {
      plain(f, k + 1, j);
      put(f, PARAMETER_LABEL, j, j + 6);
      plain(f, j + 6, m);
      put(f, ARGUMENT_LABEL, m, m + 1);
      from = m + 1;
    }
  }
  return open(f, f, END_ARGUMENTS, EXPRESSION_RULES, from);
}
// Inside #available( and #unavailable(.
const AVAILABILITY_RULES: Rule = (f, i) => {
  const s = blanks(i);
  const e = identRun(s);
  if (e > 0 && wordStart(s)) {
    let w = text.slice(s, e);
    if (w.endsWith("ApplicationExtension")) w = w.slice(0, -20);
    if (PLATFORMS.has(w)) {
      const j = spaces(e);
      const n = version(j);
      if (j > e && n > j) {
        plain(f, i, s);
        put(f, PLATFORM, s, e);
        plain(f, e, j);
        put(f, NUMERIC, j, n);
        return n;
      }
    }
  }
  const c = text.charCodeAt(i);
  if (c === 42) {
    // (\*)\s*(.*?)(?=[),])
    const j = spaces(i + 1);
    const k = lazyUntilCloser(j);
    if (k < 0) return -1;
    put(f, ALL_PLATFORMS, i, i + 1);
    plain(f, i + 1, j);
    put(f, NOT_ALLOWED, j, k);
    return k;
  }
  if (c === 41 || c === 44 || isSpace(c) || c !== c) return -1;
  let j = i + 1;
  for (let d = text.charCodeAt(j); d === d && d !== 41 && d !== 44 && !isSpace(d);)
    d = text.charCodeAt(++j);
  put(f, NOT_ALLOWED, i, j);
  return j;
};
// [0-9]+(?:\.[0-9]+)*\b at i, or -1.
function version(i: number): number {
  let j = i;
  while (isDigit(text.charCodeAt(j))) j++;
  if (j === i) return -1;
  let best = isWord(text.charCodeAt(j)) ? -1 : j;
  while (text.charCodeAt(j) === 46 && isDigit(text.charCodeAt(j + 1))) {
    j += 2;
    while (isDigit(text.charCodeAt(j))) j++;
    if (!isWord(text.charCodeAt(j))) best = j;
  }
  return best;
}
// .*?(?=[),]) from i: the first ")" or "," on the line.
function lazyUntilCloser(i: number): number {
  for (let j = i; j < text.length; j++) {
    const c = text.charCodeAt(j);
    if (c === 41 || c === 44) return j;
    if (c === 10) return -1;
  }
  return -1;
}

// ---------------------------------------------------------------- comments

function comment(f: Frame, i: number): number {
  const c = text.charCodeAt(i);
  if (c === 47) {
    const d = text.charCodeAt(i + 1);
    if (d === 47) return lineComment(f, i, i);
    if (d !== 42) return -1;
    let scope = BLOCK_COMMENT;
    let n = 2;
    if (text.charCodeAt(i + 2) === 42 && text.charCodeAt(i + 3) !== 47) {
      scope = BLOCK_DOC;
      n = 3;
    } else if (text.charCodeAt(i + 2) === 58) {
      scope = BLOCK_PLAYGROUND;
      n = 3;
    }
    const B = sub(f, scope);
    put(B, COMMENT_BEGIN, i, i + n);
    return open(B, B, END_COMMENT, NESTED_COMMENT, i + n);
  }
  if (c === 42) {
    if (text.charCodeAt(i + 1) !== 47) return -1;
    put(f, STRAY_COMMENT_END, i, i + 2);
    return i + 2;
  }
  if (c === 35) {
    if (i !== 0 || lineStart !== 0 || text.charCodeAt(1) !== 33) return -1;
    const S = sub(f, SHEBANG);
    put(S, COMMENT_MARK, 0, 2);
    plain(S, 2, text.length);
    return text.length;
  }
  if ((c === 32 || c === 9) && i === 0) {
    let j = 1;
    while (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9) j++;
    if (text.charCodeAt(j) === 47 && text.charCodeAt(j + 1) === 47) return lineComment(f, 0, j);
  }
  return -1;
}
function lineComment(f: Frame, i: number, j: number): number {
  put(f, LEADING_SPACE, i, j);
  let scope = LINE_COMMENT;
  let n = 2;
  if (text.charCodeAt(j + 2) === 47) {
    scope = LINE_DOC;
    n = 3;
  } else if (text.charCodeAt(j + 2) === 58) {
    scope = LINE_PLAYGROUND;
    n = 3;
  }
  const L = sub(f, scope);
  const end = text.length - 1;
  put(L, COMMENT_MARK, j, j + n);
  plain(L, j + n, end);
  return end;
}
const END_COMMENT: Rule = (f, i) => {
  if (text.charCodeAt(i) !== 42 || text.charCodeAt(i + 1) !== 47) return -1;
  put(f, COMMENT_END, i, i + 2);
  return i + 2;
};
const END_NESTED_COMMENT: Rule = (f, i) => {
  if (text.charCodeAt(i) !== 42 || text.charCodeAt(i + 1) !== 47) return -1;
  plain(f, i, i + 2);
  return i + 2;
};
const NESTED_COMMENT: Rule = (f, i) => {
  if (text.charCodeAt(i) !== 47 || text.charCodeAt(i + 1) !== 42) return -1;
  plain(f, i, i + 2);
  return open(f, f, END_NESTED_COMMENT, NESTED_COMMENT, i + 2);
};

// ---------------------------------------------------------------- literals

function number(f: Frame, i: number): number {
  const c = text.charCodeAt(i);
  const prev = text.charCodeAt(i - 1);
  // (\B-|\b) before the digits.
  let p = -1;
  if (!isWord(prev)) {
    if (c === 45) p = i + 1;
    else if (isDigit(c)) p = i;
  }
  // (?<![]()\[_{}\p{L}\p{N}\p{M}]\.) after the sign.
  const member = (k: number) =>
    text.charCodeAt(k - 1) === 46 && isTupleOwner(text.charCodeAt(k - 2));
  const blocked = p >= 0 && member(p);
  for (let k = 0; k < NUMBER_RULES.length; k++) {
    if (k === 4) {
      // (?<=\s|^)-?\.[0-9][.\w]*
      if (i === 0 || isSpace(prev)) {
        const d = c === 45 ? i + 1 : i;
        if (text.charCodeAt(d) === 46 && isDigit(text.charCodeAt(d + 1))) {
          let j = d + 2;
          for (let e = text.charCodeAt(j); e === 46 || (e < 128 && ASCII[e] > 0);)
            e = text.charCodeAt(++j);
          put(f, LEADING_ZERO, i, j);
          return j;
        }
      }
    }
    if (k === 5 && isDigit(c) && member(i)) {
      // (?<=[]()\[_{}\p{L}\p{N}\p{M}]\.)[0-9]+\b, a tuple member.
      let j = i + 1;
      while (isDigit(text.charCodeAt(j))) j++;
      if (!isWord(text.charCodeAt(j))) {
        plain(f, i, j);
        return j;
      }
    }
    const [re, l, checked] = NUMBER_RULES[k]!;
    if (p < 0 || (checked && blocked)) continue;
    re.lastIndex = p;
    if (re.test(text)) {
      put(f, l, i, re.lastIndex);
      return re.lastIndex;
    }
  }
  return -1;
}
const isTupleOwner = (c: number) =>
  c === 93 || c === 40 || c === 41 || c === 91 || c === 123 || c === 125 || isIdPart(c);

// #literals: booleans, numbers, strings, nil, "#" literals, and regexes.
const LITERAL_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (isIdStart(c)) {
    if (!wordStart(i)) return -1;
    if (startsWord(i, "true") || startsWord(i, "false")) {
      const e = identRun(i);
      put(f, BOOLEAN, i, e);
      return e;
    }
    if (startsWord(i, "nil")) {
      put(f, NIL, i, i + 3);
      return i + 3;
    }
    return -1;
  }
  if (isDigit(c) || c === 45 || c === 46) return number(f, i);
  if (c === 34) return string(f, i);
  if (c === 35) return hashLiteral(f, i);
  if (c === 47) return regexLine(f, i);
  return -1;
};

function string(f: Frame, i: number): number {
  if (text.startsWith('"""', i)) {
    const B = sub(f, BLOCK_STRING);
    put(B, STRING_BEGIN, i, i + 3);
    return open(B, B, END_BLOCK_STRING, BLOCK_STRING_RULES, i + 3);
  }
  const S = sub(f, LINE_STRING);
  put(S, STRING_BEGIN, i, i + 1);
  return open(S, S, END_LINE_STRING, LINE_STRING_RULES, i + 1);
}
function hashRun(i: number): number {
  if (line === hashLine && text.length === hashLength && i >= hashFrom && i < hashTo) return hashTo;
  let j = i;
  while (text.charCodeAt(j) === 35) j++;
  hashLine = line;
  hashLength = text.length;
  hashFrom = i;
  hashTo = j;
  return j;
}
// Strings that start with "#": raw strings.
function rawString(f: Frame, i: number): number {
  const j = hashRun(i);
  if (text.charCodeAt(j) !== 34) return -1;
  const hashes = text.slice(i, j);
  const first = text.charCodeAt(i - 1) !== 35;
  if (text.startsWith('"""', j)) {
    const rest = j + 3;
    if (hashes === "#" && text.charCodeAt(rest) !== 35 && text.indexOf('"#', rest) < 0) {
      const B = sub(f, RAW_BLOCK_STRING);
      put(B, STRING_BEGIN, i, rest);
      return open(B, B, END_RAW_BLOCK_STRING, RAW_BLOCK_STRING_RULES, rest);
    }
    if (
      hashes.length > 1 &&
      first &&
      !text.startsWith(hashes, rest) &&
      text.indexOf(`"${hashes}`, rest) < 0
    ) {
      const B = sub(f, RAW_BLOCK_STRING);
      put(B, STRING_BEGIN, i, rest);
      return open(
        B,
        B,
        closingQuotes(`"""${hashes}`, STRING_END, EXTRA_CLOSE),
        AFTER_OPENING_RULES,
        rest,
      );
    }
  }
  if (hashes.length > 1 && first) {
    const S = sub(f, RAW_LINE_STRING);
    put(S, RAW_BEGIN, i, j + 1);
    return open(S, S, closingQuotes(`"${hashes}`, RAW_END, RAW_EXTRA_CLOSE), RETURN_RULES, j + 1);
  }
  if (hashes.length > 1) return -1;
  const S = sub(f, RAW_LINE_STRING);
  put(S, RAW_BEGIN, i, j + 1);
  return open(S, S, END_RAW_LINE_STRING, RAW_LINE_STRING_RULES, j + 1);
}
// A closing delimiter, then (#*) as extra closing delimiters.
const closingQuotes =
  (delimiter: string, l: number, extra: number): Rule =>
  (f, i) => {
    if (!text.startsWith(delimiter, i)) return -1;
    let j = i + delimiter.length;
    put(f, l, i, j);
    const k = j;
    while (text.charCodeAt(j) === 35) j++;
    put(f, extra, k, j);
    return j;
  };
const END_LINE_STRING = closingQuotes('"', STRING_END, EXTRA_CLOSE);
const END_BLOCK_STRING = closingQuotes('"""', STRING_END, EXTRA_CLOSE);
const END_RAW_LINE_STRING = closingQuotes('"#', RAW_END, RAW_EXTRA_CLOSE);
const END_RAW_BLOCK_STRING = closingQuotes('"""#', STRING_END, EXTRA_CLOSE);

const RETURN_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c !== 10 && c !== 13) return -1;
  put(f, RETURN, i, i + 1);
  return i + 1;
};
const LINE_STRING_RULES: Rule = (f, i) => {
  const r = RETURN_RULES(f, i, false);
  return r >= 0 ? r : escape(f, i, false);
};
const RAW_LINE_STRING_RULES: Rule = (f, i) => {
  const r = RETURN_RULES(f, i, false);
  return r >= 0 ? r : escape(f, i, true);
};
// The string guts: escapes and interpolation, after "\" or, raw, "\#".
function escape(f: Frame, i: number, raw: boolean): number {
  if (text.charCodeAt(i) !== 92) return -1;
  const k = raw ? i + 2 : i + 1;
  if (raw && text.charCodeAt(i + 1) !== 35) return -1;
  const d = text.charCodeAt(k);
  switch (d) {
    case 34:
    case 39:
    case 48:
    case 92:
    case 110:
    case 114:
    case 116:
      put(f, ESCAPE, i, k + 1);
      return k + 1;
    case 117:
      if (text.charCodeAt(k + 1) === 123) {
        let m = k + 2;
        while (isHex(text.charCodeAt(m)) && m < k + 11) m++;
        if (m > k + 2 && m <= k + 10 && text.charCodeAt(m) === 125) {
          put(f, UNICODE_ESCAPE, i, m + 1);
          return m + 1;
        }
      }
      break;
    case 40: {
      const E = sub(f, EMBEDDED);
      put(E, EMBEDDED_BEGIN, i, k + 1);
      return open(E, sub(E, EMBEDDED_SOURCE), END_EMBEDDED, ROOT_RULES, k + 1);
    }
  }
  if (d !== d || d === 10) return -1;
  put(f, BAD_ESCAPE, i, k + 1);
  return k + 1;
}
// \G(?:.+(?=""")|.+): text after an opening """.
function afterOpening(f: Frame, i: number): number {
  if (eol(i)) return -1;
  const k = text.lastIndexOf('"""');
  const end = k > i ? k : text.length - 1;
  put(f, AFTER_OPENING, i, end);
  return end;
}
const AFTER_OPENING_RULES: Rule = (f, i, g) => (g ? afterOpening(f, i) : -1);
// \S((?!\\\().)*(?="""): text before a closing """ on its line.
function beforeClosing(f: Frame, i: number, interpolation: string): number {
  const c = text.charCodeAt(i);
  if (isSpace(c) || c !== c) return -1;
  const last = text.lastIndexOf('"""');
  if (last <= i) return -1;
  const stop = text.indexOf(interpolation, i + 1);
  const k = stop < 0 ? last : text.lastIndexOf('"""', stop - 1);
  if (k <= i) return -1;
  put(f, BEFORE_CLOSING, i, k);
  return k;
}
// \\\s*\n: a line continuation; "\#" in a raw string.
function newlineEscape(f: Frame, i: number, raw: boolean): number {
  if (text.charCodeAt(i) !== 92 || (raw && text.charCodeAt(i + 1) !== 35)) return -1;
  const j = blanks(raw ? i + 2 : i + 1);
  if (text.charCodeAt(j) !== 10) return -1;
  put(f, NEWLINE_ESCAPE, i, j + 1);
  return j + 1;
}
const BLOCK_STRING_RULES: Rule = (f, i, g) => {
  if (g) {
    const r = afterOpening(f, i);
    if (r >= 0) return r;
  }
  let r = newlineEscape(f, i, false);
  if (r >= 0) return r;
  r = escape(f, i, false);
  return r >= 0 ? r : beforeClosing(f, i, "\\(");
};
const RAW_BLOCK_STRING_RULES: Rule = (f, i, g) => {
  if (g) {
    const r = afterOpening(f, i);
    if (r >= 0) return r;
  }
  let r = newlineEscape(f, i, true);
  if (r >= 0) return r;
  r = escape(f, i, true);
  return r >= 0 ? r : beforeClosing(f, i, "\\#(");
};

// ---------------------------------------------------------------- operators

// An operator region: the first of the prefix, postfix, and infix patterns,
// then the dot variants, at its start. Inner patterns that would color "="
// or "&&" alone never match in vscode-textmate, so every operator is custom.
function operator(f: Frame, i: number): number {
  const dot = text.charCodeAt(i) === 46;
  const from = dot ? i + 1 : i;
  let j = from;
  for (;;) {
    const c = text.charCodeAt(j);
    if (!(isOperatorChar(c) || (dot && c === 46))) break;
    const d = text.charCodeAt(j + 1);
    if ((c === 47 && (d === 47 || d === 42)) || (c === 42 && d === 47)) break;
    j++;
  }
  if (j === from) {
    plain(f, i, i + 1);
    return i + 1;
  }
  const p = text.charCodeAt(i - 1);
  const before =
    i === 0 || p === 40 || p === 44 || p === 58 || p === 59 || p === 91 || p === 123 || isSpace(p);
  const n = text.charCodeAt(j);
  const after =
    j >= text.length ||
    n === 93 ||
    n === 41 ||
    n === 44 ||
    n === 58 ||
    n === 59 ||
    n === 125 ||
    isSpace(n);
  const l =
    before && !after
      ? dot
        ? PREFIX_DOT
        : PREFIX
      : !before && after
        ? dot
          ? POSTFIX_DOT
          : POSTFIX
        : dot
          ? INFIX_DOT
          : INFIX;
  put(f, l, i, j);
  return j;
}

// ---------------------------------------------------------------- attributes

function attribute(f: Frame, i: number): number {
  const e = identEnd(i + 1);
  if (e < 0) return -1;
  if (text.charCodeAt(e) === 40) {
    const w = text.slice(i + 1, e);
    if (w === "available" || w === "objc") {
      const A = sub(
        f,
        w === "objc" ? "meta.attribute.objc.swift" : "meta.attribute.available.swift",
      );
      put(A, ATTRIBUTE_MARK, i, i + 1);
      put(A, ATTRIBUTE, i + 1, e);
      put(A, ARGUMENTS_BEGIN, e, e + 1);
      return open(A, A, END_ARGUMENTS, w === "objc" ? OBJC_RULES : AVAILABLE_RULES, e + 1);
    }
  }
  const A = sub(f, "meta.attribute.swift");
  put(A, ATTRIBUTE_MARK, i, i + 1);
  if (text.charCodeAt(i + 1) === 96) {
    put(A, ATTRIBUTE_TICK, i + 1, i + 2);
    put(A, ATTRIBUTE, i + 2, e - 1);
    put(A, ATTRIBUTE_TICK, e - 1, e);
  } else put(A, ATTRIBUTE, i + 1, e);
  return open(A, A, END_ATTRIBUTE, ATTRIBUTE_ARGUMENTS, e);
}
// (?!\G\(): an attribute ends unless its arguments follow at once.
const END_ATTRIBUTE: Rule = (_f, i, g) => (g && text.charCodeAt(i) === 40 ? -1 : i);
const ATTRIBUTE_ARGUMENTS: Rule = (f, i) => {
  if (text.charCodeAt(i) !== 40) return -1;
  const A = sub(f, "meta.arguments.attribute.swift");
  put(A, ARGUMENTS_BEGIN, i, i + 1);
  return open(A, A, END_ARGUMENTS, EXPRESSION_RULES, i + 1);
};
const AVAILABLE_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (isIdStart(c) && wordStart(i)) {
    const e = identRun(i);
    let w = text.slice(i, e);
    // \b(swift|platform(?:ApplicationExtension)?)\b(?:\s+([0-9]+(?:\.[0-9]+)*)\b)?
    const platform = w.endsWith("ApplicationExtension") ? w.slice(0, -20) : w;
    if (w === "swift" || PLATFORMS.has(platform)) {
      put(f, PLATFORM, i, e);
      const j = spaces(e);
      const n = j > e ? version(j) : -1;
      if (n < 0) return e;
      plain(f, e, j);
      put(f, NUMERIC, j, n);
      return n;
    }
    if (w === "introduced" || w === "deprecated" || w === "obsoleted") {
      const j = spaces(e);
      if (text.charCodeAt(j) === 58) {
        put(f, KEYWORD_OTHER, i, e);
        plain(f, e, j);
        put(f, KEY_VALUE, j, j + 1);
        const k = spaces(j + 1);
        plain(f, j + 1, k);
        return open(f, f, END_NOT_ANCHOR, VERSION_RULES, k);
      }
    }
    if (w === "message" || w === "renamed") {
      const j = spaces(e);
      const k = spaces(j + 1);
      if (text.charCodeAt(j) === 58 && text.charCodeAt(k) === 34) {
        put(f, KEYWORD_OTHER, i, e);
        plain(f, e, j);
        put(f, KEY_VALUE, j, j + 1);
        plain(f, j + 1, k);
        return open(f, f, END_NOT_ANCHOR, LITERAL_RULES, k);
      }
    }
    w = w === "deprecated" || w === "unavailable" || w === "noasync" ? w : "";
    if (w) {
      // \b(deprecated|unavailable|noasync)\b\s*(.*?)(?=[),])
      const j = spaces(e);
      const k = lazyUntilCloser(j);
      if (k >= 0) {
        put(f, KEYWORD_OTHER, i, e);
        plain(f, e, j);
        put(f, NOT_ALLOWED, j, k);
        return k;
      }
    }
    return -1;
  }
  if (c === 42) {
    const j = spaces(i + 1);
    const k = lazyUntilCloser(j);
    if (k < 0) return -1;
    put(f, ALL_PLATFORMS, i, i + 1);
    plain(f, i + 1, j);
    put(f, NOT_ALLOWED, j, k);
    return k;
  }
  return -1;
};
const VERSION_RULES: Rule = (f, i) => {
  if (!wordStart(i)) return -1;
  const n = version(i);
  if (n < 0) return -1;
  put(f, NUMERIC, i, n);
  return n;
};
// \w*(?::(?:\w*:)*(\w*))?: an Objective-C selector.
const OBJC_RULES: Rule = (f, i) => {
  let j = wordRun(i);
  if (text.charCodeAt(j) !== 58) {
    if (j === i) return -1;
    put(f, SELECTOR_PIECE, i, j);
    return j;
  }
  for (;;) {
    const k = wordRun(j + 1);
    if (text.charCodeAt(k) !== 58) {
      put(f, SELECTOR_PIECE, i, j + 1);
      put(f, MISSING_COLON, j + 1, k);
      return k;
    }
    j = k;
  }
};

// ---------------------------------------------------------------- declarations

function declaration(f: Frame, i: number, e: number, w: string): number {
  const dot = text.charCodeAt(i - 1) === 46;
  switch (w) {
    case "func":
      return functionDeclaration(f, i, e, FUNCTION_RULES, END_FUNCTION);
    case "init":
      return dot ? -1 : initializer(f, i, e, INITIALIZER_RULES, END_FUNCTION);
    case "subscript": {
      if (dot) return -1;
      const k = spaces(e);
      const d = text.charCodeAt(k);
      if (d !== 40 && d !== 60) return -1;
      const D = sub(f, "meta.definition.function.subscript.swift");
      put(D, FUNCTION_STORAGE, i, e);
      plain(D, e, k);
      return open(D, D, END_FUNCTION, FUNCTION_RULES, k);
    }
    case "async":
    case "let":
    case "var":
      return typedVariable(f, i, e, w);
    case "import":
      return dot ? -1 : importDeclaration(f, i, e);
    case "prefix":
    case "infix":
    case "postfix":
    case "operator":
      return operatorDeclaration(f, i, e, w);
    case "precedencegroup":
      return precedenceGroup(f, i, e);
    case "protocol": {
      const j = spaces(e);
      const n = j > e ? identEnd(j) : -1;
      if (n < 0) return -1;
      const P = sub(f, "meta.definition.type.protocol.swift");
      put(P, storageType("protocol"), i, e);
      plain(P, e, j);
      name(P, DECLARED_NAMES.protocol!, j, n);
      return open(P, P, END_AFTER_BRACE, PROTOCOL_RULES, n);
    }
    case "class":
    case "struct":
    case "actor":
    case "enum":
      return typeDeclaration(f, i, e, w);
    case "extension": {
      const j = spaces(e);
      if (j === e) return -1;
      const X = sub(f, "meta.definition.type.extension.swift");
      put(X, storageType("extension"), i, e);
      plain(X, e, j);
      return open(X, X, END_AFTER_BRACE, EXTENSION_RULES, j);
    }
    case "typealias":
      return typeAlias(f, i, e);
    case "macro": {
      const j = spaces(e);
      const n = j > e ? identEnd(j) : -1;
      if (n < 0) return -1;
      const k = spaces(n);
      const d = text.charCodeAt(k);
      if (d !== 40 && d !== 60 && d !== 61) return -1;
      const M = sub(f, "meta.definition.macro.swift");
      put(M, FUNCTION_STORAGE, i, e);
      plain(M, e, j);
      name(M, FUNCTION_NAME, j, n);
      plain(M, n, k);
      return open(M, M, END_MACRO, MACRO_RULES, k);
    }
  }
  return -1;
}
const END_MACRO: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return eol(i) || c === 59 || c === 61 || c === 125 || commentStart(i) ? i : -1;
};

// \b(func)\s+(name)\s*(?=[(<])
function functionDeclaration(f: Frame, i: number, e: number, rules: Rule, end: Rule): number {
  const j = spaces(e);
  if (j === e) return -1;
  let n = identEnd(j);
  if (n >= 0) {
    const d = text.charCodeAt(spaces(n));
    if (d !== 40 && d !== 60) return -1;
  } else n = operatorName(j);
  if (n < 0) return -1;
  const k = spaces(n);
  const D = sub(f, FUNCTION);
  put(D, FUNCTION_STORAGE, i, e);
  plain(D, e, j);
  name(D, FUNCTION_NAME, j, n);
  plain(D, n, k);
  return open(D, D, end, rules, k);
}
// An operator function's name: the longest that \s*[(<] follows.
function operatorName(j: number): number {
  const c = text.charCodeAt(j);
  let max = j + 1;
  if (isOperatorHead(c)) {
    while (isOperatorChar(text.charCodeAt(max))) max++;
  } else if (c === 46) {
    for (let d = text.charCodeAt(max); d === 46 || isOperatorChar(d);) d = text.charCodeAt(++max);
  } else return -1;
  for (let n = max; n > (c === 46 ? j + 1 : j); n--) {
    const d = text.charCodeAt(spaces(n));
    if (d === 40 || d === 60) return n;
  }
  return -1;
}
// (?<!\.)\b(init[!?]*)\s*(?=[(<])
function initializer(f: Frame, i: number, e: number, rules: Rule, end: Rule): number {
  let n = e;
  for (let c = text.charCodeAt(n); c === 33 || c === 63;) c = text.charCodeAt(++n);
  const k = spaces(n);
  const d = text.charCodeAt(k);
  if (d !== 40 && d !== 60) return -1;
  const D = sub(f, "meta.definition.function.initializer.swift");
  put(D, FUNCTION_STORAGE, i, Math.min(n, e + 1));
  put(D, STORAGE_INVALID, e + 1, n);
  plain(D, n, k);
  return open(D, D, end, rules, k);
}

const BODY = 1;
const PROTOCOL_BODY = 2;
// The parts of a function declaration after its name.
const functionRules =
  (result: boolean, body: number): Rule =>
  (f, i) => {
    const r = comment(f, i);
    if (r >= 0) return r;
    const c = text.charCodeAt(i);
    switch (c) {
      case 60:
        return genericParameters(f, i);
      case 40: {
        const P = sub(f, PARAMETER_CLAUSE);
        put(P, PARAMETERS_BEGIN, i, i + 1);
        return open(P, P, END_PARAMETERS, PARAMETER_RULES, i + 1);
      }
      case 45:
        return result && isArrow(i) ? functionResult(f, i) : -1;
      case 123: {
        if (body === BODY) {
          const B = sub(f, FUNCTION_BODY);
          put(B, FUNCTION_BEGIN, i, i + 1);
          return open(B, B, END_FUNCTION_BODY, ROOT_RULES, i + 1);
        }
        if (body !== PROTOCOL_BODY) return -1;
        const B = sub(f, "invalid.illegal.function-body-not-allowed-in-protocol.swift");
        put(B, FUNCTION_BEGIN, i, i + 1);
        return open(B, B, END_PROTOCOL_BODY, ROOT_RULES, i + 1);
      }
    }
    if (!isIdStart(c) || !wordStart(i)) return -1;
    const s = asyncThrows(f, i);
    if (s >= 0) return s;
    return startsWord(i, "where") ? whereClause(f, i) : -1;
  };
const FUNCTION_RULES = functionRules(true, BODY);
const INITIALIZER_RULES = functionRules(false, BODY);
const MACRO_RULES = functionRules(true, 0);
const PROTOCOL_FUNCTION_RULES = functionRules(true, PROTOCOL_BODY);
const PROTOCOL_INITIALIZER_RULES = functionRules(false, PROTOCOL_BODY);

// \b(?:((?:throws\s+|rethrows\s+)async)|((?:|re)throws)|(async))\b
function asyncThrows(f: Frame, i: number): number {
  const e = identRun(i);
  const w = text.slice(i, e);
  if (w === "throws" || w === "rethrows") {
    const j = spaces(e);
    if (j > e && startsWord(j, "async")) {
      put(f, THROWS_ASYNC, i, j + 5);
      return j + 5;
    }
    put(f, THROWS, i, e);
    return e;
  }
  if (w !== "async") return -1;
  put(f, ASYNC, i, e);
  return e;
}

// (\))(?:\s*(async)\b)?
const END_PARAMETERS: Rule = (f, i) => {
  if (text.charCodeAt(i) !== 41) return -1;
  put(f, PARAMETERS_END, i, i + 1);
  const j = spaces(i + 1);
  if (!startsWord(j, "async")) return i + 1;
  plain(f, i + 1, j);
  put(f, ASYNC, j, j + 5);
  return j + 5;
};
const PARAMETER_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 58) {
    // :\s*(?!\s)
    const j = spaces(i + 1);
    plain(f, i, j);
    return open(f, f, END_BEFORE_ARGUMENT_END, PARAMETER_TYPE_RULES, j);
  }
  if (c !== 96 && (!isIdStart(c) || isIdPart(text.charCodeAt(i - 1)))) return -1;
  const e = identEnd(i);
  if (e < 0) return -1;
  // (label)\s+(name)(?=\s*:), then (name)(?=\s*:)
  const j = spaces(e);
  const n = j > e ? identEnd(j) : -1;
  if (n > 0 && text.charCodeAt(spaces(n)) === 58) {
    name(f, LABEL_NAME, i, e);
    plain(f, e, j);
    name(f, PARAMETER, j, n);
    return n;
  }
  if (text.charCodeAt(j) !== 58) return -1;
  name(f, SINGLE_PARAMETER, i, e);
  return e;
};
const END_BEFORE_ARGUMENT_END: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return c === 41 || c === 44 ? i : -1;
};
const PARAMETER_TYPE_RULES: Rule = (f, i) => {
  if (isWordAt(i, "sending")) {
    put(f, MODIFIER, i, i + 7);
    return i + 7;
  }
  const r = typeRules(f, i);
  if (r >= 0) return r;
  const c = text.charCodeAt(i);
  if (c === 58) {
    put(f, EXTRA_COLON, i, i + 1);
    return i + 1;
  }
  if (c !== 61) return -1;
  put(f, ASSIGNMENT, i, i + 1);
  return open(f, f, END_BEFORE_ARGUMENT_END, EXPRESSION_RULES, i + 1);
};

// (?<![-!%&*+./<=>^|~])(->)(?![-!%&*+./<=>^|~])\s*
function functionResult(f: Frame, i: number): number {
  const R = sub(f, RESULT);
  put(R, RESULT_ARROW, i, i + 2);
  const j = spaces(i + 2);
  plain(R, i + 2, j);
  return open(R, R, END_RESULT, RESULT_RULES, j);
}
// (?!\G)(?=\{|\bwhere\b|[;=])|$
const END_RESULT: Rule = (_f, i, g) => {
  if (eol(i)) return i;
  if (g) return -1;
  const c = text.charCodeAt(i);
  return c === 123 || c === 59 || c === 61 || isWordAt(i, "where") ? i : -1;
};
const RESULT_RULES: Rule = (f, i) => {
  if (isWordAt(i, "sending")) {
    put(f, MODIFIER, i, i + 7);
    return i + 7;
  }
  return typeRules(f, i);
};

function genericParameters(f: Frame, i: number): number {
  const G = sub(f, GENERIC_PARAMETERS);
  put(G, GENERIC_PARAMETERS_BEGIN, i, i + 1);
  return open(G, G, END_GENERIC_PARAMETERS, GENERIC_PARAMETER_RULES, i + 1);
}
// >|(?=[^&,:<=>`\w\d\s])
const END_GENERIC_PARAMETERS: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 62) {
    put(f, GENERIC_PARAMETERS_END, i, i + 1);
    return i + 1;
  }
  if (c !== c || c === 38 || c === 44 || c === 58 || c === 60 || c === 61 || c === 96) return -1;
  return isWord(c) || isSpace(c) ? -1 : i;
};
const GENERIC_PARAMETER_RULES: Rule = (f, i) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  const c = text.charCodeAt(i);
  if (c === 44) {
    put(f, GENERIC_COMMA, i, i + 1);
    return i + 1;
  }
  if (c === 58) {
    // (:)\s*
    const C = sub(f, CONSTRAINT);
    put(C, CONSTRAINT_COLON, i, i + 1);
    const j = spaces(i + 1);
    plain(C, i + 1, j);
    return open(C, C, END_CONSTRAINT, CONSTRAINT_RULES, j);
  }
  if (!isWord(c) || !wordStart(i)) return -1;
  const e = wordRun(i);
  switch (text.slice(i, e)) {
    case "where":
      return whereClause(f, i);
    case "let":
      put(f, DECLARATION, i, e);
      return e;
    case "each":
      put(f, LOOP, i, e);
      return e;
  }
  if (isDigit(c)) return -1;
  put(f, GENERIC_PARAMETER, i, e);
  return e;
};
// (?=[,>]|(?!\G)\bwhere\b)
const END_CONSTRAINT: Rule = (_f, i, g) => {
  const c = text.charCodeAt(i);
  return c === 44 || c === 62 || (!g && isWordAt(i, "where")) ? i : -1;
};
const CONSTRAINT_RULES: Rule = (f, i, g) =>
  g ? open(f, sub(f, INHERITED), END_CONSTRAINT, INHERITED_RULES, i) : -1;
const INHERITED_RULES: Rule = (f, i) => {
  const r = typeIdentifier(f, i);
  return r >= 0 ? r : typeOperator(f, i);
};
// ((?<q>`?)name(\k<q>))\s*, then generic arguments.
function typeIdentifier(f: Frame, i: number): number {
  const e = identEnd(i);
  if (e < 0) return -1;
  const T = sub(f, TYPE_NAME);
  const tick = text.charCodeAt(i) === 96 ? 1 : 0;
  plain(T, i, i + tick);
  const w = text.slice(i + tick, e - tick);
  const b = BUILTINS.get(w);
  if (b && b.type >= 0 && w !== "Process") put(T, b.type, i + tick, e - tick);
  else plain(T, i + tick, e - tick);
  plain(T, e - tick, e);
  const j = spaces(e);
  plain(f, e, j);
  return open(f, f, END_NOT_ANGLE, TYPE_ARGUMENT_RULES, j);
}
const END_NOT_ANGLE: Rule = (_f, i) => (text.charCodeAt(i) === 60 ? -1 : i);
const TYPE_ARGUMENT_RULES: Rule = (f, i) =>
  text.charCodeAt(i) === 60 ? open(f, f, END_NOT_ANCHOR, GENERIC_ARGUMENT_RULE, i) : -1;
const GENERIC_ARGUMENT_RULE: Rule = (f, i) =>
  text.charCodeAt(i) === 60 ? genericArguments(f, i) : -1;
function typeOperator(f: Frame, i: number): number {
  if (loneOperator(i, 38)) put(f, COMPOSITION, i, i + 1);
  else if (loneOperator(i, 126)) put(f, SUPPRESSION, i, i + 1);
  else return -1;
  return i + 1;
}

// \b(where)\b\s*
function whereClause(f: Frame, i: number): number {
  const W = sub(f, WHERE);
  put(W, WHERE_KEYWORD, i, i + 5);
  const j = spaces(i + 5);
  plain(W, i + 5, j);
  return open(W, W, END_WHERE, WHERE_RULES, j);
}
// (?!\G)$|(?=[\n;>{}]|//|/\*)
const END_WHERE: Rule = (_f, i, g) => {
  if (!g && eol(i)) return i;
  const c = text.charCodeAt(i);
  return c === 10 || c === 59 || c === 62 || c === 123 || c === 125 || commentStart(i) ? i : -1;
};
const WHERE_RULES: Rule = (f, i, g) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  // \G|,\s*
  if (g) return open(f, f, END_REQUIREMENT, REQUIREMENT_RULES, i);
  if (text.charCodeAt(i) !== 44) return -1;
  const j = spaces(i + 1);
  plain(f, i, j);
  return open(f, f, END_REQUIREMENT, REQUIREMENT_RULES, j);
};
// (?=[\n,;>{}]|//|/\*)
const END_REQUIREMENT: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return c === 10 || c === 44 || c === 59 || c === 62 || c === 123 || c === 125 || commentStart(i)
    ? i
    : -1;
};
// (?=\s*[\n,;>{}]|//|/\*)
const END_REQUIREMENT_PART: Rule = (_f, i) => {
  const c = text.charCodeAt(blanks(i));
  return c === 10 || c === 44 || c === 59 || c === 62 || c === 123 || c === 125 || commentStart(i)
    ? i
    : -1;
};
const REQUIREMENT_RULES: Rule = (f, i) => {
  let r = comment(f, i);
  if (r >= 0) return r;
  r = typeRules(f, i);
  if (r >= 0) return r;
  if (text.charCodeAt(i) === 61 && text.charCodeAt(i + 1) === 61) {
    if (nearOperator(text.charCodeAt(i - 1)) || nearOperator(text.charCodeAt(i + 2))) return -1;
    const S = sub(f, SAME_TYPE);
    put(S, SAME_TYPE_OPERATOR, i, i + 2);
    return open(S, S, END_REQUIREMENT_PART, TYPE_RULES, i + 2);
  }
  if (!loneOperator(i, 58)) return -1;
  const C = sub(f, CONFORMANCE);
  put(C, CONFORMANCE_OPERATOR, i, i + 1);
  return open(C, C, END_REQUIREMENT_PART, CONFORMANCE_RULES, i + 1);
};
// \G\s*, whose content is an inherited class.
const CONFORMANCE_RULES: Rule = (f, i, g) => {
  if (!g) return -1;
  const j = spaces(i);
  plain(f, i, j);
  return open(f, sub(f, INHERITED), END_REQUIREMENT_PART, TYPE_RULES, j);
};

// (:)(?=\s*\{)|(:)\s*
function inheritance(f: Frame, i: number): number {
  const H = sub(f, INHERITANCE);
  if (text.charCodeAt(spaces(i + 1)) === 123) {
    put(H, EMPTY_INHERITANCE, i, i + 1);
    return open(H, H, END_INHERITANCE, INHERITANCE_RULES, i + 1);
  }
  put(H, INHERITANCE_SEPARATOR, i, i + 1);
  const j = spaces(i + 1);
  plain(H, i + 1, j);
  return open(H, H, END_INHERITANCE, INHERITANCE_RULES, j);
}
// (?!\G)$|(?=[={}]|(?!\G)\bwhere\b)
const END_INHERITANCE: Rule = (_f, i, g) => {
  if (!g && eol(i)) return i;
  return END_INHERITED_LIST(_f, i, g);
};
const END_INHERITED_LIST: Rule = (_f, i, g) => {
  const c = text.charCodeAt(i);
  return c === 61 || c === 123 || c === 125 || (!g && isWordAt(i, "where")) ? i : -1;
};
const INHERITANCE_RULES: Rule = (f, i, g) => {
  if (isWordAt(i, "class")) {
    put(f, CLASS_STORAGE, i, i + 5);
    return open(f, f, END_INHERITED_LIST, CLASS_INHERITANCE_RULES, i + 5);
  }
  return g ? open(f, f, END_INHERITANCE, INHERITED_LIST_RULES, i) : -1;
};
const CLASS_INHERITANCE_RULES: Rule = (f, i) => {
  const r = comment(f, i);
  return r >= 0 ? r : moreTypes(f, i);
};
const INHERITED_LIST_RULES: Rule = (f, i) => {
  if (text.charCodeAt(i) === 64) {
    const r = attribute(f, i);
    if (r >= 0) return r;
  }
  let r = comment(f, i);
  if (r >= 0) return r;
  r = inheritedType(f, i);
  if (r >= 0) return r;
  r = moreTypes(f, i);
  return r >= 0 ? r : typeOperator(f, i);
};
// (?=[_`\p{L}]): one inherited type.
function inheritedType(f: Frame, i: number): number {
  const c = text.charCodeAt(i);
  if (c !== 96 && !isIdStart(c)) return -1;
  const I = sub(f, INHERITED);
  return open(I, I, END_NOT_ANCHOR, TYPE_IDENTIFIER_RULE, i);
}
const TYPE_IDENTIFIER_RULE: Rule = (f, i) => typeIdentifier(f, i);
// ,\s*
function moreTypes(f: Frame, i: number): number {
  if (text.charCodeAt(i) !== 44) return -1;
  const M = sub(f, MORE_TYPES);
  const j = spaces(i + 1);
  plain(M, i, j);
  return open(M, M, END_MORE_TYPES, INHERITED_LIST_RULES, j);
}
// (?!\G)(?!/[*/])|(?=[,={}]|(?!\G)\bwhere\b)
const END_MORE_TYPES: Rule = (_f, i, g) => {
  if (!g && !commentStart(i)) return i;
  const c = text.charCodeAt(i);
  return c === 44 || c === 61 || c === 123 || c === 125 ? i : -1;
};

// class, struct, actor, and enum.
function typeDeclaration(f: Frame, i: number, e: number, w: string): number {
  const j = spaces(e);
  if (w === "enum" && j === e) return -1;
  if (w === "class" && j > e) {
    const m = identRun(j);
    const v = m > 0 ? text.slice(j, m) : "";
    if (v === "func" || v === "var" || v === "let") return -1;
  }
  const n = identEnd(j);
  if (n < 0) return -1;
  const T = sub(f, `meta.definition.type.${w}.swift`);
  put(T, storageType(w), i, e);
  plain(T, e, j);
  name(T, DECLARED_NAMES[w]!, j, n);
  return open(T, T, END_AFTER_BRACE, w === "enum" ? ENUM_RULES : TYPE_DECLARATION_RULES, n);
}
const typeDeclarationRules =
  (body: Rule, generics = true): Rule =>
  (f, i) => {
    const r = comment(f, i);
    if (r >= 0) return r;
    const c = text.charCodeAt(i);
    if (c === 60 && generics) return genericParameters(f, i);
    if (c === 58) return inheritance(f, i);
    if (c === 123) {
      const B = sub(f, TYPE_BODY);
      put(B, TYPE_BEGIN, i, i + 1);
      return open(B, B, END_TYPE_BODY, body, i + 1);
    }
    return isWordAt(i, "where") ? whereClause(f, i) : -1;
  };
const ENUM_BODY_RULES: Rule = (f, i) => {
  if (isWordAt(i, "case")) {
    // \b(case)\b\s*
    put(f, CASE, i, i + 4);
    const j = spaces(i + 4);
    plain(f, i + 4, j);
    return open(f, f, END_CASE_CLAUSE, CASE_RULES, j);
  }
  return root(f, i);
};
const TYPE_DECLARATION_RULES = typeDeclarationRules(ROOT_RULES);
const ENUM_RULES = typeDeclarationRules(ENUM_BODY_RULES);
const EXTENSION_BODY_RULES = typeDeclarationRules(ROOT_RULES, false);
// (?=[;}])|(?!\G)(?!/[*/])(?=[^,\s])
const END_CASE_CLAUSE: Rule = (_f, i, g) => {
  const c = text.charCodeAt(i);
  if (c === 59 || c === 125) return i;
  return !g && !commentStart(i) && c === c && c !== 44 && !isSpace(c) ? i : -1;
};
const END_MORE_CASES: Rule = (_f, i, g) => {
  const c = text.charCodeAt(i);
  return !g && !commentStart(i) && c === c && c !== 44 && !isSpace(c) ? i : -1;
};
const CASE_RULES: Rule = (f, i) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  const e = identEnd(i);
  if (e >= 0) {
    // ((?<q>`?)name(\k<q>))\s*
    put(f, ENUM_MEMBER, i, e);
    const j = spaces(e);
    plain(f, e, j);
    return open(f, f, END_ENUM_CASE, ENUM_CASE_RULES, j);
  }
  if (text.charCodeAt(i) !== 44) return -1;
  const M = sub(f, MORE_CASES);
  const j = spaces(i + 1);
  plain(M, i, j);
  return open(M, M, END_MORE_CASES, CASE_RULES, j);
};
// (?<=\))|(?![(=])
const END_ENUM_CASE: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return text.charCodeAt(i - 1) === 41 || (c !== 40 && c !== 61) ? i : -1;
};
const ENUM_CASE_RULES: Rule = (f, i, g) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  const c = text.charCodeAt(i);
  if (c === 40 && g) {
    put(f, PARAMETERS_BEGIN, i, i + 1);
    return open(f, f, END_ASSOCIATED_VALUES, ASSOCIATED_VALUE_RULES, i + 1);
  }
  if (c !== 61) return -1;
  // (=)\s*
  put(f, ASSIGNMENT, i, i + 1);
  const j = spaces(i + 1);
  plain(f, i + 1, j);
  return open(f, f, END_NOT_ANCHOR, RAW_VALUE_RULES, j);
};
const RAW_VALUE_RULES: Rule = (f, i, g) => {
  const r = comment(f, i);
  return r >= 0 ? r : LITERAL_RULES(f, i, g);
};
const ASSOCIATED_VALUE_RULES: Rule = (f, i) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  const c = text.charCodeAt(i);
  const e = identEnd(i);
  if (e >= 0) {
    // (?:(_)|(label))\s+(name)\s*(:)
    const j = spaces(e);
    const n = j > e ? identEnd(j) : -1;
    const k = n > 0 ? spaces(n) : -1;
    if (k > 0 && text.charCodeAt(k) === 58) {
      put(f, e === i + 1 && c === 95 ? LABEL_NAME[0] : DISTINCT_LABELS, i, e);
      plain(f, e, j);
      put(f, ASSOCIATED_PARAMETER, j, n);
      plain(f, n, k);
      put(f, ARGUMENT_LABEL, k, k + 1);
      return open(f, f, END_ELEMENT, TYPE_RULES, k + 1);
    }
    // (name)\s*(:)
    if (text.charCodeAt(j) === 58) {
      put(f, ASSOCIATED_LABEL, i, e);
      plain(f, e, j);
      put(f, ARGUMENT_LABEL, j, j + 1);
      return open(f, f, END_ELEMENT, TYPE_RULES, j + 1);
    }
  }
  if (c !== c || c === 93 || c === 41 || c === 44 || isSpace(c)) return -1;
  return open(f, f, END_ELEMENT, ASSOCIATED_TYPE_RULES, i);
};
const ASSOCIATED_TYPE_RULES: Rule = (f, i) => {
  const r = typeRules(f, i);
  if (r >= 0 || text.charCodeAt(i) !== 58) return r;
  put(f, EXTRA_COLON, i, i + 1);
  return i + 1;
};

const PROTOCOL_RULES: Rule = (f, i) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  const c = text.charCodeAt(i);
  if (c === 58) return inheritance(f, i);
  if (c === 123) {
    const B = sub(f, TYPE_BODY);
    put(B, TYPE_BEGIN, i, i + 1);
    return open(B, B, END_TYPE_BODY, PROTOCOL_BODY_RULES, i + 1);
  }
  return isWordAt(i, "where") ? whereClause(f, i) : -1;
};
const PROTOCOL_BODY_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c >= 97 && c <= 122 && wordStart(i)) {
    const e = identRun(i);
    const w = text.slice(i, e);
    let r = -1;
    if (w === "func")
      r = functionDeclaration(f, i, e, PROTOCOL_FUNCTION_RULES, END_PROTOCOL_FUNCTION);
    else if (w === "init" && text.charCodeAt(i - 1) !== 46)
      r = initializer(f, i, e, PROTOCOL_INITIALIZER_RULES, END_PROTOCOL_FUNCTION);
    else if (w === "associatedtype") r = associatedType(f, i, e);
    if (r >= 0) return r;
  }
  return root(f, i);
};
// \b(associatedtype)\s+(name)\s*
function associatedType(f: Frame, i: number, e: number): number {
  const j = spaces(e);
  const n = j > e ? identEnd(j) : -1;
  if (n < 0) return -1;
  const A = sub(f, "meta.definition.associatedtype.swift");
  put(A, DECLARATION, i, e);
  plain(A, e, j);
  name(A, ASSOCIATED_TYPE_NAME, j, n);
  const k = spaces(n);
  plain(A, n, k);
  return open(A, A, END_ASSOCIATED_TYPE, ASSOCIATED_TYPE_DECLARATION_RULES, k);
}
// (?!\G)$|(?=[;}]|$)
const END_ASSOCIATED_TYPE: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return eol(i) || c === 59 || c === 125 ? i : -1;
};
const ASSOCIATED_TYPE_DECLARATION_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 58) return inheritance(f, i);
  if (c === 61) return typeAssignment(f, i);
  return isWordAt(i, "where") ? whereClause(f, i) : -1;
};

const EXTENSION_RULES: Rule = (f, i, g) => {
  if (g) {
    // \G(?!\s*[\n:{]): the extended type's name.
    const d = text.charCodeAt(blanks(i));
    if (d !== 10 && d !== 58 && d !== 123) {
      const N = sub(f, "entity.name.type.swift");
      return open(N, N, END_EXTENDED_NAME, TYPE_RULES, i);
    }
  }
  return EXTENSION_BODY_RULES(f, i, g);
};
// (?=\s*[\n:{])|(?!\G)(?=\s*where\b)
const END_EXTENDED_NAME: Rule = (_f, i, g) => {
  const j = blanks(i);
  const d = text.charCodeAt(j);
  return d === 10 || d === 58 || d === 123 || (!g && startsWord(j, "where")) ? i : -1;
};

// \b(typealias)\s+(name)\s*
function typeAlias(f: Frame, i: number, e: number): number {
  const j = spaces(e);
  const n = j > e ? identEnd(j) : -1;
  if (n < 0) return -1;
  const A = sub(f, "meta.definition.typealias.swift");
  put(A, DECLARATION, i, e);
  plain(A, e, j);
  name(A, DECLARED_NAMES.typealias!, j, n);
  const k = spaces(n);
  plain(A, n, k);
  return open(A, A, END_TYPE_ALIAS, TYPE_ALIAS_RULES, k);
}
// (?!\G)$|(?=;|//|/\*|$)
const END_TYPE_ALIAS: Rule = (_f, i) =>
  eol(i) || text.charCodeAt(i) === 59 || commentStart(i) ? i : -1;
const TYPE_ALIAS_RULES: Rule = (f, i, g) => {
  const c = text.charCodeAt(i);
  if (c === 60 && g) return open(f, f, END_NOT_ANCHOR, GENERIC_PARAMETER_RULE, i);
  return c === 61 ? typeAssignment(f, i) : -1;
};
const GENERIC_PARAMETER_RULE: Rule = (f, i) =>
  text.charCodeAt(i) === 60 ? genericParameters(f, i) : -1;
// (=)\s*, then a type.
function typeAssignment(f: Frame, i: number): number {
  put(f, ASSIGNMENT, i, i + 1);
  const j = spaces(i + 1);
  plain(f, i + 1, j);
  return open(f, f, END_TYPE_ALIAS, TYPE_RULES, j);
}

// \b(?:(async)\s+)?(let|var)\b\s+name\s*:, then a type.
function typedVariable(f: Frame, i: number, e: number, w: string): number {
  let s = i;
  let k = e;
  if (w === "async") {
    s = spaces(e);
    k = identRun(s);
    const v = s > e && k > 0 ? text.slice(s, k) : "";
    if (v !== "let" && v !== "var") return -1;
  }
  const j = spaces(k);
  const n = j > k ? identEnd(j) : -1;
  if (n < 0) return -1;
  const m = spaces(n);
  if (text.charCodeAt(m) !== 58) return -1;
  if (w === "async") {
    put(f, ASYNC, i, e);
    plain(f, e, s);
  }
  put(f, DECLARATION, s, k);
  plain(f, k, m + 1);
  return open(f, f, END_TYPED_VARIABLE, TYPE_RULES, m + 1);
}
const END_TYPED_VARIABLE: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return eol(i) || c === 61 || c === 123 ? i : -1;
};

// (?<!\.)\b(import)\s+
function importDeclaration(f: Frame, i: number, e: number): number {
  const j = spaces(e);
  if (j === e) return -1;
  const I = sub(f, "meta.import.swift");
  put(I, IMPORT, i, e);
  plain(I, e, j);
  return open(I, I, END_IMPORT, IMPORT_RULES, j);
}
// (;)|$\n?|(?=/[*/])
const END_IMPORT: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 59) {
    put(f, TERMINATOR, i, i + 1);
    return i + 1;
  }
  if (eol(i)) return c === 10 ? i + 1 : i;
  return commentStart(i) ? i : -1;
};
const endsImportPath = (i: number) => text.charCodeAt(i) === 59 || eol(i) || commentStart(i);
const IMPORT_RULES: Rule = (f, i, g) => {
  if (!g || endsImportPath(i)) return -1;
  // \G(?:(typealias|struct|class|actor|enum|protocol|var|func)\s+)?
  let k = i;
  const m = identRun(i);
  if (m > 0 && IMPORT_KINDS.has(text.slice(i, m))) {
    const n = spaces(m);
    if (n > m) {
      put(f, MODIFIER, i, m);
      plain(f, m, n);
      k = n;
    }
  }
  return open(f, f, END_IMPORT_PATH, IMPORT_PATH_RULES, k);
};
const END_IMPORT_PATH: Rule = (_f, i) => (endsImportPath(i) ? i : -1);
const IMPORT_PATH_RULES: Rule = (f, i, g) => {
  const c = text.charCodeAt(i);
  if (g || text.charCodeAt(i - 1) === 46) {
    const e = identEnd(i);
    if (e >= 0) {
      name(f, ENTITY_TYPE, i, e);
      return e;
    }
    if (c === 36 && isDigit(text.charCodeAt(i + 1))) {
      let j = i + 2;
      while (isDigit(text.charCodeAt(j))) j++;
      put(f, ENTITY_TYPE[0], i, j);
      return j;
    }
    const n = importOperator(i);
    if (n > i) {
      put(f, ENTITY_TYPE[0], i, n);
      return n;
    }
  }
  if (c === 46) {
    put(f, IMPORT_SEPARATOR, i, i + 1);
    return i + 1;
  }
  // (?!\s*(;|$|//|/\*)): characters that do not belong.
  if (endsImportPath(blanks(i))) return -1;
  const N = sub(f, "invalid.illegal.character-not-allowed-here.swift");
  return open(N, N, END_NOT_ALLOWED, NEVER, i);
};
const END_NOT_ALLOWED: Rule = (_f, i) => (endsImportPath(blanks(i)) ? i : -1);
// An operator name in an import, before [.;], the end, a comment, or a space.
function importOperator(i: number): number {
  const c = text.charCodeAt(i);
  let j = i + 1;
  if (isOperatorHead(c)) {
    while (isOperatorChar(text.charCodeAt(j))) j++;
  } else if (c === 46) {
    for (let d = text.charCodeAt(j); d === 46 || isOperatorChar(d);) d = text.charCodeAt(++j);
    if (j === i + 1) return -1;
  } else return -1;
  const d = text.charCodeAt(j);
  return d === 46 || d === 59 || eol(j) || commentStart(j) || isSpace(d) ? j : -1;
}

// (?:\b((?:pre|in|post)fix)\s+)?\b(operator)\s+(name)\s*
function operatorDeclaration(f: Frame, i: number, e: number, w: string): number {
  let s = i;
  let k = e;
  if (w !== "operator") {
    s = spaces(e);
    if (s === e || !startsWord(s, "operator")) return -1;
    k = s + 8;
  }
  const j = spaces(k);
  if (j === k) return -1;
  const c = text.charCodeAt(j);
  let n = j + 1;
  if (isOperatorHead(c)) {
    for (let d = text.charCodeAt(n); d === 46 || isOperatorChar(d);) d = text.charCodeAt(++n);
  } else if (c === 46) {
    for (let d = text.charCodeAt(n); d === 46 || isOperatorChar(d);) d = text.charCodeAt(++n);
    if (n === j + 1) return -1;
  } else return -1;
  const D = sub(f, "meta.definition.operator.swift");
  if (w !== "operator") {
    put(D, MODIFIER, i, e);
    plain(D, e, s);
  }
  put(D, OPERATOR_STORAGE, s, k);
  plain(D, k, j);
  for (let m = j; m < n; m++)
    put(D, c !== 46 && text.charCodeAt(m) === 46 ? OPERATOR_DOT : OPERATOR_NAME, m, m + 1);
  const end = spaces(n);
  plain(D, n, end);
  return open(D, D, END_IMPORT, OPERATOR_RULES, end);
}
const OPERATOR_RULES: Rule = (f, i, g) => {
  const c = text.charCodeAt(i);
  if (g && c === 123) {
    put(f, OPERATOR_BEGIN, i, i + 1);
    return open(f, f, END_OPERATOR_BODY, OPERATOR_BODY_RULES, i + 1);
  }
  if (g && c === 58) {
    // \G(:)\s*(name): a precedence group.
    const j = spaces(i + 1);
    const n = identEnd(j);
    if (n > 0) {
      plain(f, i, j);
      precedenceName(f, j, n);
      return n;
    }
  }
  if (eol(i) || c === 59 || commentStart(i) || isSpace(c)) return -1;
  let j = i + 1;
  while (!eol(j) && text.charCodeAt(j) !== 59 && !commentStart(j) && !isSpace(text.charCodeAt(j)))
    j++;
  put(f, NOT_ALLOWED, i, j);
  return j;
};
function precedenceName(f: Frame, j: number, n: number) {
  const tick = text.charCodeAt(j) === 96 ? 1 : 0;
  const w = text.slice(j + tick, n - tick);
  const known = w.endsWith("Precedence") && PRECEDENCE_GROUPS.has(w.slice(0, -10));
  put(f, INHERITED_LEAF, j, j + tick);
  put(f, known ? INHERITED_PRECEDENCE : INHERITED_LEAF, j + tick, n - tick);
  put(f, INHERITED_LEAF, n - tick, n);
}
const OPERATOR_BODY_RULES: Rule = (f, i) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  if (!wordStart(i)) return -1;
  for (const [key, values, l] of [
    ["associativity", ["left", "right"], ASSOCIATIVITY],
    ["precedence", null, NUMERIC],
  ] as const) {
    if (!startsWord(i, key)) continue;
    const j = spaces(i + key.length);
    const n = values ? identRun(j) : wordRun(j);
    const v = j > i + key.length && n > j ? text.slice(j, n) : "";
    if (values ? !values.includes(v as never) : !/^[0-9]+$/.test(v)) continue;
    put(f, MODIFIER, i, i + key.length);
    plain(f, i + key.length, j);
    put(f, l === NUMERIC ? INTEGER : l, j, n);
    return n;
  }
  if (startsWord(i, "assignment")) {
    put(f, MODIFIER, i, i + 10);
    return i + 10;
  }
  return -1;
};

// \b(precedencegroup)\s+(name)\s*(?=\{)
function precedenceGroup(f: Frame, i: number, e: number): number {
  const j = spaces(e);
  const n = j > e ? identEnd(j) : -1;
  if (n < 0) return -1;
  const k = spaces(n);
  if (text.charCodeAt(k) !== 123) return -1;
  const P = sub(f, "meta.definition.precedencegroup.swift");
  put(P, storageType("precedencegroup"), i, e);
  plain(P, e, j);
  name(P, DECLARED_NAMES.precedencegroup!, j, n);
  plain(P, n, k);
  return open(P, P, END_NOT_ANCHOR, PRECEDENCE_RULES, k);
}
const PRECEDENCE_RULES: Rule = (f, i) => {
  if (text.charCodeAt(i) !== 123) return -1;
  put(f, PRECEDENCE_BEGIN, i, i + 1);
  return open(f, f, END_PRECEDENCE_BODY, PRECEDENCE_BODY_RULES, i + 1);
};
const PRECEDENCE_BODY_RULES: Rule = (f, i) => {
  const r = comment(f, i);
  if (r >= 0) return r;
  if (!wordStart(i) || !isIdStart(text.charCodeAt(i))) return -1;
  const e = identRun(i);
  const w = text.slice(i, e);
  const j = spaces(e);
  if (w === "higherThan" || w === "lowerThan") {
    const k = spaces(j + 1);
    const n = text.charCodeAt(j) === 58 ? identEnd(k) : -1;
    if (n < 0) return -1;
    put(f, MODIFIER, i, e);
    plain(f, e, k);
    precedenceName(f, k, n);
    return n;
  }
  if (w !== "associativity" && w !== "assignment") return -1;
  put(f, MODIFIER, i, e);
  if (text.charCodeAt(j) !== 58) return e;
  const k = spaces(j + 1);
  const n = identRun(k);
  const v = n > 0 ? text.slice(k, n) : "";
  const values = w === "assignment" ? ["true", "false"] : ["right", "left", "none"];
  if (!values.includes(v)) return e;
  plain(f, e, k);
  put(f, w === "assignment" ? BOOLEAN : ASSOCIATIVITY, k, n);
  return n;
};

// ---------------------------------------------------------------- types

// #declarations-available-types.
function typeRules(f: Frame, i: number): number {
  const r = comment(f, i);
  if (r >= 0) return r;
  const c = text.charCodeAt(i);
  if (isIdStart(c)) {
    const prev = text.charCodeAt(i - 1);
    if (isIdPart(prev)) return -1;
    const e = identRun(i);
    const w = text.slice(i, e);
    const b = BUILTINS.get(w);
    if (b && b.type >= 0 && (w !== "Process" || text.charCodeAt(e) === 46)) {
      put(f, b.type, i, e);
      return e;
    }
    let l = -1;
    let end = e;
    switch (w) {
      case "async":
        l = ASYNC;
        break;
      case "throws":
      case "rethrows":
        l = THROWS;
        break;
      case "some":
        l = OPAQUE;
        break;
      case "any":
        l = EXISTENTIAL;
        break;
      case "repeat":
      case "each":
        l = LOOP;
        break;
      case "inout":
      case "isolated":
      case "borrowing":
      case "consuming":
        l = MODIFIER;
        break;
      case "nonisolated":
        l = MODIFIER;
        if (text.startsWith("(nonsending)", e)) end = e + 12;
        break;
      case "Self":
        l = LANGUAGE;
        break;
      case "protocol":
        l = COMPOSITION_KEYWORD;
        break;
      case "Protocol":
      case "Type":
        if (prev === 46) l = METATYPE;
    }
    if (l < 0) return -1;
    put(f, l, i, end);
    return end;
  }
  switch (c) {
    case 64:
      return attribute(f, i);
    case 45:
      if (!isArrow(i)) return -1;
      put(f, TYPE_ARROW, i, i + 2);
      return i + 2;
    case 38:
      if (!loneOperator(i, 38)) return -1;
      put(f, COMPOSITION, i, i + 1);
      return i + 1;
    case 33:
    case 63:
      put(f, OPTIONAL, i, i + 1);
      return i + 1;
    case 46:
      if (!text.startsWith("...", i)) return -1;
      put(f, VARIADIC, i, i + 3);
      return i + 3;
    case 40:
      put(f, TUPLE_TYPE_BEGIN, i, i + 1);
      return open(f, f, END_TUPLE_TYPE, TYPE_RULES, i + 1);
    case 91:
      put(f, COLLECTION_BEGIN, i, i + 1);
      return open(f, f, END_COLLECTION_TYPE, COLLECTION_RULES, i + 1);
    case 60:
      return genericArguments(f, i);
  }
  return -1;
}
const TYPE_RULES: Rule = (f, i) => typeRules(f, i);
// \)|(?=[]>{}])
const END_TUPLE_TYPE: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 41) {
    put(f, TUPLE_TYPE_END, i, i + 1);
    return i + 1;
  }
  return c === 93 || c === 62 || c === 123 || c === 125 ? i : -1;
};
// ]|(?=[)>{}])
const END_COLLECTION_TYPE: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 93) {
    put(f, COLLECTION_END, i, i + 1);
    return i + 1;
  }
  return c === 41 || c === 62 || c === 123 || c === 125 ? i : -1;
};
const COLLECTION_RULES: Rule = (f, i) => {
  let r = typeRules(f, i);
  if (r >= 0) return r;
  const c = text.charCodeAt(i);
  if (isDigit(c) || c === 45 || c === 46) {
    r = number(f, i);
    if (r >= 0) return r;
  }
  if (c === 95 && wordStart(i) && !isWord(text.charCodeAt(i + 1))) {
    put(f, INFERRED, i, i + 1);
    return i + 1;
  }
  if (c === 111 && isSpace(text.charCodeAt(i - 1)) && startsWord(i, "of")) {
    const j = spaces(i + 2);
    const d = text.charCodeAt(j);
    if (j > i + 2 && (d === 40 || d === 91 || isIdPart(d))) {
      put(f, INLINE_ARRAY, i, i + 2);
      return i + 2;
    }
  }
  if (c !== 58) return -1;
  put(f, KEY_VALUE, i, i + 1);
  return open(f, f, END_DICTIONARY_VALUE, DICTIONARY_VALUE_RULES, i + 1);
};
const END_DICTIONARY_VALUE: Rule = (_f, i) => {
  const c = text.charCodeAt(i);
  return c === 93 || c === 41 || c === 62 || c === 123 || c === 125 ? i : -1;
};
const DICTIONARY_VALUE_RULES: Rule = (f, i) => {
  if (text.charCodeAt(i) === 58) {
    put(f, EXTRA_DICTIONARY_COLON, i, i + 1);
    return i + 1;
  }
  return typeRules(f, i);
};
function genericArguments(f: Frame, i: number): number {
  const G = sub(f, GENERIC_ARGUMENTS);
  put(G, GENERIC_ARGUMENTS_BEGIN, i, i + 1);
  return open(G, G, END_GENERIC_ARGUMENTS, GENERIC_ARGUMENT_RULES, i + 1);
}
// >|(?=[]){}])
const END_GENERIC_ARGUMENTS: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 62) {
    put(f, GENERIC_ARGUMENTS_END, i, i + 1);
    return i + 1;
  }
  return c === 93 || c === 41 || c === 123 || c === 125 ? i : -1;
};
const GENERIC_ARGUMENT_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (isDigit(c) || c === 45 || c === 46) {
    const r = number(f, i);
    if (r >= 0) return r;
  }
  return typeRules(f, i);
};

// ---------------------------------------------------------------- compiler control

function compilerControl(f: Frame): number {
  const j = spaces(0);
  if (text.charCodeAt(j) !== 35) return -1;
  const P = sub(f, PREPROCESSOR);
  for (const w of ["if", "elseif"]) {
    const k = j + 1 + w.length;
    if (!text.startsWith(w, j + 1)) continue;
    const m = spaces(k);
    if (m === k) continue;
    plain(P, 0, j);
    put(P, PREPROCESSOR_MARK, j, j + 1);
    put(P, PREPROCESSOR_KEYWORD, j + 1, k);
    plain(P, k, m);
    if (startsWord(m, "false")) {
      // #if false: the rest is a comment until #else, #elseif, or #endif.
      let n = m + 5;
      while (!eol(n) && !commentStart(n)) n++;
      put(P, BOOLEAN, m, m + 5);
      plain(P, m + 5, n);
      return open(f, sub(f, "comment.block.preprocessor.swift"), END_DISABLED, NEVER, n);
    }
    return open(P, P, END_CONDITION, CONDITION_DIRECTIVE_RULES, m);
  }
  const w = text.startsWith("else", j + 1)
    ? "else"
    : text.startsWith("endif", j + 1)
      ? "endif"
      : "";
  if (w) {
    const k = j + 1 + w.length;
    let n = k;
    while (!eol(n) && !commentStart(n)) n++;
    plain(P, 0, j);
    put(P, PREPROCESSOR_MARK, j, j + 1);
    put(P, PREPROCESSOR_KEYWORD, j + 1, k);
    notAllowed(P, k, n);
    return n;
  }
  if (!text.startsWith("sourceLocation(", j + 1)) return -1;
  // ^\s*(#)(sourceLocation)((\()([^)]*)(\)))(.*?)(?=$|//|/\*)
  const open_ = j + 15;
  const close = text.indexOf(")", open_);
  if (close < 0) return -1;
  let n = close + 1;
  while (!eol(n) && !commentStart(n)) n++;
  const S = sub(f, "meta.preprocessor.sourcelocation.swift");
  plain(S, 0, j);
  put(S, PREPROCESSOR_MARK, j, j + 1);
  put(S, SOURCE_LOCATION_KEYWORD, j + 1, open_);
  put(S, PARAMETERS_BEGIN, open_, open_ + 1);
  capture(S, open_ + 1, close, SOURCE_LOCATION_RULES);
  put(S, PARAMETERS_BEGIN, close, close + 1);
  notAllowed(S, close + 1, n);
  return n;
}
// \S+ as invalid in text[start, end).
function notAllowed(f: Frame, start: number, end: number) {
  for (let i = start; i < end;) {
    if (isSpace(text.charCodeAt(i))) {
      plain(f, i, ++i);
      continue;
    }
    let j = i + 1;
    while (j < end && !isSpace(text.charCodeAt(j))) j++;
    put(f, NOT_ALLOWED, i, j);
    i = j;
  }
}
const SOURCE_LOCATION_RULES: Rule = (f, i) => {
  const e = identRun(i);
  const w = e > 0 ? text.slice(i, e) : "";
  const j = spaces(e);
  const k = spaces(j + 1);
  if ((w === "file" || w === "line") && text.charCodeAt(j) === 58) {
    if (w === "file" && text.charCodeAt(k) === 34) {
      put(f, PARAMETER_LABEL, i, e);
      plain(f, e, j);
      put(f, KEY_VALUE, j, j + 1);
      plain(f, j + 1, k);
      return open(f, f, END_NOT_ANCHOR, LITERAL_RULES, k);
    }
    let n = k;
    while (isDigit(text.charCodeAt(n))) n++;
    if (w === "line" && n > k) {
      put(f, PARAMETER_LABEL, i, e);
      plain(f, e, j);
      put(f, KEY_VALUE, j, j + 1);
      plain(f, j + 1, k);
      put(f, INTEGER, k, n);
      return n;
    }
  }
  const c = text.charCodeAt(i);
  if (c === 44) {
    put(f, PARAMETER_SEPARATOR, i, i + 1);
    return i + 1;
  }
  if (isSpace(c) || c !== c) return -1;
  let n = i + 1;
  while (n < text.length && !isSpace(text.charCodeAt(n))) n++;
  put(f, NOT_ALLOWED, i, n);
  return n;
};
// (?=^\s*(#(e(?:lseif|lse|ndif)))\b)
const END_DISABLED: Rule = (_f, i) => {
  if (i !== 0) return -1;
  const j = spaces(0) + 1;
  if (text.charCodeAt(j - 1) !== 35) return -1;
  return startsWord(j, "elseif") || startsWord(j, "else") || startsWord(j, "endif") ? 0 : -1;
};
// (?=\s*/[*/])|$
const END_CONDITION: Rule = (_f, i) => (eol(i) || commentStart(blanks(i)) ? i : -1);
const CONDITION_DIRECTIVE_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if ((c === 38 || c === 124) && text.charCodeAt(i + 1) === c) {
    put(f, LOGICAL, i, i + 2);
    return i + 2;
  }
  if (!isIdStart(c) || !wordStart(i)) return -1;
  const e = identRun(i);
  const w = text.slice(i, e);
  if (w === "true" || w === "false") {
    put(f, BOOLEAN, i, e);
    return e;
  }
  const j = spaces(e);
  if (text.charCodeAt(j) !== 40) return -1;
  if (w === "arch" || w === "os" || w === "canImport") {
    const k = w === "canImport" ? j + 1 : spaces(j + 1);
    const n = w === "canImport" ? identRun(k) : wordRun(k);
    const m = w === "canImport" ? n : spaces(n);
    if (n <= k || text.charCodeAt(m) !== 41) return -1;
    const v = text.slice(k, n);
    const known =
      w === "canImport"
        ? MODULE
        : w === "arch"
          ? ARCHITECTURES.has(v)
            ? ARCHITECTURE
            : -1
          : OPERATING_SYSTEMS.has(v)
            ? PLATFORM_OS
            : -1;
    put(f, CONDITION, i, e);
    plain(f, e, j);
    put(f, PARAMETERS_BEGIN, j, j + 1);
    plain(f, j + 1, k);
    if (known >= 0) put(f, known, k, n);
    else plain(f, k, n);
    plain(f, n, m);
    put(f, PARAMETERS_END, m, m + 1);
    return m + 1;
  }
  if (w !== "targetEnvironment" && w !== "swift" && w !== "compiler") return -1;
  put(f, CONDITION, i, e);
  plain(f, e, j);
  put(f, PARAMETERS_BEGIN, j, j + 1);
  return open(
    f,
    f,
    END_CONDITION_CALL,
    w === "targetEnvironment" ? ENVIRONMENT_RULES : VERSION_CONDITION_RULES,
    j + 1,
  );
};
const ARCHITECTURES = new Set("arm arm64 powerpc64 powerpc64le i386 x86_64 s390x".split(" "));
const OPERATING_SYSTEMS = new Set(
  "macOS OSX iOS tvOS watchOS visionOS Android Linux FreeBSD Windows PS4".split(" "),
);
// (\))|$
const END_CONDITION_CALL: Rule = (f, i) => {
  if (text.charCodeAt(i) === 41) {
    put(f, PARAMETERS_END, i, i + 1);
    return i + 1;
  }
  return eol(i) ? i : -1;
};
const ENVIRONMENT_RULES: Rule = (f, i) => {
  if (isWordAt(i, "simulator")) {
    put(f, ENVIRONMENT, i, i + 9);
    return i + 9;
  }
  if (isWordAt(i, "UIKitForMac")) {
    put(f, ENVIRONMENT, i, i + 11);
    return i + 11;
  }
  return -1;
};
const VERSION_CONDITION_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 62 && text.charCodeAt(i + 1) === 61) {
    put(f, COMPARISON, i, i + 2);
    return i + 2;
  }
  if (c === 60) {
    put(f, COMPARISON, i, i + 1);
    return i + 1;
  }
  if (!wordStart(i)) return -1;
  const n = version(i);
  if (n < 0) return -1;
  put(f, NUMERIC, i, n);
  return n;
};

// ---------------------------------------------------------------- regexes

// (/)(?!\s)(?!/)(?:\\\s(?=/)|(?<guts>...)?+(?<!\s))(/)
function regexLine(f: Frame, i: number): number {
  const c = text.charCodeAt(i + 1);
  if (c === 47 || isSpace(c)) return -1;
  let end = -1;
  if (c === 92 && isSpace(text.charCodeAt(i + 2)) && text.charCodeAt(i + 3) === 47) end = i + 3;
  else {
    const k = regexBody(i + 1, "/");
    const m = k < 0 ? i + 1 : k;
    if (!isSpace(text.charCodeAt(m - 1)) && text.charCodeAt(m) === 47) end = m;
  }
  if (end < 0) return -1;
  capture(sub(f, "string.regexp.line.swift"), i, end + 1, REGEX_RULES);
  return end + 1;
}
// Regexes that start with "#": (#+)/\n blocks, then extended literals.
function hashRegex(f: Frame, i: number): number {
  const j = hashRun(i);
  if (text.charCodeAt(j) !== 47) return -1;
  const hashes = text.slice(i, j);
  if (j + 1 === text.length - 1) {
    const B = sub(f, "string.regexp.block.swift");
    plain(B, i, j + 2);
    const close = `/${hashes}`;
    const end: Rule = (g, k) =>
      text.startsWith(close, k) ? (plain(g, k, k + close.length), k + close.length) : -1;
    return open(B, B, end, REGEX_BLOCK_RULES, j + 2);
  }
  // ((#+)/)(guts)?+(/\2)|#+/.+(\n)
  const close = `/${hashes}`;
  const k = regexBody(j + 1, close);
  const m = k < 0 ? j + 1 : k;
  let end = -1;
  if (text.startsWith(close, m)) end = m + close.length;
  else if (j + 1 < text.length - 1 && text.charCodeAt(text.length - 1) === 10) end = text.length;
  if (end < 0) return -1;
  capture(sub(f, "string.regexp.line.extended.swift"), i, end, REGEX_RULES);
  return end;
}
// The grammar's (?<guts>...) group from i: its end, or -1 if empty. It is
// atomic and possessive, so it never gives text back.
function regexBody(i: number, close: string): number {
  let k = i;
  for (;;) {
    const c = text.charCodeAt(k);
    let next = -1;
    if (c === 92 && text.charCodeAt(k + 1) === 81) {
      // \\Q(?:(?!\\E)(?!/).)*+(?:\\E|(?=/))
      let j = k + 2;
      while (!eol(j) && !text.startsWith("\\E", j) && !text.startsWith(close, j)) j++;
      if (text.startsWith("\\E", j)) next = j + 2;
      else if (text.startsWith(close, j)) next = j;
    }
    if (next < 0 && c === 92 && !eol(k + 1)) next = k + 2;
    else if (next < 0 && c === 40) {
      if (text.startsWith("(?#", k)) {
        const j = text.indexOf(")", k + 3);
        if (j >= 0) next = j + 1;
      }
      if (next < 0) {
        const j = regexBody(k + 1, close);
        const m = j < 0 ? k + 1 : j;
        if (text.charCodeAt(m) === 41) next = m + 1;
      }
    } else if (next < 0 && c === 91) next = regexClass(k, 4);
    else if (next < 0 && c === c && c !== 41 && !text.startsWith(close, k)) {
      let j = k;
      for (
        let d = c;
        d === d && d !== 40 && d !== 41 && d !== 91 && d !== 92 && !text.startsWith(close, j);
      )
        d = text.charCodeAt(++j);
      if (j > k) next = j;
    }
    if (next < 0) return k > i ? k : -1;
    k = next;
  }
}
// \[(?:\\.|[^]\[\\]|<nested class>)+] with classes nested `depth` deep.
function regexClass(i: number, depth: number): number {
  if (text.charCodeAt(i) !== 91) return -1;
  let k = i + 1;
  for (;;) {
    const c = text.charCodeAt(k);
    if (c !== c) return -1;
    if (c === 92) {
      if (eol(k + 1)) return -1;
      k += 2;
    } else if (c === 91) {
      if (depth <= 1) return -1;
      const j = regexClass(k, depth - 1);
      if (j < 0) break;
      k = j;
    } else if (c === 93) break;
    else k++;
  }
  return k > i + 1 && text.charCodeAt(k) === 93 ? k + 1 : -1;
}
const REGEX_BLOCK_RULES: Rule = (f, i, g) => {
  const r = REGEX_RULES(f, i, g);
  if (r >= 0 || text.charCodeAt(i) !== 35) return r;
  // (#).*$
  const end = text.length - 1;
  put(f, RX_LINE_COMMENT_MARK, i, i + 1);
  put(f, RX_LINE_COMMENT, i + 1, end);
  return end;
};
// The regex-guts patterns inside a regex literal.
const REGEX_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  switch (c) {
    case 92:
      return regexEscape(f, i);
    case 40:
      return regexGroup(f, i);
    case 60:
      if (text.charCodeAt(i + 1) !== 123) return -1;
      {
        const E = sub(f, "meta.embedded.expression.regexp");
        put(E, RX_EMBEDDED_BEGIN, i, i + 2);
        const end: Rule = (g, k) =>
          text.charCodeAt(k) === 125 && text.charCodeAt(k + 1) === 62
            ? (put(g, RX_EMBEDDED_END, k, k + 2), k + 2)
            : -1;
        return open(E, E, end, NEVER, i + 2);
      }
    case 36:
    case 94:
      put(f, RX_ANCHOR, i, i + 1);
      return i + 1;
    case 46:
      put(f, RX_CLASS, i, i + 1);
      return i + 1;
    case 124:
      put(f, RX_OR, i, i + 1);
      return i + 1;
    case 42:
    case 43:
    case 63:
      put(f, RX_QUANTIFIER, i, i + 1);
      return i + 1;
    case 123: {
      const m = /\{(?:\s*\d+\s*(?:,\s*\d*\s*)?\}|\s*,\s*\d+\s*\})/y;
      m.lastIndex = i;
      if (!m.test(text)) return -1;
      put(f, RX_QUANTIFIER, i, m.lastIndex);
      return m.lastIndex;
    }
    case 91: {
      const r = regexPosixClass(f, i);
      return r >= 0 ? r : regexCustomClass(f, i);
    }
  }
  return -1;
};
function regexEscape(f: Frame, i: number): number {
  const d = text.charCodeAt(i + 1);
  if (d === 81) {
    const Q = sub(f, "string.quoted.other.regexp.swift");
    put(Q, RX_ESCAPE, i, i + 2);
    return open(Q, Q, END_REGEX_QUOTE, NEVER, i + 2);
  }
  let m =
    /\\(?:u\{\s*(?:[0-9A-Fa-f]+\s*)+\}|u[0-9A-Fa-f]{4}|x\{[0-9A-Fa-f]+\}|x[0-9A-Fa-f]{0,2}|U[0-9A-Fa-f]{8}|o\{[0-7]+\}|0[0-7]{0,3}|N\{(?:U\+[0-9A-Fa-f]{1,8}|[-\s\w]+)\})/y;
  m.lastIndex = i;
  if (m.test(text)) {
    put(f, RX_NUMERIC, i, m.lastIndex);
    return m.lastIndex;
  }
  m = /\\[Pp]\{([-\s\w]+(?:=[-\s\w]+)?)\}/y;
  m.lastIndex = i;
  const p = m.exec(text);
  if (p) {
    const S = sub(f, RX_SET);
    plain(S, i, i + 3);
    put(f, RX_PROPERTY, i + 3, i + 3 + p[1]!.length);
    plain(S, m.lastIndex - 1, m.lastIndex);
    return m.lastIndex;
  }
  if ("ABGYZbyzK".includes(char(d))) {
    put(f, RX_ANCHOR, i, i + 2);
    return i + 2;
  }
  m = /\\[gk]<(?:((?!\d)\w+)(?:[-+]\d+)?|[-+]?\d+(?:[-+]\d+)?)>/y;
  m.lastIndex = i;
  const b = m.exec(text);
  if (b) {
    put(f, RX_ESCAPE, i, i + 3);
    put(f, b[1] ? RX_GROUP_NAME : RX_GROUP_NUMBER, i + 3, m.lastIndex - 1);
    put(f, RX_ESCAPE, m.lastIndex - 1, m.lastIndex);
    return m.lastIndex;
  }
  if (d >= 49 && d <= 57 && isDigit(text.charCodeAt(i + 2))) {
    let j = i + 3;
    while (isDigit(text.charCodeAt(j))) j++;
    put(f, RX_BACK_REFERENCE, i, j);
    return j;
  }
  if ("CDHNORSVWXdhsvw".includes(char(d))) {
    put(f, RX_CLASS, i, i + 2);
    return i + 2;
  }
  if (d === 99) {
    if (eol(i + 2)) return -1;
    put(f, RX_CONTROL, i, i + 3);
    return i + 3;
  }
  if (eol(i + 1)) return -1;
  put(f, RX_ESCAPE, i, i + 2);
  return i + 2;
}
// \\E|(\n)
const END_REGEX_QUOTE: Rule = (f, i) => {
  if (text.startsWith("\\E", i)) {
    put(f, RX_ESCAPE, i, i + 2);
    return i + 2;
  }
  if (text.charCodeAt(i) !== 10) return -1;
  put(f, RX_RETURN, i, i + 1);
  return i + 1;
};
// (\[:)(name)(:]) at i.
function regexPosixClass(f: Frame, i: number): number {
  const m = /\[:([-\s\w]+(?:=[-\s\w]+)?):\]/y;
  m.lastIndex = i;
  const p = m.exec(text);
  if (!p) return -1;
  put(f, RX_PROPERTY_MARK, i, i + 2);
  put(f, RX_PROPERTY, i + 2, m.lastIndex - 2);
  put(f, RX_PROPERTY_MARK, m.lastIndex - 2, m.lastIndex);
  return m.lastIndex;
}
// (\[)(\^)? ... ]
function regexCustomClass(f: Frame, i: number): number {
  const C = sub(f, RX_SET);
  put(C, RX_CLASS_MARK, i, i + 1);
  let j = i + 1;
  if (text.charCodeAt(j) === 94) put(C, RX_NEGATION, j, ++j);
  return open(C, C, END_RX_CLASS, REGEX_CLASS_RULES, j);
}
const REGEX_CLASS_RULES: Rule = (f, i) => {
  const c = text.charCodeAt(i);
  if (c === 92) {
    if (text.charCodeAt(i + 1) === 98) {
      put(f, RX_ESCAPE, i, i + 2);
      return i + 2;
    }
    if (text.charCodeAt(i + 1) === 81) return regexEscape(f, i);
    const d = text.charCodeAt(i + 1);
    if (
      d === 117 ||
      d === 120 ||
      d === 85 ||
      d === 111 ||
      d === 48 ||
      d === 78 ||
      d === 80 ||
      d === 112
    ) {
      const s =
        /\\(?:u\{\s*(?:[0-9A-Fa-f]+\s*)+\}|u[0-9A-Fa-f]{4}|x\{[0-9A-Fa-f]+\}|x[0-9A-Fa-f]{0,2}|U[0-9A-Fa-f]{8}|o\{[0-7]+\}|0[0-7]{0,3}|N\{(?:U\+[0-9A-Fa-f]{1,8}|[-\s\w]+)\}|[Pp]\{[-\s\w]+(?:=[-\s\w]+)?\})/y;
      s.lastIndex = i;
      if (s.test(text)) return regexEscape(f, i);
    }
    return -1;
  }
  if (c === 91) {
    const r = regexPosixClass(f, i);
    return r >= 0 ? r : regexCustomClass(f, i);
  }
  const l = RX_SET_OPERATORS[text.slice(i, i + 2)];
  if (l === undefined) return -1;
  put(f, l, i, i + 2);
  return i + 2;
};
function regexGroup(f: Frame, i: number): number {
  if (text.startsWith("(?#", i)) {
    const C = sub(f, "comment.block.regexp");
    put(C, RX_COMMENT_BEGIN, i, i + 3);
    return open(C, C, END_RX_COMMENT, NEVER, i + 3);
  }
  const toggle =
    /\(\?(?:\^(?:[DJPSUWimnswx]|xx|y\{[gw]\})*|(?:[DJPSUWimnswx]|xx|y\{[gw]\})+|(?:[DJPSUWimnswx]|xx|y\{[gw]\})*-(?:[DJPSUWimnswx]|xx|y\{[gw]\})*)\)/y;
  toggle.lastIndex = i;
  if (toggle.test(text)) {
    put(f, RX_TOGGLE, i, toggle.lastIndex);
    return toggle.lastIndex;
  }
  if (text.startsWith("(?~", i)) {
    const A = sub(f, "meta.group.absent.regexp");
    put(A, RX_GROUP_MARK, i, i + 1);
    put(A, RX_ABSENT, i + 1, i + 3);
    return open(A, A, END_RX_GROUP, REGEX_RULES, i + 3);
  }
  const G = sub(f, "meta.group.regexp");
  put(G, RX_GROUP_MARK, i, i + 1);
  let j = i + 1;
  const options =
    /\?(?:([!*:=>|]|<[!*=])|P?<((?!\d)\w+)>|'((?!\d)\w+)'|(?:[DJPSUWimnswx]|xx)*(?:-(?:[DJPSUWimnswx]|xx)*)?:)/y;
  options.lastIndex = j;
  const o = options.exec(text);
  if (o) {
    put(G, RX_OPTIONS_MARK, j, j + 1);
    const end = options.lastIndex;
    const groupName = o[2] ?? o[3];
    if (o[1]) put(G, RX_OPTIONS_MARK, j + 1, end);
    else if (groupName) {
      const at = text.indexOf(groupName, j + 1);
      put(G, RX_OPTIONS, j + 1, at);
      put(G, RX_OPTIONS_NAME, at, at + groupName.length);
      put(G, RX_OPTIONS, at + groupName.length, end);
    } else put(G, RX_OPTIONS, j + 1, end);
    j = end;
  }
  return open(G, G, END_RX_GROUP, REGEX_RULES, j);
}

function scan(input: string): TokenizeResult {
  source = input;
  length = input.length;
  nextStart = 0;
  done = false;
  depth = 0;
  failedUntil = -1;
  hashLine = -1;
  out = createWriter(length, types);
  line = 0;
  nextLine();
  region(ROOT, ROOT, NEVER, ROOT_RULES, 0, -1, line);
  return out.result();
}

export const tokenize = (_options?: { fidelity?: string }) => scan;
