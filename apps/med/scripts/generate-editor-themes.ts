// Writes src/web/editor-themes.ts: Med palettes for editor themes that Pierre
// already bundles (its own Pierre themes and Shiki's). Run after changing the
// list or after a @pierre/diffs or @shikijs/themes upgrade:
// bun scripts/generate-editor-themes.ts && bun run format
//
// Each palette comes from the theme's own VS Code `colors`. Keys that a theme
// leaves unset, or sets too close to the canvas to read, are mixed from its
// text and canvas, so every theme has the same contrast floor. Syntax colors are
// not copied: Pierre loads each theme's definition when the theme is chosen.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

interface Entry {
  /** The bundled theme name, also Med's theme id. */
  name: string;
  label: string;
  family: string;
  /** The theme's signature colors, where its editor keys pick a gray or a
   * comment color for the accent, or a non-warning color for warnings. */
  accent?: string;
  red?: string;
  warning?: string;
}

const pierre = (name: string, label: string): Entry => ({ name, label, family: "Pierre" });
const entries: Entry[] = [
  pierre("pierre-light", "Pierre Light"),
  pierre("pierre-dark", "Pierre Dark"),
  pierre("pierre-light-soft", "Pierre Light Soft"),
  pierre("pierre-dark-soft", "Pierre Dark Soft"),
  pierre("pierre-light-vibrant", "Pierre Light Vibrant"),
  pierre("pierre-dark-vibrant", "Pierre Dark Vibrant"),
  pierre("pierre-light-protanopia-deuteranopia", "Pierre Light Protanopia & Deuteranopia"),
  pierre("pierre-dark-protanopia-deuteranopia", "Pierre Dark Protanopia & Deuteranopia"),
  pierre("pierre-light-tritanopia", "Pierre Light Tritanopia"),
  pierre("pierre-dark-tritanopia", "Pierre Dark Tritanopia"),
  { name: "github-light", label: "GitHub Light", family: "GitHub" },
  { name: "github-dark", label: "GitHub Dark", family: "GitHub" },
  { name: "github-dark-dimmed", label: "GitHub Dark Dimmed", family: "GitHub" },
  { name: "light-plus", label: "Light+", family: "VS Code" },
  { name: "dark-plus", label: "Dark+", family: "VS Code" },
  { name: "catppuccin-latte", label: "Catppuccin Latte", family: "Catppuccin" },
  { name: "catppuccin-frappe", label: "Catppuccin Frappé", family: "Catppuccin" },
  { name: "catppuccin-macchiato", label: "Catppuccin Macchiato", family: "Catppuccin" },
  { name: "catppuccin-mocha", label: "Catppuccin Mocha", family: "Catppuccin" },
  { name: "one-light", label: "One Light", family: "One" },
  { name: "one-dark-pro", label: "One Dark Pro", family: "One" },
  { name: "solarized-light", label: "Solarized Light", family: "Solarized", accent: "#268bd2" },
  { name: "solarized-dark", label: "Solarized Dark", family: "Solarized", accent: "#268bd2" },
  { name: "gruvbox-light-medium", label: "Gruvbox Light", family: "Gruvbox" },
  { name: "gruvbox-dark-medium", label: "Gruvbox Dark", family: "Gruvbox" },
  { name: "everforest-light", label: "Everforest Light", family: "Everforest" },
  { name: "everforest-dark", label: "Everforest Dark", family: "Everforest" },
  { name: "kanagawa-lotus", label: "Kanagawa Lotus", family: "Kanagawa" },
  { name: "kanagawa-wave", label: "Kanagawa Wave", family: "Kanagawa" },
  { name: "kanagawa-dragon", label: "Kanagawa Dragon", family: "Kanagawa" },
  { name: "ayu-light", label: "Ayu Light", family: "Ayu" },
  { name: "ayu-mirage", label: "Ayu Mirage", family: "Ayu" },
  { name: "ayu-dark", label: "Ayu Dark", family: "Ayu" },
  { name: "night-owl-light", label: "Night Owl Light", family: "Night Owl" },
  { name: "night-owl", label: "Night Owl", family: "Night Owl", accent: "#82aaff", red: "#ef5350" },
  { name: "min-light", label: "Min Light", family: "Min" },
  { name: "min-dark", label: "Min Dark", family: "Min" },
  { name: "nord", label: "Nord", family: "Nord" },
  { name: "dracula", label: "Dracula", family: "Dracula", accent: "#bd93f9", warning: "#f1fa8c" },
  { name: "monokai", label: "Monokai", family: "Monokai", accent: "#66d9ef", red: "#f92672" },
  { name: "poimandres", label: "Poimandres", family: "Poimandres" },
  { name: "vesper", label: "Vesper", family: "Vesper" },
  { name: "houston", label: "Houston", family: "Houston" },
  { name: "vitesse-black", label: "Vitesse Black", family: "Vitesse" },
];

type Rgba = [number, number, number, number];

// Display P3 to linear sRGB (CSS Color 4). Out-of-gamut channels are clipped.
const P3_TO_SRGB = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];
const decode = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const encode = (channel: number) =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

/** A hex color, or a Display P3 color as the Pierre Vibrant themes write them. */
function parse(value: string | undefined): Rgba | undefined {
  const p3 =
    value && /^color\(display-p3 ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (p3) {
    const linear = [p3[1], p3[2], p3[3]].map((channel) => decode(Number(channel)));
    const srgb = P3_TO_SRGB.map((row) =>
      Math.round(
        255 *
          encode(
            Math.min(
              1,
              Math.max(
                0,
                row.reduce((sum, weight, index) => sum + weight * linear[index]!, 0),
              ),
            ),
          ),
      ),
    );
    return [srgb[0]!, srgb[1]!, srgb[2]!, p3[4] === undefined ? 1 : Number(p3[4])];
  }
  if (!value || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return undefined;
  let hex = value.slice(1);
  if (hex.length <= 4) hex = [...hex].map((digit) => digit + digit).join("");
  const channel = (index: number) => parseInt(hex.slice(index, index + 2), 16);
  return [channel(0), channel(2), channel(4), hex.length === 8 ? channel(6) / 255 : 1];
}
function format([r, g, b, a]: Rgba): string {
  const hex = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(a * 255) : ""}`;
}
/** `top` over an opaque `ground`. */
function over(top: Rgba, ground: Rgba): Rgba {
  const mix = (index: number) => top[index]! * top[3] + ground[index]! * (1 - top[3]);
  return [mix(0), mix(1), mix(2), 1];
}
/** `share` of `color` and the rest of `ground`, opaque. */
function mix(color: Rgba, ground: Rgba, share: number): Rgba {
  return over([color[0], color[1], color[2], share], ground);
}
function luminance([r, g, b]: Rgba): number {
  return 0.2126 * decode(r / 255) + 0.7152 * decode(g / 255) + 0.0722 * decode(b / 255);
}
function contrast(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}
function saturation([r, g, b]: Rgba): number {
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  return high ? (high - low) / high : 0;
}
/** Moves `color` toward `text` until it reads at `minimum` on `canvas`. */
function legible(color: Rgba, text: Rgba, canvas: Rgba, minimum: number): Rgba {
  for (let share = 0; share <= 1; share += 0.05) {
    const next = mix(text, color, share);
    if (contrast(next, canvas) >= minimum) return next;
  }
  return text;
}
const withAlpha = (color: Rgba, alpha: number): string =>
  format([...color.slice(0, 3), alpha] as Rgba);

async function loadTheme(
  name: string,
): Promise<{ type?: string; colors?: Record<string, string> }> {
  const require = createRequire(import.meta.url);
  if (name.startsWith("pierre-")) {
    // @pierre/theme comes with @pierre/diffs; its JSON files sit beside its build.
    const diffs = dirname(require.resolve("@pierre/diffs/package.json"));
    return JSON.parse(await readFile(join(diffs, "..", "theme", "themes", `${name}.json`), "utf8"));
  }
  const module = (await import(require.resolve(`@shikijs/themes/${name}`))) as {
    default: { type?: string; colors?: Record<string, string> };
  };
  return module.default;
}

async function derive(entry: Entry) {
  const theme = await loadTheme(entry.name);
  const colors = theme.colors ?? {};
  const dark = theme.type !== "light";
  const fallbackCanvas = parse(dark ? "#1e1e1e" : "#ffffff")!;
  const opaque = (key: string, ground: Rgba) => {
    const value = parse(colors[key]);
    return value && over(value, ground);
  };
  const first = (keys: string[], ground: Rgba) =>
    keys.map((key) => opaque(key, ground)).find(Boolean);

  const canvas = opaque("editor.background", fallbackCanvas) ?? fallbackCanvas;
  const text =
    first(["editor.foreground", "foreground"], canvas) ?? parse(dark ? "#d4d4d4" : "#1f1f1f")!;
  // A frame close to the canvas; a stark side bar would read as a second app.
  const panelColor = first(["sideBar.background", "activityBar.background"], canvas);
  const panel =
    panelColor && contrast(panelColor, canvas) < 1.35 ? panelColor : mix(text, canvas, 0.025);
  const raisedColor = first(
    ["editorWidget.background", "dropdown.background", "input.background"],
    canvas,
  );
  const raised =
    raisedColor && contrast(raisedColor, canvas) < 1.35 && raisedColor.join() !== canvas.join()
      ? raisedColor
      : mix(text, canvas, dark ? 0.05 : 0.03);
  const hover = mix(text, canvas, dark ? 0.08 : 0.055);
  const borderColor = first(
    ["panel.border", "sideBar.border", "editorGroup.border", "editorWidget.border"],
    canvas,
  );
  // Hairlines must stand off the canvas, toward the text: a border darker than
  // a dark canvas vanishes on the panel.
  const border =
    borderColor &&
    contrast(borderColor, canvas) >= 1.12 &&
    contrast(borderColor, canvas) < 1.9 &&
    luminance(borderColor) > luminance(canvas) === dark
      ? borderColor
      : mix(text, canvas, dark ? 0.13 : 0.12);
  const muted = legible(mix(text, canvas, 0.66), text, canvas, 4.5);
  const faint = legible(mix(text, canvas, 0.44), text, canvas, 2.6);

  const accentColor = [
    "textLink.foreground",
    "focusBorder",
    "button.background",
    "activityBarBadge.background",
    "gitDecoration.modifiedResourceForeground",
    "terminal.ansiBlue",
  ]
    .map((key) => opaque(key, canvas))
    .find((color) => color && saturation(color) > 0.2 && contrast(color, canvas) >= 2);
  const accent = legible(parse(entry.accent) ?? accentColor ?? text, text, canvas, 3);
  const selected = mix(accent, panel, dark ? 0.2 : 0.13);
  // Status colors must be colors: some themes set a gray for Git decorations.
  const signal = (keys: string[], fallback: string, override?: string) =>
    legible(
      parse(override) ??
        keys.map((key) => opaque(key, canvas)).find((color) => color && saturation(color) > 0.25) ??
        parse(fallback)!,
      text,
      canvas,
      3,
    );
  const green = signal(
    ["gitDecoration.addedResourceForeground", "terminal.ansiGreen"],
    dark ? "#7ec699" : "#1a7f37",
  );
  const red = signal(
    ["gitDecoration.deletedResourceForeground", "terminal.ansiRed", "errorForeground"],
    dark ? "#f08080" : "#cf222e",
    entry.red,
  );
  const warning = signal(
    ["editorWarning.foreground", "list.warningForeground", "terminal.ansiYellow"],
    dark ? "#e3b341" : "#9a6700",
    entry.warning,
  );

  // Editor colors keep their translucency; code-colors.ts composites them.
  const editor = (key: string) => {
    const color = parse(colors[key]);
    return color && format(color);
  };
  const matchBorder = editor("editor.findMatchBorder");
  return {
    id: entry.name,
    label: entry.label,
    family: entry.family,
    appearance: dark ? "dark" : "light",
    syntax: entry.name,
    source: entry.name.startsWith("pierre-")
      ? `@pierre/theme 2.0.0, themes/${entry.name}.json`
      : `@shikijs/themes, ${entry.name}`,
    palette: {
      canvas: format(canvas),
      panel: format(panel),
      raised: format(raised),
      hover: format(hover),
      border: format(border),
      text: format(text),
      muted: format(muted),
      faint: format(faint),
      accent: format(accent),
      selected: format(selected),
      green: format(green),
      red: format(red),
      warning: format(warning),
    },
    code: {
      selection: editor("editor.selectionBackground") ?? withAlpha(accent, 0.2),
      match: editor("editor.findMatchHighlightBackground") ?? withAlpha(warning, 0.2),
      matchCurrent: editor("editor.findMatchBackground") ?? withAlpha(warning, 0.45),
      ...(matchBorder && { matchBorder }),
      lineHighlight:
        editor("editor.lineHighlightBackground") ?? withAlpha(text, dark ? 0.04 : 0.035),
      insertedLine:
        editor("diffEditor.insertedLineBackground") ?? withAlpha(green, dark ? 0.15 : 0.12),
      insertedText:
        editor("diffEditor.insertedTextBackground") ?? withAlpha(green, dark ? 0.24 : 0.2),
      removedLine: editor("diffEditor.removedLineBackground") ?? withAlpha(red, dark ? 0.15 : 0.12),
      removedText: editor("diffEditor.removedTextBackground") ?? withAlpha(red, dark ? 0.24 : 0.2),
    },
  };
}

const generated = await Promise.all(entries.map(derive));
const out = resolve(import.meta.dirname, "..", "src", "web", "editor-themes.ts");
await writeFile(
  out,
  `// Generated by scripts/generate-editor-themes.ts. Do not edit.
import type { EditorTheme } from "./themes";

export const editorThemes: readonly EditorTheme[] = ${JSON.stringify(generated, null, 2)};
`,
);
console.log(`Wrote ${generated.length} themes to ${out}`);
