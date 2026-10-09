import { useSyncExternalStore } from "react";
import { codeVariables } from "./code-colors";

export interface ThemePalette {
  canvas: string;
  panel: string;
  raised: string;
  hover: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  selected: string;
  green: string;
  red: string;
  warning: string;
  shadow: string;
}

/**
 * Editor colors under their VS Code names. Translucent values are kept as the
 * theme defines them; code-colors.ts composites them for each surface.
 */
export interface CodePalette {
  /** editor.selectionBackground: line selection, text selection, Vim visual. */
  selection: string;
  /** editor.findMatchHighlightBackground: every find match. */
  match: string;
  /** editor.findMatchBackground: the current find match. */
  matchCurrent: string;
  /** editor.findMatchBorder, drawn as an underline. */
  matchBorder?: string;
  /** Text on the current match, for themes that set one. */
  matchText?: string;
  /** editor.lineHighlightBackground: the editor's cursor line. */
  lineHighlight: string;
  /** diffEditor.insertedLineBackground and removedLineBackground. */
  insertedLine: string;
  removedLine: string;
  /** diffEditor.insertedTextBackground and removedTextBackground: changed words. */
  insertedText: string;
  removedText: string;
}

/** A syntax theme written for Med: TextMate scopes and their colors. */
export interface SyntaxTheme {
  foreground: string;
  rules: { scope: string[]; color?: string; style?: "italic" | "bold" }[];
}

export interface Theme {
  id: string;
  label: string;
  family: string;
  appearance: "dark" | "light";
  syntax:
    | "pierre-dark"
    | "pierre-light"
    | "vitesse-dark"
    | "vitesse-light"
    | "rose-pine"
    | "rose-pine-moon"
    | "rose-pine-dawn"
    | "tokyo-night"
    | "dark-plus"
    | "light-plus"
    | SyntaxTheme;
  pierreTheme: string;
  source: string | null;
  palette: ThemePalette;
  code: CodePalette;
}

// Layered shadows: a tight contact shadow, a soft ambient one, and (dark only)
// a one-pixel top highlight that separates raised surfaces from the canvas.
const darkShadow =
  "0 1px 0 0 #ffffff08 inset, 0 2px 6px -1px #00000066, 0 16px 40px -12px #000000b3";
const lightShadow =
  "0 1px 2px -1px #1b1f2a1f, 0 4px 10px -4px #1b1f2a1a, 0 18px 40px -16px #1b1f2a33";

// Claude's Code tab themes, from the claude-light and claude-dark editor themes
// and the design-system tokens the Claude desktop app uses for diffs. Colors are
// mapped to Med's scopes; no theme file is copied.
const claudeLightSyntax: SyntaxTheme = {
  foreground: "#1a1a1a",
  rules: [
    { scope: ["comment", "punctuation.definition.comment"], color: "#999999", style: "italic" },
    {
      scope: [
        "keyword",
        "storage.type",
        "storage.modifier",
        "keyword.operator.new",
        "keyword.operator.expression",
        "entity.name.tag",
        "punctuation.definition.tag",
      ],
      color: "#c5621b",
    },
    { scope: ["keyword.operator", "punctuation", "meta.brace"], color: "#737373" },
    { scope: ["string", "punctuation.definition.string", "markup.inserted"], color: "#1e9e3c" },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "keyword.other.unit"],
      color: "#cd2054",
    },
    { scope: ["string.regexp", "constant.character.escape"], color: "#98801f" },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call.generic",
        "entity.other.attribute-name",
      ],
      color: "#0073e6",
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
      ],
      color: "#8e6bd9",
    },
    {
      scope: [
        "variable",
        "variable.parameter",
        "variable.other.property",
        "meta.object-literal.key",
        "support.type.property-name",
      ],
      color: "#1a1a1a",
    },
    { scope: ["markup.heading", "entity.name.section"], color: "#0073e6", style: "bold" },
    { scope: ["markup.deleted", "invalid"], color: "#ff3a30" },
  ],
};
const claudeDarkSyntax: SyntaxTheme = {
  foreground: "#eaecf0",
  rules: [
    { scope: ["comment", "punctuation.definition.comment"], color: "#818898" },
    {
      scope: [
        "keyword",
        "storage",
        "variable.language",
        "keyword.operator.new",
        "keyword.operator.expression",
      ],
      color: "#cc7bf4",
    },
    { scope: ["keyword.operator"], color: "#eaecf0" },
    { scope: ["punctuation", "meta.brace", "entity.name.namespace"], color: "#d3d7de" },
    { scope: ["string", "markup.inserted"], color: "#9be963" },
    { scope: ["string.regexp"], color: "#96e35f" },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.character",
        "constant.other.symbol",
      ],
      color: "#5eeded",
    },
    { scope: ["entity.name.function", "support.function"], color: "#70b8ff" },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
      ],
      color: "#fbad60",
    },
    { scope: ["variable.parameter"], color: "#f7ab5f" },
    { scope: ["meta.object-literal.key", "entity.name.tag", "markup.deleted"], color: "#f47b85" },
    { scope: ["entity.other.attribute-name"], color: "#f0757f" },
    { scope: ["support.type.property-name", "variable.other.property"], color: "#eaecf0" },
    { scope: ["markup.heading", "entity.name.section"], style: "bold" },
  ],
};

// Codex's own Codex Light and Codex Dark syntax themes, from the Codex desktop
// app. The two use the same scopes with one color swapped for another.
function codexSyntax(colors: {
  foreground: string;
  quiet: string;
  red: string;
  purple: string;
  green: string;
  blue: string;
  orange: string;
  regex: string;
}): SyntaxTheme {
  return {
    foreground: colors.foreground,
    rules: [
      {
        scope: [
          "comment",
          "punctuation",
          "meta.brace",
          "keyword.operator",
          "variable.parameter",
          "meta.tag",
        ],
        color: colors.quiet,
      },
      {
        scope: [
          "keyword",
          "storage",
          "keyword.operator.new",
          "keyword.operator.expression",
          "keyword.operator.ternary",
          "entity.name.tag",
          "support.type.property-name.json",
          "markup.deleted",
          "markup.heading",
        ],
        color: colors.red,
      },
      {
        scope: [
          "storage.type",
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
          "entity.name.type",
          "entity.name.class",
          "entity.other.inherited-class",
          "support.type",
          "support.class",
        ],
        color: colors.purple,
      },
      { scope: ["string", "constant.other.symbol", "markup.inserted"], color: colors.green },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.character.escape",
          "entity.other.attribute-name",
          "keyword.operator.arithmetic",
          "keyword.operator.comparison",
          "keyword.operator.assignment",
          "keyword.operator.logical",
          "support.type.property-name.css",
        ],
        color: colors.blue,
      },
      {
        scope: [
          "variable",
          "variable.language",
          "constant",
          "variable.other.constant",
          "meta.object-literal.key",
          "support.variable.property",
          "entity.name.namespace",
        ],
        color: colors.orange,
      },
      { scope: ["string.regexp"], color: colors.regex },
    ],
  };
}

// Cursor's built-in Cursor Light and Cursor Dark themes (Cursor 3.12), from
// public copies of its theme-cursor extension. Colors are mapped to Med's scopes.
const cursorLightSyntax: SyntaxTheme = {
  foreground: "#141414",
  rules: [
    { scope: ["comment"], color: "#14141499", style: "italic" },
    {
      scope: [
        "keyword",
        "storage",
        "support.type.primitive",
        "keyword.operator.logical",
        "keyword.operator.comparison",
        "keyword.operator.bitwise",
      ],
      color: "#a30034",
    },
    {
      scope: [
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.ternary",
        "constant",
        "variable.other.constant",
        "variable.other.readwrite",
        "entity.name.type",
        "support.class",
        "entity.name.tag.html",
        "entity.name.section.markdown",
      ],
      color: "#005293",
    },
    { scope: ["keyword.operator"], color: "#141414" },
    { scope: ["string"], color: "#7565cc" },
    { scope: ["constant.numeric"], color: "#92156a" },
    { scope: ["entity.name.function", "support.function"], color: "#cd4500" },
    { scope: ["variable.language.this"], color: "#be1744" },
    { scope: ["variable.other.property", "entity.other.attribute-name"], color: "#654dc0" },
    {
      scope: [
        "entity.name.tag",
        "support.class.component",
        "support.type.property-name.json",
        "markup.inline.raw",
      ],
      color: "#007041",
    },
    {
      scope: [
        "punctuation.definition.tag",
        "punctuation.definition.template-expression",
        "constant.character.escape",
      ],
      color: "#141414bd",
    },
    { scope: ["string.regexp"], color: "#0064b0" },
  ],
};
const cursorDarkSyntax: SyntaxTheme = {
  foreground: "#f0f0f0",
  rules: [
    { scope: ["comment"], color: "#f0f0f099", style: "italic" },
    {
      scope: [
        "keyword",
        "storage",
        "support.type.primitive",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.ternary",
        "punctuation.definition.template-expression",
        "support.type.property-name.json",
      ],
      color: "#82d2ce",
    },
    {
      scope: [
        "keyword.operator",
        "variable",
        "meta.object-literal.key",
        "string.regexp",
        "constant.character.escape",
      ],
      color: "#d6d6dd",
    },
    { scope: ["variable.parameter"], color: "#d6d6dd", style: "italic" },
    { scope: ["string", "markup.inline.raw"], color: "#e394dc" },
    { scope: ["constant.numeric"], color: "#ebc88d" },
    {
      scope: ["entity.name.function", "support.function", "entity.name.type"],
      color: "#efb080",
    },
    {
      scope: [
        "entity.name.type.class",
        "support.class",
        "variable.other.readwrite",
        "entity.name.tag.html",
      ],
      color: "#87c3ff",
    },
    {
      scope: ["variable.other.constant", "variable.other.property", "entity.other.attribute-name"],
      color: "#aaa0fa",
    },
    { scope: ["variable.language.this"], color: "#cc7c8a" },
    { scope: ["entity.name.tag", "meta.tag"], color: "#fad075" },
    { scope: ["punctuation.definition.tag"], color: "#a4a4a4" },
    { scope: ["entity.name.section.markdown"], color: "#88c0d0" },
  ],
};

// Shell mappings use the named projects' public palettes. Syntax definitions are
// loaded by Pierre from its bundled Shiki themes, or written above for themes
// that have no Shiki build. Code colors use each theme's own editor keys; where a
// theme leaves one unset, the comment names what Med uses instead.
// Graphite is an original neutral palette, not an official Vercel/Geist theme.
export const themes: readonly Theme[] = [
  {
    id: "graphite-dark",
    label: "Graphite Dark",
    family: "Neutral",
    appearance: "dark",
    syntax: "pierre-dark",
    pierreTheme: "med-graphite-dark",
    source: null,
    // The frame (panel) sits darker than the review card (canvas).
    palette: {
      canvas: "#141416",
      panel: "#0d0d0f",
      raised: "#1b1b1e",
      hover: "#232327",
      border: "#28282d",
      text: "#ececef",
      muted: "#9d9da6",
      faint: "#686871",
      accent: "#8f9cff",
      selected: "#252946",
      green: "#82cfa1",
      red: "#ee8d98",
      warning: "#e8c17a",
      shadow: darkShadow,
    },
    // A light, cool selection that keeps diff colors readable under it;
    // matches from the warning color.
    code: {
      selection: "#c8cdff1f",
      match: "#e8c17a33",
      matchCurrent: "#e8c17a73",
      matchBorder: "#e8c17a",
      lineHighlight: "#ffffff0a",
      insertedLine: "#82cfa129",
      insertedText: "#82cfa138",
      removedLine: "#ee8d9829",
      removedText: "#ee8d9838",
    },
  },
  {
    id: "claude-dark",
    label: "Claude Dark",
    family: "Claude",
    appearance: "dark",
    syntax: claudeDarkSyntax,
    pierreTheme: "med-claude-dark",
    source: "Claude desktop app, Code tab (claude-dark theme and design-system tokens)",
    palette: {
      canvas: "#1a1a19",
      panel: "#151515",
      raised: "#20201f",
      hover: "#272727",
      border: "#313130",
      text: "#f0efec",
      muted: "#c3c2b7",
      faint: "#898781",
      accent: "#d97757",
      selected: "#2c2c2b",
      green: "#32d74b",
      red: "#ff2c56",
      warning: "#db9300",
      shadow: darkShadow,
    },
    // Find colors are the Code tab's fixed yellow, with black text on the current match.
    code: {
      selection: "#0099ff4d",
      match: "#ffd50040",
      matchCurrent: "#ffd5008c",
      matchText: "#000000",
      lineHighlight: "#ffffff0d",
      insertedLine: "#32d74b33",
      insertedText: "#32d74b33",
      removedLine: "#ff2c5633",
      removedText: "#ff2c5633",
    },
  },
  {
    id: "codex-dark",
    label: "Codex Dark",
    family: "Codex",
    appearance: "dark",
    syntax: codexSyntax({
      foreground: "#fcfcfc",
      quiet: "#999999",
      red: "#f67576",
      purple: "#b06dff",
      green: "#85df7b",
      blue: "#6dcbf4",
      orange: "#fa994c",
      regex: "#3d8dff",
    }),
    pierreTheme: "med-codex-dark",
    source: "Codex desktop app: Codex Dark code theme and default appearance",
    // Codex derives its chrome from a surface, text, and accent; these are
    // the derived values, flattened on the canvas.
    palette: {
      canvas: "#181818",
      panel: "#141414",
      raised: "#2d2d2d",
      hover: "#2a2a2a",
      border: "#2b2b2b",
      text: "#dfdfdf",
      muted: "#bcbcbc",
      faint: "#8b8b8b",
      accent: "#339cff",
      selected: "#2a2a2a",
      green: "#40c977",
      red: "#fa423e",
      warning: "#ff8549",
      shadow: darkShadow,
    },
    // Codex selects in its info blue and marks other matches in orange. Its
    // current match is the selection color; Med adds an underline to it.
    code: {
      selection: "#83c3ff4d",
      match: "#ff963266",
      matchCurrent: "#83c3ff66",
      matchBorder: "#83c3ff",
      lineHighlight: "#dfdfdf0a",
      insertedLine: "#40c97733",
      insertedText: "#40c97733",
      removedLine: "#fa423e33",
      removedText: "#fa423e33",
    },
  },
  {
    id: "cursor-dark",
    label: "Cursor Dark",
    family: "Cursor",
    appearance: "dark",
    syntax: cursorDarkSyntax,
    pierreTheme: "med-cursor-dark",
    source: "Cursor 3.12 built-in theme (theme-cursor extension), Cursor Dark",
    // Cursor sets neutral text as #f0f0f0 with alpha; these are flattened on the canvas.
    // Faint is the line-number color.
    palette: {
      canvas: "#181818",
      panel: "#141414",
      raised: "#141414",
      hover: "#232323",
      border: "#282828",
      text: "#f0f0f0",
      muted: "#b8b8b8",
      faint: "#666666",
      accent: "#81a1c1",
      selected: "#2e2e2e",
      green: "#70b489",
      red: "#fc6b83",
      warning: "#f1b467",
      shadow: darkShadow,
    },
    // Cursor Dark draws changed words fainter than their lines.
    code: {
      selection: "#40404099",
      match: "#88c0d044",
      matchCurrent: "#88c0d066",
      lineHighlight: "#262626",
      insertedLine: "#3fa26633",
      insertedText: "#3fa26622",
      removedLine: "#b8004933",
      removedText: "#b8004922",
    },
  },
  {
    id: "paper-dark",
    label: "Paper Dark",
    family: "Paper",
    appearance: "dark",
    syntax: "dark-plus",
    pierreTheme: "med-paper-dark",
    source: "Paper app stylesheet (app.paper.design), dark color scheme",
    // Paper's panels are lighter than its content area. Faint is dimmer than
    // Paper's tertiary text so line numbers stay quieter than secondary text.
    palette: {
      canvas: "#222222",
      panel: "#2a2a2a",
      raised: "#2a2a2a",
      hover: "#333333",
      border: "#373737",
      text: "#e9e9e9",
      muted: "#b2b2b2",
      faint: "#8c8c8c",
      accent: "#4d94fb",
      selected: "#3c3c3c",
      green: "#3cc96a",
      red: "#ff6971",
      warning: "#ffad4d",
      shadow: darkShadow,
    },
    // Paper has no code view; syntax is VS Code Dark+ (as on paper.design) and
    // the editor colors come from Paper's accent, green, red, and warning.
    code: {
      selection: "#4d94fb4d",
      match: "#ffad4d40",
      matchCurrent: "#ffad4d80",
      lineHighlight: "#ffffff0a",
      insertedLine: "#3cc96a26",
      insertedText: "#3cc96a3d",
      removedLine: "#ff697126",
      removedText: "#ff69713d",
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    family: "Rosé Pine",
    appearance: "dark",
    syntax: "rose-pine",
    pierreTheme: "med-rose-pine",
    source: "https://rosepinetheme.com/palette/",
    palette: {
      canvas: "#191724",
      panel: "#1f1d2e",
      raised: "#26233a",
      hover: "#26233a",
      border: "#403d52",
      text: "#e0def4",
      muted: "#908caa",
      faint: "#6e6a86",
      accent: "#c4a7e7",
      selected: "#403d52",
      green: "#9ccfd8",
      red: "#eb6f92",
      warning: "#f6c177",
      shadow: darkShadow,
    },
    code: {
      selection: "#6e6a8633",
      match: "#6e6a8666",
      matchCurrent: "#f6c17733",
      matchBorder: "#f6c17780",
      lineHighlight: "#6e6a861a",
      insertedLine: "#9ccfd826",
      insertedText: "#9ccfd826",
      removedLine: "#eb6f9226",
      removedText: "#eb6f9226",
    },
  },
  {
    id: "rose-pine-moon",
    label: "Rosé Pine Moon",
    family: "Rosé Pine",
    appearance: "dark",
    syntax: "rose-pine-moon",
    pierreTheme: "med-rose-pine-moon",
    source: "https://rosepinetheme.com/palette/",
    palette: {
      canvas: "#232136",
      panel: "#2a273f",
      raised: "#393552",
      hover: "#393552",
      border: "#44415a",
      text: "#e0def4",
      muted: "#908caa",
      faint: "#6e6a86",
      accent: "#c4a7e7",
      selected: "#44415a",
      green: "#9ccfd8",
      red: "#eb6f92",
      warning: "#f6c177",
      shadow: darkShadow,
    },
    code: {
      selection: "#817c9c26",
      match: "#817c9c4d",
      matchCurrent: "#f6c17733",
      matchBorder: "#f6c17780",
      lineHighlight: "#817c9c14",
      insertedLine: "#9ccfd826",
      insertedText: "#9ccfd826",
      removedLine: "#eb6f9226",
      removedText: "#eb6f9226",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    family: "Tokyo Night",
    appearance: "dark",
    syntax: "tokyo-night",
    pierreTheme: "med-tokyo-night",
    source: "https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors",
    palette: {
      canvas: "#1a1b26",
      panel: "#16161e",
      raised: "#24283b",
      hover: "#292e42",
      border: "#3b4261",
      text: "#c0caf5",
      muted: "#a9b1d6",
      faint: "#737aa2",
      accent: "#7aa2f7",
      selected: "#394b70",
      green: "#9ece6a",
      red: "#f7768e",
      warning: "#e0af68",
      shadow: darkShadow,
    },
    // Tokyo Night marks the current match only with its border.
    code: {
      selection: "#515c7e4d",
      match: "#3d59a166",
      matchCurrent: "#3d59a166",
      matchBorder: "#e0af68",
      lineHighlight: "#1e202e",
      insertedLine: "#41a6b520",
      insertedText: "#41a6b520",
      removedLine: "#db4b4b22",
      removedText: "#db4b4b22",
    },
  },
  {
    id: "vitesse-dark",
    label: "Vitesse Dark",
    family: "Vitesse",
    appearance: "dark",
    syntax: "vitesse-dark",
    pierreTheme: "med-vitesse-dark",
    source: "https://github.com/antfu/vscode-theme-vitesse/blob/main/themes/vitesse-dark.json",
    palette: {
      canvas: "#121212",
      panel: "#121212",
      raised: "#181818",
      hover: "#202020",
      border: "#292929",
      text: "#dbd7ca",
      muted: "#bfbaaa",
      faint: "#777777",
      accent: "#4d9375",
      selected: "#263a30",
      green: "#4d9375",
      red: "#cb7676",
      warning: "#d4976c",
      shadow: darkShadow,
    },
    // Vitesse sets no line colors, so lines take its word colors at half
    // strength. Its current match (#e6cc7722) is fainter than the others; Med
    // makes it stronger instead.
    code: {
      selection: "#eeeeee18",
      match: "#e6cc7744",
      matchCurrent: "#e6cc7766",
      lineHighlight: "#181818",
      insertedLine: "#4d937528",
      insertedText: "#4d937550",
      removedLine: "#ab595928",
      removedText: "#ab595950",
    },
  },
  {
    id: "graphite-light",
    label: "Graphite Light",
    family: "Neutral",
    appearance: "light",
    syntax: "pierre-light",
    pierreTheme: "med-graphite-light",
    source: null,
    palette: {
      canvas: "#ffffff",
      panel: "#f4f4f5",
      raised: "#ffffff",
      hover: "#eaeaec",
      border: "#e1e1e5",
      text: "#18181b",
      muted: "#5f5f68",
      faint: "#8b8b94",
      accent: "#4f5bd5",
      selected: "#e8eafc",
      green: "#1f7a4a",
      red: "#c23a4c",
      warning: "#94651c",
      shadow: lightShadow,
    },
    code: {
      selection: "#4f5bd51f",
      match: "#f7d76a73",
      matchCurrent: "#f2b8008c",
      matchBorder: "#bf8700",
      lineHighlight: "#18181b08",
      insertedLine: "#1f7a4a1a",
      insertedText: "#1f7a4a33",
      removedLine: "#c23a4c1a",
      removedText: "#c23a4c33",
    },
  },
  {
    id: "claude-light",
    label: "Claude Light",
    family: "Claude",
    appearance: "light",
    syntax: claudeLightSyntax,
    pierreTheme: "med-claude-light",
    source: "Claude desktop app, Code tab (claude-light theme and design-system tokens)",
    // The accent is Claude's emphasized clay, which reads as text on white.
    palette: {
      canvas: "#ffffff",
      panel: "#f9f9f7",
      raised: "#ffffff",
      hover: "#eeeeec",
      border: "#e7e7e6",
      text: "#0b0b0b",
      muted: "#52514e",
      faint: "#898781",
      accent: "#c6613f",
      selected: "#ecebe8",
      green: "#1e9e3c",
      red: "#cd2054",
      warning: "#734500",
      shadow: lightShadow,
    },
    code: {
      selection: "#0073e640",
      match: "#ffd50040",
      matchCurrent: "#ffd5008c",
      matchText: "#000000",
      lineHighlight: "#1a1a1a0a",
      insertedLine: "#1e9e3c1f",
      insertedText: "#1e9e3c26",
      removedLine: "#cd20541f",
      removedText: "#cd205426",
    },
  },
  {
    id: "codex-light",
    label: "Codex Light",
    family: "Codex",
    appearance: "light",
    syntax: codexSyntax({
      foreground: "#0d0d0d",
      quiet: "#666666",
      red: "#d53538",
      purple: "#751ed9",
      green: "#008809",
      blue: "#0071ea",
      orange: "#bd5800",
      regex: "#001bcb",
    }),
    pierreTheme: "med-codex-light",
    source: "Codex desktop app: Codex Light code theme and default appearance",
    // The accent is the Codex theme's link and cursor blue, which reads as text on white.
    palette: {
      canvas: "#ffffff",
      panel: "#f6f6f6",
      raised: "#ffffff",
      hover: "#f3f3f3",
      border: "#ededee",
      text: "#1a1c1f",
      muted: "#606163",
      faint: "#8e8f90",
      accent: "#0169cc",
      selected: "#ebebec",
      green: "#00a240",
      red: "#ba2623",
      warning: "#e25507",
      shadow: lightShadow,
    },
    code: {
      selection: "#339cff4d",
      match: "#ff963288",
      matchCurrent: "#339cff73",
      matchBorder: "#0169cc",
      lineHighlight: "#1a1c1f0a",
      insertedLine: "#00a2401f",
      insertedText: "#00a24026",
      removedLine: "#ba26231f",
      removedText: "#ba262326",
    },
  },
  {
    id: "cursor-light",
    label: "Cursor Light",
    family: "Cursor",
    appearance: "light",
    syntax: cursorLightSyntax,
    pierreTheme: "med-cursor-light",
    source: "Cursor 3.12 built-in theme (theme-cursor extension), Cursor Light",
    // Faint uses Cursor's dim status text: its line-number gray is too light for metadata.
    palette: {
      canvas: "#fcfcfc",
      panel: "#f3f3f3",
      raised: "#f3f3f3",
      hover: "#e2e2e2",
      border: "#eaeaea",
      text: "#141414",
      muted: "#505050",
      faint: "#757575",
      accent: "#2778c1",
      selected: "#e2e2e2",
      green: "#007041",
      red: "#be1744",
      warning: "#cd4500",
      shadow: lightShadow,
    },
    code: {
      selection: "#14141414",
      match: "#3b7e8424",
      matchCurrent: "#3b7e843d",
      lineHighlight: "#eaeaea",
      insertedLine: "#00af6624",
      insertedText: "#00b06838",
      removedLine: "#ff617b38",
      removedText: "#ff617b57",
    },
  },
  {
    id: "paper-light",
    label: "Paper Light",
    family: "Paper",
    appearance: "light",
    syntax: "light-plus",
    pierreTheme: "med-paper-light",
    source: "Paper app stylesheet (app.paper.design), light color scheme",
    // Paper's orange (#ffad4d) is too light for text, so warning is a darker step of it.
    palette: {
      canvas: "#ffffff",
      panel: "#f2f2f2",
      raised: "#f2f2f2",
      hover: "#eaeaea",
      border: "#e2e2e2",
      text: "#333333",
      muted: "#666666",
      faint: "#808080",
      accent: "#4d94fb",
      selected: "#e0e0e0",
      green: "#20a04e",
      red: "#e9003d",
      warning: "#b86e00",
      shadow: lightShadow,
    },
    code: {
      selection: "#4d94fb33",
      match: "#ffad4d4d",
      matchCurrent: "#ffad4d99",
      lineHighlight: "#00000008",
      insertedLine: "#20a04e1a",
      insertedText: "#20a04e33",
      removedLine: "#e9003d14",
      removedText: "#e9003d2e",
    },
  },
  {
    id: "rose-pine-dawn",
    label: "Rosé Pine Dawn",
    family: "Rosé Pine",
    appearance: "light",
    syntax: "rose-pine-dawn",
    pierreTheme: "med-rose-pine-dawn",
    source: "https://rosepinetheme.com/palette/",
    palette: {
      canvas: "#faf4ed",
      panel: "#fffaf3",
      raised: "#fffaf3",
      hover: "#f2e9e1",
      border: "#dfdad9",
      text: "#575279",
      muted: "#797593",
      faint: "#9893a5",
      accent: "#907aa9",
      selected: "#dfdad9",
      green: "#286983",
      red: "#b4637a",
      warning: "#a87924",
      shadow: lightShadow,
    },
    code: {
      selection: "#6e6a8614",
      match: "#6e6a8626",
      matchCurrent: "#ea9d3433",
      matchBorder: "#ea9d3480",
      lineHighlight: "#6e6a860d",
      insertedLine: "#56949f26",
      insertedText: "#56949f26",
      removedLine: "#b4637a26",
      removedText: "#b4637a26",
    },
  },
  {
    id: "vitesse-light",
    label: "Vitesse Light",
    family: "Vitesse",
    appearance: "light",
    syntax: "vitesse-light",
    pierreTheme: "med-vitesse-light",
    source: "https://github.com/antfu/vscode-theme-vitesse/blob/main/themes/vitesse-light.json",
    palette: {
      canvas: "#ffffff",
      panel: "#ffffff",
      raised: "#f7f7f7",
      hover: "#f0f0f0",
      border: "#e1e4e8",
      text: "#393a34",
      muted: "#6a737d",
      faint: "#999999",
      accent: "#1c6b48",
      selected: "#e7eee9",
      green: "#1e754f",
      red: "#ab5959",
      warning: "#a65e2b",
      shadow: lightShadow,
    },
    // As in Vitesse Dark: half-strength lines and a stronger current match.
    code: {
      selection: "#22222218",
      match: "#e6cc7766",
      matchCurrent: "#e6cc77a6",
      lineHighlight: "#f7f7f7",
      insertedLine: "#1c6b4818",
      insertedText: "#1c6b4830",
      removedLine: "#ab595920",
      removedText: "#ab595940",
    },
  },
];

export const THEME_STORAGE_KEY = "med:theme:v1";
export const defaultTheme = themes[0];

export function findTheme(id: string | null | undefined): Theme {
  return themes.find((theme) => theme.id === id) ?? defaultTheme;
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, color] of Object.entries(theme.palette)) {
    root.style.setProperty(`--med-${name}`, color);
  }
  for (const [name, value] of Object.entries(codeVariables(theme))) {
    root.style.setProperty(name, value);
  }
  root.style.colorScheme = theme.appearance;
  root.dataset.theme = theme.id;
  // An installed app's title bar takes this color, so it joins the app frame.
  const page = root.ownerDocument;
  let meta = page.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = page.createElement("meta");
    meta.name = "theme-color";
    page.head.append(meta);
  }
  meta.content = theme.palette.panel;
}

export interface ThemeSnapshot {
  active: Theme;
  saved: Theme;
  persistenceError: string | null;
}

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
export interface ThemeControllerOptions {
  storage?: ThemeStorage;
  apply?: (theme: Theme) => void;
}

// Selection preview is temporary. Only commit writes storage. This follows the
// behavior of Zed's theme selector; no Zed source code is copied.
// https://github.com/zed-industries/zed/blob/main/crates/theme_selector/src/theme_selector.rs
export function createThemeController(options: ThemeControllerOptions = {}) {
  let storage = options.storage;
  let snapshot: ThemeSnapshot = {
    active: defaultTheme,
    saved: defaultTheme,
    persistenceError: null,
  };
  const listeners = new Set<() => void>();
  function publish(
    active: Theme,
    saved = snapshot.saved,
    persistenceError = snapshot.persistenceError,
  ) {
    options.apply?.(active);
    snapshot = { active, saved, persistenceError };
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize(nextStorage = storage) {
      storage = nextStorage;
      let theme = defaultTheme;
      let error: string | null = null;
      try {
        const stored = storage?.getItem(THEME_STORAGE_KEY);
        const legacy = !stored ? storage?.getItem("med:theme") : null;
        theme = findTheme(stored ?? (legacy === "light" ? "graphite-light" : undefined));
      } catch {
        error = "Theme storage is unavailable. Changes apply to this session.";
      }
      publish(theme, theme, error);
    },
    preview(id: string) {
      const theme = findTheme(id);
      if (theme !== snapshot.active) publish(theme);
    },
    commit(id: string) {
      const theme = findTheme(id);
      let error: string | null = null;
      try {
        storage?.setItem(THEME_STORAGE_KEY, theme.id);
      } catch {
        error = "Theme could not be saved. It applies to this session.";
      }
      publish(theme, theme, error);
    },
    cancelPreview() {
      if (snapshot.active !== snapshot.saved) publish(snapshot.saved);
    },
  };
}

export const themeController = createThemeController({
  apply: (theme) => {
    if (typeof document !== "undefined") applyTheme(theme);
  },
});

/** Call once before React mounts to avoid an incorrect first frame. */
export function initializeTheme(): void {
  try {
    themeController.initialize(window.localStorage);
  } catch {
    // Accessing localStorage itself can throw in restricted browser contexts.
    themeController.initialize({
      getItem() {
        throw new Error("Storage unavailable");
      },
      setItem() {
        throw new Error("Storage unavailable");
      },
    });
  }
}

export function useTheme(): ThemeSnapshot {
  return useSyncExternalStore(
    themeController.subscribe,
    themeController.getSnapshot,
    themeController.getSnapshot,
  );
}
