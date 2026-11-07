import type { SyntaxTheme } from "./themes";

export interface ZedSyntaxStyle {
  color?: string;
  font_style?: "italic";
  font_weight?: 700;
}

/**
 * Pierre's highlighter names tokens with tree-sitter captures, as Zed themes
 * do; Med's own syntax themes are TextMate scope rules. Each capture reads the
 * rule that TextMate would apply to its usual scope. A capture with no rule
 * takes its parent's style (`function.builtin` falls back to `function`).
 */
const captureScopes: Record<string, string> = {
  comment: "comment.line",
  "comment.doc": "comment.block.documentation",
  string: "string.quoted",
  "string.escape": "constant.character.escape",
  "string.regex": "string.regexp",
  "string.special": "string.other",
  "string.special.symbol": "constant.other.symbol",
  "string.template": "string.template",
  number: "constant.numeric",
  boolean: "constant.language.boolean",
  constant: "variable.other.constant",
  "constant.builtin": "constant.language",
  keyword: "keyword.control",
  "keyword.operator": "keyword.operator",
  "keyword.directive": "keyword.control.directive",
  "keyword.important": "keyword.other.important",
  operator: "keyword.operator",
  function: "entity.name.function",
  "function.builtin": "support.function",
  type: "entity.name.type",
  "type.builtin": "support.type.primitive",
  constructor: "entity.name.type.class",
  enum: "entity.name.type.enum",
  variant: "variable.other.enummember",
  variable: "variable.other.readwrite",
  "variable.builtin": "variable.language",
  "variable.special": "variable.language",
  "variable.member": "variable.other.property",
  "variable.parameter": "variable.parameter",
  property: "variable.other.property",
  "property.definition": "meta.object-literal.key",
  "property.css": "support.type.property-name.css",
  value: "support.constant.property-value",
  tag: "entity.name.tag",
  "tag.component": "support.class.component",
  attribute: "entity.other.attribute-name",
  "selector.class": "entity.other.attribute-name.class",
  "selector.id": "entity.other.attribute-name.id",
  "selector.pseudo": "entity.other.attribute-name.pseudo-class",
  unit: "keyword.other.unit",
  color: "constant.other.color",
  punctuation: "punctuation",
  "punctuation.bracket": "meta.brace",
  "punctuation.delimiter": "punctuation.separator",
  "punctuation.special": "punctuation.definition.template-expression",
  "punctuation.list_marker": "punctuation.definition.list",
  label: "entity.name.label",
  namespace: "entity.name.namespace",
  decorator: "meta.decorator",
  embedded: "meta.embedded",
  preproc: "meta.preprocessor",
  title: "markup.heading",
  "markup.heading": "markup.heading",
  "markup.bold": "markup.bold",
  "markup.italic": "markup.italic",
  "markup.strikethrough": "markup.strikethrough",
  "markup.link.url": "markup.underline.link",
  "markup.link.text": "string.other.link",
  "markup.quote": "markup.quote",
  "markup.list": "markup.list",
  "markup.raw": "markup.inline.raw",
  "text.literal": "markup.inline.raw",
  "diff.plus": "markup.inserted",
  "diff.minus": "markup.deleted",
  "diff.delta": "markup.changed",
};

const matches = (selector: string, scope: string) =>
  scope === selector || scope.startsWith(`${selector}.`);

/** The style TextMate gives a scope: the rule with the longest matching
 * selector, the later one when two are as long. */
function ruleFor(syntax: SyntaxTheme, scope: string) {
  let best: SyntaxTheme["rules"][number] | undefined;
  let length = -1;
  for (const rule of syntax.rules)
    for (const selector of rule.scope)
      if (matches(selector, scope) && selector.length >= length) {
        best = rule;
        length = selector.length;
      }
  return best;
}

/** A Zed theme's `syntax` map from Med's TextMate rules. */
export function zedSyntax(syntax: SyntaxTheme): Record<string, ZedSyntaxStyle> {
  const styles: Record<string, ZedSyntaxStyle> = {};
  for (const [capture, scope] of Object.entries(captureScopes)) {
    const rule = ruleFor(syntax, scope);
    if (!rule) continue;
    styles[capture] = {
      ...(rule.color ? { color: rule.color } : {}),
      ...(rule.style === "italic" ? { font_style: "italic" as const } : {}),
      ...(rule.style === "bold" ? { font_weight: 700 as const } : {}),
    };
  }
  return styles;
}
