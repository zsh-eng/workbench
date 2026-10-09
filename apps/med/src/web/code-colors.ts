import type { Theme } from "./themes";

// Code colors come from each theme's own editor keys (VS Code names in
// themes.ts). Selection and matches stay translucent because they lie over
// other colors. Pierre paints diff and selected lines by mixing a target color
// into the line below it in Lab, at fixed weights; the targets here are chosen
// so each mix lands on the theme's color as VS Code would composite it.

type Rgba = [number, number, number, number];

function parse(hex: string): Rgba {
  let value = hex.replace("#", "");
  if (value.length <= 4) value = [...value].map((digit) => digit + digit).join("");
  const channel = (index: number) => parseInt(value.slice(index, index + 2), 16);
  return [channel(0), channel(2), channel(4), value.length === 8 ? channel(6) / 255 : 1];
}
function format([r, g, b, a]: Rgba): string {
  const hex = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(a * 255) : ""}`;
}
/** Source-over compositing of two colors that may both be translucent. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3] + bottom[3] * (1 - top[3]);
  if (!alpha) return [0, 0, 0, 0];
  const mix = (index: number) =>
    (top[index]! * top[3] + bottom[index]! * bottom[3] * (1 - top[3])) / alpha;
  return [mix(0), mix(1), mix(2), alpha];
}
const scale = ([r, g, b, a]: Rgba, factor: number): Rgba => [r, g, b, Math.min(1, a * factor)];

/**
 * A translucent color that looks like `color` on `ground`. CodeMirror draws its
 * selection under the active line, so an opaque line color would hide it.
 */
function lift(color: Rgba, ground: Rgba): Rgba {
  if (color[3] < 1) return color;
  for (const alpha of [0.08, 0.12, 0.18, 0.25, 0.35, 0.5]) {
    const channel = (index: number) => (color[index]! - ground[index]! * (1 - alpha)) / alpha;
    const result: Rgba = [channel(0), channel(1), channel(2), alpha];
    if (result.slice(0, 3).every((value) => value >= 0 && value <= 255)) return result;
  }
  return [color[0], color[1], color[2], 0.5];
}

/** CSS Color 4 sRGB to CIE Lab (D50), the space Pierre's color-mix() uses. */
function lab([r, g, b]: Rgba): [number, number, number] {
  const linear = [r, g, b].map((value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const d65 = [
    0.4123907992659593 * linear[0] + 0.357584339383878 * linear[1] + 0.1804807884018343 * linear[2],
    0.2126390058715103 * linear[0] +
      0.715168678767756 * linear[1] +
      0.07219231536073371 * linear[2],
    0.01933081871559182 * linear[0] +
      0.119194779794626 * linear[1] +
      0.9505321522496607 * linear[2],
  ] as const;
  const xyz = [
    1.047929820840549 * d65[0] + 0.02294679334101909 * d65[1] - 0.05019222954313557 * d65[2],
    0.02962781568815934 * d65[0] + 0.990434484573249 * d65[1] - 0.01707382502938514 * d65[2],
    -0.00924305815259118 * d65[0] + 0.0150551448965779 * d65[1] + 0.752131635446103 * d65[2],
  ];
  const white = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
  const [fx, fy, fz] = xyz.map((value, index) => {
    const t = value / white[index]!;
    return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  }) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** The Lab distance between two opaque colors. */
function distance(first: Rgba, second: Rgba): number {
  const [l1, a1, b1] = lab(first);
  const [l2, a2, b2] = lab(second);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * The target for Pierre's `color-mix(in lab, ground weight, target)` that
 * yields `color`. It lies beyond `color` as seen from the ground, so it is
 * written in Lab, which has room outside sRGB.
 */
function mixTarget(color: Rgba, ground: Rgba, weight: number): string {
  const from = lab(ground);
  const to = lab(color);
  const [l, a, b] = to.map((value, index) => from[index]! + (value - from[index]!) / (1 - weight));
  const round = (value: number) => Math.round(value * 100) / 100;
  return `lab(${round(Math.min(100, Math.max(0, l!)))} ${round(a!)} ${round(b!)})`;
}

export interface CodeColors {
  selection: string;
  /** Pierre mix targets for a selected line and its line number. */
  selectionLine: string;
  selectionNumber: string;
  match: string;
  matchCurrent: string;
  matchBorder: string;
  matchText: string | null;
  lineHighlight: string;
  /** Pierre mix targets for changed lines and their line numbers. */
  insertedLine: string;
  insertedNumber: string;
  insertedText: string;
  removedLine: string;
  removedNumber: string;
  removedText: string;
}

// Pierre's mix weights for the ground color: [light, dark].
const LINE = [0.88, 0.8] as const;
const NUMBER = [0.91, 0.85] as const;
const SELECTED_LINE = [0.82, 0.75] as const;
const SELECTED_NUMBER = [0.75, 0.6] as const;
// A selected range of lines must not hide a change's red or green. Its fill is
// at most this share of the weaker change tint, both measured from the canvas.
const SELECTION_SHARE = 0.5;

const cache = new WeakMap<Theme, CodeColors>();

export function codeColors(theme: Theme): CodeColors {
  const cached = cache.get(theme);
  if (cached) return cached;
  const { code, palette } = theme;
  const mode = theme.appearance === "dark" ? 1 : 0;
  const canvas = parse(palette.canvas);
  // A translucent color as it shows on the canvas, made `boost` times stronger.
  const flat = (color: string, boost = 1) => over(scale(parse(color), boost), canvas);
  const target = (color: string, weights: readonly [number, number], boost = 1) =>
    mixTarget(flat(color, boost), canvas, weights[mode]);
  const tint = Math.min(
    distance(flat(code.insertedLine), canvas),
    distance(flat(code.removedLine), canvas),
  );
  const strength = distance(flat(code.selection), canvas);
  // Strong text selections, such as Claude's blue, are made lighter for lines.
  const lineBoost = strength > 0 ? Math.min(1, (SELECTION_SHARE * tint) / strength) : 1;
  const colors: CodeColors = {
    selection: code.selection,
    // On a context line, the selection is the theme's selection on the
    // canvas, made lighter when needed. On a changed line, its green or red
    // stays visible under it.
    selectionLine: target(code.selection, SELECTED_LINE, lineBoost),
    // The line numbers of a selected range are a step stronger than the lines.
    selectionNumber: target(code.selection, SELECTED_NUMBER, 1.6),
    match: code.match,
    matchCurrent: code.matchCurrent,
    matchBorder: code.matchBorder ?? "transparent",
    matchText: code.matchText ?? null,
    lineHighlight: format(lift(parse(code.lineHighlight), canvas)),
    insertedLine: target(code.insertedLine, LINE),
    insertedNumber: target(code.insertedLine, NUMBER, 1.5),
    insertedText: code.insertedText,
    removedLine: target(code.removedLine, LINE),
    removedNumber: target(code.removedLine, NUMBER, 1.5),
    removedText: code.removedText,
  };
  cache.set(theme, colors);
  return colors;
}

/** Root variables for Pierre's diff overrides; see diff-surface.ts. */
export function codeVariables(theme: Theme): Record<string, string> {
  const colors = codeColors(theme);
  return {
    "--med-code-selection-line": colors.selectionLine,
    "--med-code-selection-number": colors.selectionNumber,
    "--med-code-inserted-line": colors.insertedLine,
    "--med-code-inserted-number": colors.insertedNumber,
    "--med-code-inserted-text": colors.insertedText,
    "--med-code-removed-line": colors.removedLine,
    "--med-code-removed-number": colors.removedNumber,
    "--med-code-removed-text": colors.removedText,
  };
}

/** `::highlight()` rules for find matches and Vim's visual selection in Pierre's shadow roots. */
export function highlightRules(
  theme: Theme,
  names: { match?: string; current?: string; visual?: string },
): string {
  const colors = codeColors(theme);
  const text = colors.matchText ? `color: ${colors.matchText};` : "";
  return [
    names.match && `::highlight(${names.match}) { background-color: ${colors.match}; }`,
    names.current &&
      `::highlight(${names.current}) { background-color: ${colors.matchCurrent}; ${text} text-decoration: underline 2px ${colors.matchBorder}; text-underline-offset: 3px; }`,
    names.visual && `::highlight(${names.visual}) { background-color: ${colors.selection}; }`,
  ]
    .filter(Boolean)
    .join("\n");
}
