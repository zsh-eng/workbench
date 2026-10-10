import type { Element, ElementContent, Properties, Root } from "hast";

export interface AdapterTheme {
  name?: string;
  type?: string;
  fg?: string;
  bg?: string;
  colors?: Record<string, string>;
  tokenColors?: ThemeRule[];
  settings?: ThemeRule[];
}
interface ThemeRule {
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}
export interface Tokenization {
  tokens: Uint32Array;
  token_types: readonly string[];
}
export interface AdapterOptions {
  tokenize(source: string, lang: string): Tokenization | undefined;
  getTheme(name: string): AdapterTheme;
}
export interface StyledToken {
  content: string;
  offset: number;
  __lineChar: number;
  color?: string;
  fontStyle?: number;
  htmlStyle?: Record<string, string>;
  htmlAttrs?: Properties;
}
interface Context {
  addClassToHast(node: Element, ...classes: string[]): Element;
}
interface Transformer {
  preprocess?(this: Context, source: string, options: HighlightOptions): string | void;
  tokens?(this: Context, lines: StyledToken[][]): StyledToken[][] | void;
  span?(
    this: Context,
    node: Element,
    line: number,
    column: number,
    parent: Element,
    token: StyledToken,
  ): Element | void;
  line?(this: Context, node: Element, line: number): Element | void;
  code?(this: Context, node: Element): Element | void;
  pre?(this: Context, node: Element): Element | void;
  root?(this: Context, node: Root): Root | void;
}
interface Decoration {
  start: { line: number; character: number };
  end: { line: number; character: number };
  properties?: Properties;
}
export interface HighlightOptions {
  lang: string;
  theme?: string;
  themes?: Record<string, string>;
  cssVariablePrefix?: string;
  defaultColor?: string | false;
  tokenizeMaxLineLength?: number;
  mergeWhitespaces?: boolean | "never";
  transformers?: Transformer[];
  decorations?: Decoration[];
}
const element = (
  tagName: string,
  children: ElementContent[] = [],
  properties: Properties = {},
): Element => ({ type: "element", tagName, properties, children });

// Twinkleplop has semantic token kinds rather than TextMate scope stacks. Match
// these representative scopes to the user's existing theme without a tokenizer.
const scopes: Record<string, string> = {
  boolean: "constant.language.boolean",
  null: "constant.language.null",
  number: "constant.numeric",
  bit: "constant.numeric",
  keyword: "keyword.control",
  operator: "keyword.operator",
  directive: "keyword.control.directive",
  expression: "keyword.operator",
  comment: "comment",
  doctype: "comment",
  hash: "comment",
  label: "comment",
  string: "string.quoted",
  template: "string.template",
  regex: "string.regexp",
  string_escape: "constant.character.escape",
  escape: "constant.character.escape",
  identifier: "variable.other",
  variable: "variable.other",
  parameter: "variable.parameter",
  property: "variable.other.property",
  constant: "variable.other.constant",
  function: "entity.name.function",
  class_name: "entity.name.type.class",
  type: "entity.name.type",
  namespace: "entity.name.namespace",
  builtin: "support.function",
  variant: "constant.other.enum",
  decorator: "entity.name.function.decorator",
  punctuation: "punctuation",
  attribute: "entity.other.attribute-name",
  attr_name: "entity.other.attribute-name",
  tag_name: "entity.name.tag",
  entity: "constant.character.entity",
  selector: "entity.name.tag",
  selector_class: "entity.other.attribute-name.class",
  selector_id: "entity.other.attribute-name.id",
  selector_pseudo: "entity.other.attribute-name.pseudo-class",
  css_variable: "variable.other",
  unit: "keyword.other.unit",
  heading: "markup.heading",
  heading_marker: "markup.heading",
  bold: "markup.bold",
  italic: "markup.italic",
  strike: "markup.strikethrough",
  code: "markup.inline.raw",
  code_block: "markup.raw.block",
  code_language: "markup.raw.block",
  url: "markup.underline.link",
  url_link: "markup.underline.link",
  autolink: "markup.underline.link",
  link_text: "string.other.link",
  url_title: "string.other.link",
  inserted: "markup.inserted",
  inserted_marker: "markup.inserted",
  deleted: "markup.deleted",
  deleted_marker: "markup.deleted",
  changed: "markup.changed",
  changed_marker: "markup.changed",
  datetime: "constant.numeric",
  lifetime: "storage.modifier",
  tag: "entity.name.tag",
  list_marker: "punctuation.definition.list",
  task_marker: "markup.list",
  blockquote_marker: "punctuation.definition.quote",
};
function fontBits(style: string) {
  return (
    (style.includes("italic") ? 1 : 0) |
    (style.includes("bold") ? 2 : 0) |
    (style.includes("underline") ? 4 : 0) |
    (style.includes("strikethrough") ? 8 : 0)
  );
}
function fontCSS(bits: number): Record<string, string> {
  return {
    "font-style": bits & 1 ? "italic" : "normal",
    "font-weight": bits & 2 ? "bold" : "normal",
    "text-decoration":
      [bits & 4 ? "underline" : "", bits & 8 ? "line-through" : ""].filter(Boolean).join(" ") ||
      "none",
  };
}

// Theme rules resolved as vscode-textmate resolves them for Shiki. A rule's last
// selector part applies to the scopes it prefixes, and its other parts must
// match enclosing scopes in order (`>` for the direct parent). At each depth of
// a scope stack the most specific rule wins: the deepest last part, then the
// longest parent parts. Its settings override those of the enclosing scopes.
const UNSET = -1;
interface TrieRule {
  depth: number;
  parents: string[];
  fontStyle: number;
  foreground: string;
}
interface ParsedRule {
  scope: string;
  parents: string[] | null;
  index: number;
  fontStyle: number;
  foreground: string;
}
const matchesScope = (scope: string, pattern: string) =>
  scope === pattern || (scope.startsWith(pattern) && scope[pattern.length] === ".");
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function compareParents(a: string[] | null, b: string[] | null) {
  if (!a || !b) return a === b ? 0 : a ? 1 : -1;
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) {
    const order = compareText(a[i]!, b[i]!);
    if (order) return order;
  }
  return 0;
}
function bySpecificity(a: TrieRule, b: TrieRule) {
  if (a.depth !== b.depth) return b.depth - a.depth;
  for (let i = 0, j = 0; ; i++, j++) {
    if (a.parents[i] === ">") i++;
    if (b.parents[j] === ">") j++;
    if (i >= a.parents.length || j >= b.parents.length) break;
    const longer = b.parents[j]!.length - a.parents[i]!.length;
    if (longer) return longer;
  }
  return b.parents.length - a.parents.length;
}
function parentsMatch(stack: readonly string[], from: number, parents: string[]) {
  let k = from;
  for (let p = 0; p < parents.length; p++) {
    let pattern = parents[p]!;
    const direct = pattern === ">";
    if (direct) {
      if (p === parents.length - 1) return false;
      pattern = parents[++p]!;
    }
    while (k >= 0 && !matchesScope(stack[k]!, pattern)) {
      if (direct) return false;
      k--;
    }
    if (k < 0) return false;
    k--;
  }
  return true;
}
function themeResolver(rules: ThemeRule[]) {
  const parsed: ParsedRule[] = [];
  // Rules without a scope give the defaults.
  let defaultForeground = "";
  let defaultFontStyle = 0;
  rules.forEach((rule, index) => {
    const entries =
      typeof rule.scope === "string"
        ? rule.scope.replace(/^,+|,+$/g, "").split(",")
        : (rule.scope ?? [""]);
    // Some theme files have rules without settings.
    const settings = rule.settings ?? {};
    const fontStyle = typeof settings.fontStyle === "string" ? fontBits(settings.fontStyle) : UNSET;
    const foreground = settings.foreground ?? "";
    for (const entry of entries) {
      const segments = entry.trim().split(" ");
      const scope = segments.at(-1)!;
      if (!scope) {
        if (foreground) defaultForeground = foreground;
        if (fontStyle !== UNSET) defaultFontStyle = fontStyle;
        continue;
      }
      const parents = segments.length > 1 ? segments.slice(0, -1).reverse() : null;
      parsed.push({ scope, parents, index, fontStyle, foreground });
    }
  });
  // Insertion order: a prefix scope first, rules without parents first.
  parsed.sort(
    (a, b) =>
      compareText(a.scope, b.scope) || compareParents(a.parents, b.parents) || a.index - b.index,
  );
  const byScope = new Map<string, ParsedRule[]>();
  const prefixes = new Set<string>();
  for (const rule of parsed) {
    const list = byScope.get(rule.scope);
    if (list) list.push(rule);
    else byScope.set(rule.scope, [rule]);
    for (let dot = rule.scope.indexOf("."); dot >= 0; dot = rule.scope.indexOf(".", dot + 1))
      prefixes.add(rule.scope.slice(0, dot));
    prefixes.add(rule.scope);
  }
  // A trie node copies its parent's rules, then adds the rules for its path.
  type Node = { main: TrieRule; withParents: TrieRule[]; sorted: TrieRule[] };
  const rootRule: TrieRule = {
    depth: 0,
    parents: [],
    fontStyle: UNSET,
    foreground: "",
  };
  const root: Node = { main: rootRule, withParents: [], sorted: [rootRule] };
  const nodes = new Map<string, Node>();
  const accept = (rule: TrieRule, depth: number, from: ParsedRule) => {
    rule.depth = depth;
    if (from.fontStyle !== UNSET) rule.fontStyle = from.fontStyle;
    if (from.foreground) rule.foreground = from.foreground;
  };
  const node = (path: string): Node => {
    if (!path) return root;
    let cached = nodes.get(path);
    if (cached) return cached;
    const dot = path.lastIndexOf(".");
    const parent = node(dot < 0 ? "" : path.slice(0, dot));
    const depth = path.split(".").length;
    const main = { ...parent.main };
    const withParents = parent.withParents.map((rule) => ({ ...rule }));
    for (const rule of byScope.get(path) ?? []) {
      if (!rule.parents) {
        accept(main, depth, rule);
        continue;
      }
      const same = withParents.find((r) => compareParents(r.parents, rule.parents) === 0);
      if (same) accept(same, depth, rule);
      else
        withParents.push({
          depth,
          parents: rule.parents,
          fontStyle: rule.fontStyle !== UNSET ? rule.fontStyle : main.fontStyle,
          foreground: rule.foreground || main.foreground,
        });
    }
    cached = {
      main,
      withParents,
      sorted: [...withParents, main].sort(bySpecificity),
    };
    nodes.set(path, cached);
    return cached;
  };
  const matches = new Map<string, TrieRule[]>();
  const rulesFor = (scope: string) => {
    let found = matches.get(scope);
    if (found) return found;
    let path = "";
    for (let start = 0; ;) {
      const dot = scope.indexOf(".", start);
      const next = dot < 0 ? scope : scope.slice(0, dot);
      if (!prefixes.has(next)) break;
      path = next;
      if (dot < 0) break;
      start = dot + 1;
    }
    found = node(path).sorted;
    matches.set(scope, found);
    return found;
  };
  return (stack: readonly string[]) => {
    let foreground = defaultForeground;
    let fontStyle = defaultFontStyle;
    for (let k = 0; k < stack.length; k++) {
      const rule = rulesFor(stack[k]!).find((r) => parentsMatch(stack, k - 1, r.parents))!;
      if (rule.foreground) foreground = rule.foreground;
      if (rule.fontStyle !== UNSET) fontStyle = rule.fontStyle;
    }
    return { foreground, fontStyle };
  };
}

/** The version-pinned HAST contract used by Pierre's file and diff renderers. */
export function createTwinkleplopAdapter(dependencies: AdapterOptions) {
  const themes = new Map<
    string,
    AdapterTheme & { name: string; fg: string; bg: string; type: string }
  >();
  const styles = new Map<string, { color: string; fontStyle: number }>();
  const resolvers = new Map<string, ReturnType<typeof themeResolver>>();
  function getTheme(name: string) {
    let theme = themes.get(name);
    if (!theme) {
      const raw = dependencies.getTheme(name);
      const defaults = (raw.tokenColors ?? raw.settings ?? [])
        .filter((rule) => !rule.scope)
        .reduce((all, rule) => ({ ...all, ...rule.settings }), {} as ThemeRule["settings"]);
      const type = raw.type ?? "dark";
      theme = {
        ...raw,
        name: raw.name ?? name,
        type,
        colors: raw.colors ?? {},
        fg:
          raw.fg ??
          raw.colors?.["editor.foreground"] ??
          defaults.foreground ??
          (type === "light" ? "#24292e" : "#e1e4e8"),
        bg:
          raw.bg ??
          raw.colors?.["editor.background"] ??
          defaults.background ??
          (type === "light" ? "#ffffff" : "#24292e"),
      };
      themes.set(name, theme);
    }
    return theme;
  }
  function tokenStyle(name: string, kind: string) {
    const key = `${name}\0${kind}`;
    let cached = styles.get(key);
    if (cached) return cached;
    const theme = getTheme(name);
    const scopeStack = kind
      .split("|")
      .map(
        (part) =>
          scopes[part] ??
          scopes[part.replace(/_(?:open|close)$/, "")] ??
          (part.includes(".") ? part : "variable.other"),
      );
    let resolve = resolvers.get(name);
    if (!resolve) {
      resolve = themeResolver(theme.tokenColors ?? theme.settings ?? []);
      resolvers.set(name, resolve);
    }
    const { foreground, fontStyle } = resolve(scopeStack);
    cached = { color: foreground || theme.fg, fontStyle };
    styles.set(key, cached);
    return cached;
  }
  const createContext = (): Context => ({
    addClassToHast(node, ...classes) {
      const existing = node.properties.class ?? node.properties.className;
      node.properties.class = [
        ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
        ...classes,
      ].join(" ");
      return node;
    },
  });

  function codeToTokens(
    input: string,
    options: HighlightOptions,
    context = createContext(),
  ): StyledToken[][] {
    const transformers = options.transformers ?? [];
    let source = input.replace(/\r\n?/g, "\n");
    for (const transform of transformers)
      source = transform.preprocess?.call(context, source, options) ?? source;
    const result =
      options.lang === "text" || options.lang === "plaintext"
        ? undefined
        : dependencies.tokenize(source, options.lang);
    const spans: { start: number; end: number; kind: string }[] = [];
    let cursor = 0;
    if (result) {
      for (let index = 0; index < result.tokens.length; index += 3) {
        const kind = result.tokens[index];
        const start = result.tokens[index + 1];
        const end = result.tokens[index + 2];
        if (start < cursor || end < start || end > source.length)
          throw new Error("Invalid Twinkleplop token range");
        if (start > cursor) spans.push({ start: cursor, end: start, kind: "plain" });
        if (end > start) spans.push({ start, end, kind: result.token_types[kind] ?? "plain" });
        cursor = end;
      }
    }
    if (cursor < source.length) spans.push({ start: cursor, end: source.length, kind: "plain" });
    const selectedThemes = options.themes
      ? Object.entries(options.themes)
      : [["", options.theme ?? ""]];
    type Style = Pick<StyledToken, "color" | "fontStyle"> & { htmlStyle: Record<string, string> };
    const kindStyles = new Map<string, Style>();
    const equivalentStyles = new Map<string, Style>();
    const styleFor = (kind: string): Style => {
      const cached = kindStyles.get(kind);
      if (cached) return cached;
      const token: Style = { htmlStyle: {} };
      for (const [mode, name] of selectedThemes) {
        const style =
          kind === "plain" ? { color: getTheme(name).fg, fontStyle: 0 } : tokenStyle(name, kind);
        if (!mode) {
          token.color = style.color;
          token.fontStyle = style.fontStyle;
          token.htmlStyle.color = style.color;
          if (style.fontStyle) Object.assign(token.htmlStyle, fontCSS(style.fontStyle));
        } else {
          const prefix = `${options.cssVariablePrefix ?? "--shiki-"}${mode}`;
          token.htmlStyle[prefix] = style.color;
          if (style.fontStyle)
            for (const [property, value] of Object.entries(fontCSS(style.fontStyle)))
              token.htmlStyle[`${prefix}-${property}`] = value;
        }
      }
      const key = JSON.stringify(token);
      const style = equivalentStyles.get(key) ?? token;
      equivalentStyles.set(key, style);
      kindStyles.set(kind, style);
      return style;
    };
    let offset = 0;
    let spanIndex = 0;
    let lines = source.split("\n").map((line) => {
      const end = offset + line.length;
      const tokens: StyledToken[] = [];
      let previousStyle: Style | undefined;
      const addToken = (content: string, start: number, column: number, kind: string) => {
        const style = styleFor(kind);
        const previous = tokens[tokens.length - 1];
        // Coalesce equal visible styles before Pierre adds character offsets
        // and diff decorations. Each emitted token owns its mutable style.
        if (previous && style === previousStyle) previous.content += content;
        else
          tokens.push({
            content,
            offset: start,
            __lineChar: column,
            ...style,
            htmlStyle: { ...style.htmlStyle },
          });
        previousStyle = style;
      };
      // Parse the whole source first: a long line can change the grammar state
      // of the next line. Only its rendered tokens are reduced to plain text.
      if (options.tokenizeMaxLineLength && line.length > options.tokenizeMaxLineLength) {
        if (line.length) addToken(line, offset, 0, "plain");
      } else {
        while (spanIndex < spans.length && spans[spanIndex].end <= offset) spanIndex++;
        for (let index = spanIndex; index < spans.length && spans[index].start < end; index++) {
          const span = spans[index];
          const start = Math.max(offset, span.start);
          const stop = Math.min(end, span.end);
          const value = source.slice(start, stop);
          // Pierre requests unstyled edge whitespace for selectable tokens.
          const match =
            options.mergeWhitespaces === "never" && /^(\s*)(\S[\s\S]*?)(\s*)$/.exec(value);
          if (match && (match[1] || match[3])) {
            if (match[1]) addToken(match[1], start, start - offset, "plain");
            addToken(
              match[2],
              start + match[1].length,
              start + match[1].length - offset,
              span.kind,
            );
            if (match[3])
              addToken(match[3], stop - match[3].length, stop - match[3].length - offset, "plain");
          } else addToken(value, start, start - offset, span.kind);
        }
      }
      offset = end + 1;
      return tokens;
    });
    for (const transform of transformers) lines = transform.tokens?.call(context, lines) ?? lines;
    return lines;
  }
  return {
    getTheme,
    codeToTokens,
    codeToHast(input: string, options: HighlightOptions): Root {
      const transformers = options.transformers ?? [];
      const context = createContext();
      const lines = codeToTokens(input, options, context);
      const decorations = new Map<number, Decoration[]>();
      for (const decoration of options.decorations ?? []) {
        for (
          let line = Math.max(0, decoration.start.line);
          line <= Math.min(lines.length - 1, decoration.end.line);
          line++
        ) {
          const items = decorations.get(line) ?? [];
          items.push(decoration);
          decorations.set(line, items);
        }
      }
      let code = element("code");
      for (const [lineIndex, tokens] of lines.entries()) {
        let line = element("span", [], { class: "line" });
        const marks = (decorations.get(lineIndex) ?? []).map((decoration) => ({
          start: decoration.start.line === lineIndex ? decoration.start.character : 0,
          end: decoration.end.line === lineIndex ? decoration.end.character : Infinity,
          properties: decoration.properties,
        }));
        for (const token of tokens) {
          if (!token.content.length) continue;
          const start = token.__lineChar;
          const end = start + token.content.length;
          const cuts = marks.length
            ? [
                ...new Set([
                  start,
                  end,
                  ...marks
                    .flatMap((mark) => [mark.start, mark.end])
                    .filter((cut) => cut > start && cut < end),
                ]),
              ].sort((a, b) => a - b)
            : [start, end];
          for (let index = 0; index < cuts.length - 1; index++) {
            const from = cuts[index];
            const to = cuts[index + 1];
            let span = element(
              "span",
              [{ type: "text", value: token.content.slice(from - start, to - start) }],
              {
                ...token.htmlAttrs,
                style: Object.entries(token.htmlStyle ?? {})
                  .map(([property, value]) => `${property}:${value}`)
                  .join(";"),
              },
            );
            for (const transform of transformers)
              span = transform.span?.call(context, span, lineIndex + 1, from, line, token) ?? span;
            for (const mark of marks)
              if (from >= mark.start && to <= mark.end)
                span = element("span", [span], mark.properties);
            line.children.push(span);
          }
        }
        for (const transform of transformers)
          line = transform.line?.call(context, line, lineIndex + 1) ?? line;
        code.children.push(line);
      }
      for (const transform of transformers) code = transform.code?.call(context, code) ?? code;
      let pre = element("pre", [code]);
      for (const transform of transformers) pre = transform.pre?.call(context, pre) ?? pre;
      let root: Root = { type: "root", children: [pre] };
      for (const transform of transformers) root = transform.root?.call(context, root) ?? root;
      return root;
    },
  };
}
