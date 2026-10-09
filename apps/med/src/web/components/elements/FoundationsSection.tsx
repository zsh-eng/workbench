import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../theme.stylex";
import { themes, useTheme, type Theme, type ThemePalette } from "../../themes";
import { Icon, iconNames } from "../Icon";
import { Section, Specimen } from "./Specimen";

const roles: Record<Exclude<keyof ThemePalette, "shadow">, string> = {
  panel: "App frame, sidebars, pages",
  canvas: "Review card and code",
  raised: "Popovers, menus, palettes",
  hover: "Editor gutter hover",
  border: "Editor and local-file edges",
  text: "Primary text",
  muted: "Secondary text and idle controls",
  faint: "Metadata, line numbers, hashes",
  accent: "Focus, active state, links",
  selected: "Selected rows",
  green: "Additions",
  red: "Removals and errors",
  warning: "Warnings and search matches",
};

const layers = [
  ["line", "Hairlines and row rules"],
  ["lineStrong", "Popover edges, hover edges"],
  ["fill", "Control hover, inputs"],
  ["fillStrong", "Menu highlight, pressed"],
  ["accentSoft", "Active control, ref chips"],
  ["accentLine", "Focus rings"],
] as const;

function hexRgb(hex: string) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
}
function ratio(foreground: string, background: string) {
  const lum = (hex: string) => {
    const [r, g, b] = hexRgb(hex).map((v) =>
      v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [a, b] = [lum(foreground), lum(background)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

function Palette({ theme }: { theme: Theme }) {
  return (
    <div {...stylex.props(styles.swatches)}>
      {(Object.keys(roles) as (keyof typeof roles)[]).map((name) => {
        const value = theme.palette[name];
        const text = ["text", "muted", "faint", "accent", "green", "red", "warning"].includes(name);
        const contrast = text ? ratio(value, theme.palette.canvas) : null;
        return (
          <div key={name} {...stylex.props(styles.swatchCard)}>
            <div {...stylex.props(styles.swatchColor, paint.fill(value))}>
              {text && (
                <span
                  {...stylex.props(styles.swatchSample, paint.inkOn(value, theme.palette.canvas))}
                >
                  Aa
                </span>
              )}
            </div>
            <div {...stylex.props(styles.swatchMeta)}>
              <span {...stylex.props(styles.swatchName)}>{name}</span>
              <span {...stylex.props(styles.swatchValue)}>{value}</span>
            </div>
            <span {...stylex.props(styles.swatchRole)}>{roles[name]}</span>
            {contrast !== null && (
              <span
                {...stylex.props(styles.swatchContrast, contrast < 4.5 && styles.swatchLow)}
                title="Contrast with canvas"
              >
                {contrast.toFixed(1)} : 1 on canvas
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThemeMatrix({ onPick }: { onPick(id: string): void }) {
  const { active } = useTheme();
  const keys = [
    "panel",
    "canvas",
    "raised",
    "text",
    "muted",
    "faint",
    "accent",
    "selected",
    "green",
    "red",
    "warning",
  ] as const;
  return (
    <div {...stylex.props(styles.matrix)}>
      {themes.map((theme) => (
        <button
          key={theme.id}
          type="button"
          aria-current={theme.id === active.id}
          onClick={() => onPick(theme.id)}
          {...stylex.props(
            styles.matrixRow,
            paint.inkOn(theme.palette.text, theme.palette.panel),
            theme.id === active.id && styles.matrixActive,
          )}
        >
          <span {...stylex.props(styles.matrixLabel)}>
            <span>{theme.label}</span>
            <span {...stylex.props(paint.ink(theme.palette.faint))}>{theme.appearance}</span>
          </span>
          <span {...stylex.props(styles.matrixCard, paint.fill(theme.palette.canvas))}>
            <span {...stylex.props(paint.ink(theme.palette.text))}>relativeTime</span>
            <span {...stylex.props(paint.ink(theme.palette.muted))}>(now)</span>
            <span {...stylex.props(paint.ink(theme.palette.green))}>+18</span>
            <span {...stylex.props(paint.ink(theme.palette.red))}>−4</span>
            <span
              {...stylex.props(
                styles.matrixChip,
                paint.inkOn(
                  theme.palette.accent,
                  `color-mix(in srgb, ${theme.palette.accent} 15%, transparent)`,
                ),
              )}
            >
              main
            </span>
          </span>
          <span {...stylex.props(styles.matrixStrip)}>
            {keys.map((name) => (
              <span
                key={name}
                title={`${name} ${theme.palette[name]}`}
                {...stylex.props(styles.matrixCell, paint.fill(theme.palette[name]))}
              />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

const typeScale = [
  { size: 22, weight: 600, role: "Page title", sample: "Sources" },
  { size: 15, weight: 600, role: "Section title", sample: "Code colors" },
  { size: 13, weight: 500, role: "Dialog title, brief body", sample: "Save this review" },
  {
    size: 12.5,
    weight: 400,
    role: "Lists, rows, commit subjects",
    sample: "feat(med): link agent sessions",
  },
  { size: 12, weight: 450, role: "Controls, menus, body", sample: "Open in editor" },
  { size: 11.5, weight: 500, role: "Panel headings", sample: "History" },
  { size: 11, weight: 400, role: "Metadata", sample: "Sam Rivera · 3 hr ago" },
  { size: 10.5, weight: 400, role: "Hashes, counts (code font)", sample: "ab41597", code: true },
];

export function FoundationsSection({ onPickTheme }: { onPickTheme(id: string): void }) {
  const { active } = useTheme();
  return (
    <Section
      id="foundations"
      title="Foundations"
      lede="The palette each theme supplies, the translucent layers Med derives from it, type, shape, and icons."
    >
      <Specimen
        title={`${active.label} palette`}
        note="Contrast is measured on canvas."
        surface="panel"
      >
        <Palette theme={active} />
      </Specimen>
      <Specimen
        title="Layers"
        note="Derived from text and accent, so one value reads the same on every surface."
        span="half"
      >
        <div {...stylex.props(styles.layers)}>
          {layers.map(([name, role]) => (
            <div key={name} {...stylex.props(styles.layer)}>
              <span {...stylex.props(styles.layerChip, layerStyles[name])} />
              <span {...stylex.props(styles.swatchName)}>{name}</span>
              <span {...stylex.props(styles.swatchRole)}>{role}</span>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen
        title="Depth"
        note="Frame, card, and popover with the theme shadow."
        span="half"
        surface="panel"
      >
        <div {...stylex.props(styles.depth)}>
          <div {...stylex.props(styles.depthCard)}>
            canvas
            <div {...stylex.props(styles.depthPopover)}>raised · shadow · radius 10</div>
          </div>
        </div>
      </Specimen>
      <Specimen title="All themes" note="Click a theme to preview it on this page." surface="panel">
        <ThemeMatrix onPick={onPickTheme} />
      </Specimen>
      <Specimen
        title="Type"
        note="Geist for UI and Paper Mono for code. Sizes in use; 10–10.5, 11–11.5, and 12–12.5 are candidates to merge."
        span="half"
      >
        <div {...stylex.props(styles.type)}>
          {typeScale.map((entry) => (
            <div key={entry.size} {...stylex.props(styles.typeRow)}>
              <span {...stylex.props(styles.typeMeta)}>
                {entry.size}/{entry.weight}
              </span>
              <span
                {...stylex.props(
                  styles.typeSample,
                  entry.code && styles.code,
                  paint.type(entry.size, entry.weight),
                )}
              >
                {entry.sample}
              </span>
              <span {...stylex.props(styles.typeRole)}>{entry.role}</span>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen title="Shape" note="Radius grows with the size of the surface." span="half">
        <div {...stylex.props(styles.shapes)}>
          {[
            [4, "Chips"],
            [6, "Controls"],
            [7, "Rows"],
            [10, "Cards, popovers"],
            [12, "Palettes"],
          ].map(([radius, role]) => (
            <div key={radius} {...stylex.props(styles.shape)}>
              <span {...stylex.props(styles.shapeBox, paint.radius(radius as number))} />
              <span {...stylex.props(styles.swatchName)}>{radius}</span>
              <span {...stylex.props(styles.swatchRole)}>{role}</span>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen title="Icons" note="16-unit grid, 1.5 stroke, current color.">
        <div {...stylex.props(styles.icons)}>
          {iconNames.map((name) => (
            <div key={name} {...stylex.props(styles.icon)} title={name}>
              <Icon name={name} size={16} />
              <span {...stylex.props(styles.iconName)}>{name}</span>
            </div>
          ))}
        </div>
      </Specimen>
    </Section>
  );
}

// Other themes' colors are values, not tokens, so these styles take them as arguments.
const paint = stylex.create({
  fill: (color: string) => ({ backgroundColor: color }),
  ink: (color: string) => ({ color }),
  inkOn: (color: string, background: string) => ({ color, backgroundColor: background }),
  type: (size: number, weight: number) => ({ fontSize: size, fontWeight: weight }),
  radius: (radius: number) => ({ borderRadius: radius }),
});

const layerStyles = stylex.create({
  line: { backgroundColor: tokens.line },
  lineStrong: { backgroundColor: tokens.lineStrong },
  fill: { backgroundColor: tokens.fill },
  fillStrong: { backgroundColor: tokens.fillStrong },
  accentSoft: { backgroundColor: tokens.accentSoft },
  accentLine: { backgroundColor: tokens.accentLine },
});

const styles = stylex.create({
  swatches: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: 10,
  },
  swatchCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 6,
    paddingBottom: 10,
    borderRadius: 10,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  swatchColor: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    height: 56,
    padding: 6,
    boxSizing: "border-box",
    borderRadius: 6,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  swatchSample: {
    paddingInline: 6,
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
    lineHeight: "18px",
  },
  swatchMeta: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
    paddingInline: 4,
  },
  swatchName: { color: tokens.text, fontSize: 12, fontWeight: 500 },
  swatchValue: { color: tokens.faint, fontFamily: tokens.code, fontSize: 10.5 },
  swatchRole: { paddingInline: 4, color: tokens.muted, fontSize: 11, lineHeight: 1.4 },
  swatchContrast: {
    paddingInline: 4,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
  },
  swatchLow: { color: tokens.warning },
  layers: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 },
  layer: { display: "flex", flexDirection: "column", gap: 4 },
  layerChip: {
    height: 40,
    borderRadius: 6,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  depth: { display: "grid", placeItems: "center", minHeight: 150 },
  depthCard: {
    position: "relative",
    width: "min(320px, 100%)",
    height: 120,
    padding: 12,
    boxSizing: "border-box",
    borderRadius: 10,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    color: tokens.faint,
    fontSize: 11,
  },
  depthPopover: {
    position: "absolute",
    right: -12,
    bottom: -14,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    backgroundColor: tokens.raised,
    boxShadow: tokens.shadow,
    color: tokens.muted,
    fontSize: 11,
  },
  matrix: { display: "grid", gap: 6 },
  matrixRow: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 900px)": "160px minmax(0, 1fr) auto",
    },
    alignItems: "center",
    gap: 12,
    padding: 8,
    borderWidth: 0,
    borderRadius: 10,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    fontFamily: tokens.ui,
    fontSize: 12,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  matrixActive: { boxShadow: `0 0 0 2px ${tokens.accent}` },
  matrixLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingInline: 4,
    fontWeight: 500,
  },
  matrixCard: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    height: 32,
    paddingInline: 10,
    borderRadius: 7,
    fontFamily: tokens.code,
    fontSize: 11.5,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  matrixChip: {
    paddingInline: 5,
    borderRadius: 4,
    fontFamily: tokens.ui,
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: "16px",
  },
  matrixStrip: { display: "flex", gap: 3 },
  matrixCell: {
    width: 18,
    height: 18,
    borderRadius: 4,
    boxShadow: "inset 0 0 0 1px rgb(127 127 127 / 0.25)",
  },
  type: { display: "grid", gap: 10 },
  typeRow: {
    display: "grid",
    gridTemplateColumns: "56px minmax(0, 1fr)",
    columnGap: 12,
    alignItems: "baseline",
  },
  typeMeta: {
    gridRow: "span 2",
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
  },
  typeSample: {
    color: tokens.text,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  code: { fontFamily: tokens.code },
  typeRole: { color: tokens.faint, fontSize: 11 },
  shapes: { display: "flex", flexWrap: "wrap", gap: 18 },
  shape: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 },
  shapeBox: {
    width: 64,
    height: 44,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}`,
  },
  icons: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
    gap: 4,
  },
  icon: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    paddingBlock: 12,
    paddingInline: 4,
    borderRadius: 7,
    color: tokens.text,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
  },
  iconName: { color: tokens.faint, fontSize: 10.5 },
});
