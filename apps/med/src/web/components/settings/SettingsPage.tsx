import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { CODE_SIZES, useViewSetting, viewSettings } from "../../data/view-settings";
import { tokens } from "../../theme.stylex";
import {
  THEME_MODES,
  themeController,
  themes,
  useTheme,
  type Theme,
  type ThemeMode,
} from "../../themes";
import { ChoiceSelect } from "../Controls";
import { Icon } from "../Icon";

export type SettingsSection = "appearance" | "code";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "code", label: "Code" },
];

const MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * Settings, as Linear lays them out: the sections on the left, and on the
 * right one column of rows, each a label and its control. Sources keep their
 * own page, which the list opens.
 */
export function SettingsPage({
  section,
  onSection,
  onSources,
}: {
  section: SettingsSection;
  onSection(section: SettingsSection): void;
  onSources(): void;
}) {
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <nav aria-label="Settings" {...stylex.props(styles.nav)}>
          <h1 {...stylex.props(styles.navTitle)}>Settings</h1>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-current={section === entry.id ? "page" : undefined}
              onClick={() => onSection(entry.id)}
              {...stylex.props(styles.navItem, section === entry.id && styles.navCurrent)}
            >
              {entry.label}
            </button>
          ))}
          <button type="button" onClick={onSources} {...stylex.props(styles.navItem)}>
            Sources
          </button>
        </nav>
        <main {...stylex.props(styles.main)}>
          <div {...stylex.props(styles.column)}>
            {section === "appearance" ? <Appearance /> : <Code />}
          </div>
        </main>
      </div>
    </div>
  );
}

function Appearance() {
  const { mode, light, dark } = useTheme();
  const choices = (appearance: Theme["appearance"]) =>
    themes
      .filter((theme) => theme.appearance === appearance)
      .map((theme) => ({ value: theme.id, label: theme.label }));
  return (
    <>
      <h2 {...stylex.props(styles.title)}>Appearance</h2>
      <Group title="Theme">
        <Row
          label="Interface theme"
          note="Med can follow your system, from light to dark and back."
          block
        >
          <div role="radiogroup" aria-label="Interface theme" {...stylex.props(styles.modes)}>
            {THEME_MODES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => themeController.setMode(value)}
                {...stylex.props(styles.mode, mode === value && styles.modeOn)}
              >
                <ThemeSwatch light={light} dark={dark} mode={value} on={mode === value} />
                <span {...stylex.props(styles.modeLabel)}>
                  {mode === value && <Icon name="check" size={12} />}
                  {MODE_LABELS[value]}
                </span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Light theme" note="In Light, and in System while the system is light.">
          <ChoiceSelect
            label="Light theme"
            value={light.id}
            choices={choices("light")}
            onChange={(id) => themeController.setTheme(id)}
          />
        </Row>
        <Row label="Dark theme" note="In Dark, and in System while the system is dark.">
          <ChoiceSelect
            label="Dark theme"
            value={dark.id}
            choices={choices("dark")}
            onChange={(id) => themeController.setTheme(id)}
          />
        </Row>
      </Group>
    </>
  );
}

function Code() {
  const layout = useViewSetting(viewSettings.diffLayout);
  const wrap = useViewSetting(viewSettings.wrap);
  const comments = useViewSetting(viewSettings.comments);
  const size = useViewSetting(viewSettings.codeSize);
  return (
    <>
      <h2 {...stylex.props(styles.title)}>Code</h2>
      <Group title="Diffs">
        <Row label="Diff layout" note="Split needs a review at least 760 pixels wide.">
          <ChoiceSelect
            label="Diff layout"
            value={layout}
            choices={[
              { value: "split", label: "Split" },
              { value: "unified", label: "Unified" },
            ]}
            onChange={(value) => viewSettings.diffLayout.set(value as "split" | "unified")}
          />
        </Row>
        <Row label="Wrap long lines">
          <Switch
            label="Wrap long lines"
            on={wrap === "on"}
            toggle={() => viewSettings.wrap.set(wrap === "on" ? "off" : "on")}
          />
        </Row>
        <Row label="Comments in the diff" note="Writing or opening a comment shows them again.">
          <Switch
            label="Comments in the diff"
            on={comments === "shown"}
            toggle={() => viewSettings.comments.set(comments === "shown" ? "hidden" : "shown")}
          />
        </Row>
        <Row label="Text size" note="Of code in diffs and files.">
          <ChoiceSelect
            label="Text size"
            value={size}
            choices={CODE_SIZES.map((value) => ({ value, label: `${value} px` }))}
            onChange={(value) => viewSettings.codeSize.set(value as (typeof CODE_SIZES)[number])}
          />
        </Row>
      </Group>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} {...stylex.props(styles.group)}>
      <h3 {...stylex.props(styles.groupTitle)}>{title}</h3>
      <div {...stylex.props(styles.rows)}>{children}</div>
    </section>
  );
}

/** A setting: its label and note, and its control beside them, or under
 * them (`block`) when the control is wide. */
function Row({
  label,
  note,
  block = false,
  children,
}: {
  label: string;
  note?: string;
  block?: boolean;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.row, block && styles.rowBlock)}>
      <div {...stylex.props(styles.rowText)}>
        <div {...stylex.props(styles.rowLabel)}>{label}</div>
        {note && <div {...stylex.props(styles.rowNote)}>{note}</div>}
      </div>
      {children}
    </div>
  );
}

function Switch({ label, on, toggle }: { label: string; on: boolean; toggle(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={toggle}
      {...stylex.props(styles.switch, on && styles.switchOn)}
    >
      <span {...stylex.props(styles.knob, on && styles.knobOn)} />
    </button>
  );
}

/** A small window in a theme's colors; System shows the light one and the
 * dark one side by side. */
function ThemeSwatch({
  light,
  dark,
  mode,
  on,
}: {
  light: Theme;
  dark: Theme;
  mode: ThemeMode;
  on: boolean;
}) {
  const window = (theme: Theme) => (
    <span {...stylex.props(styles.swatchWindow, styles.swatchColors(theme.palette.panel))}>
      <span {...stylex.props(styles.swatchCard, styles.swatchColors(theme.palette.canvas))}>
        <span {...stylex.props(styles.swatchLine, styles.swatchInk(theme.palette.accent, 0.9))} />
        <span {...stylex.props(styles.swatchLine, styles.swatchInk(theme.palette.text, 0.35))} />
        <span
          {...stylex.props(
            styles.swatchLine,
            styles.swatchShort,
            styles.swatchInk(theme.palette.text, 0.2),
          )}
        />
      </span>
    </span>
  );
  if (mode !== "system")
    return (
      <span aria-hidden="true" {...stylex.props(styles.swatch, on && styles.swatchOn)}>
        {window(mode === "light" ? light : dark)}
      </span>
    );
  return (
    <span aria-hidden="true" {...stylex.props(styles.swatch, on && styles.swatchOn)}>
      {window(light)}
      <span {...stylex.props(styles.swatchHalf)}>{window(dark)}</span>
    </span>
  );
}

const styles = stylex.create({
  page: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    padding: 6,
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    WebkitFontSmoothing: "antialiased",
  },
  card: {
    flex: "1",
    minWidth: 0,
    display: "flex",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: tokens.frame,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    flexShrink: 0,
    width: 200,
    paddingBlock: 14,
    paddingInline: 10,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: tokens.line,
  },
  navTitle: {
    margin: 0,
    marginBottom: 10,
    paddingInline: 8,
    color: tokens.muted,
    fontSize: 12,
    fontWeight: 500,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    height: 28,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  navCurrent: { backgroundColor: tokens.fill, fontWeight: 500 },
  main: { flex: "1", minWidth: 0, overflowY: "auto" },
  column: {
    maxWidth: 640,
    marginInline: "auto",
    paddingInline: 32,
    paddingTop: 48,
    paddingBottom: 64,
  },
  title: { margin: 0, marginBottom: 28, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" },
  group: { marginBottom: 32 },
  groupTitle: { margin: 0, marginBottom: 10, fontSize: 13, fontWeight: 600 },
  rows: {
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    backgroundColor: tokens.panel,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
    minHeight: 60,
    paddingBlock: 12,
    paddingInline: 16,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  rowBlock: { flexDirection: "column", alignItems: "stretch", gap: 14 },
  rowText: { minWidth: 0 },
  rowLabel: { fontWeight: 500 },
  rowNote: { marginTop: 3, color: tokens.muted, fontSize: 12 },
  modes: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 },
  mode: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.muted,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    borderRadius: `calc(8px * ${tokens.round})`,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: 3,
  },
  modeOn: { color: tokens.text },
  modeLabel: { display: "flex", alignItems: "center", gap: 5, paddingInline: 2, fontSize: 12.5 },
  swatch: {
    position: "relative",
    display: "block",
    height: 84,
    overflow: "hidden",
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  // The chosen mode's ring.
  swatchOn: { boxShadow: `0 0 0 2px ${tokens.accent}` },
  swatchWindow: {
    position: "absolute",
    inset: 0,
    display: "block",
    paddingTop: 14,
    paddingLeft: 16,
  },
  swatchHalf: {
    position: "absolute",
    inset: 0,
    clipPath: "polygon(55% 0, 100% 0, 100% 100%, 45% 100%)",
  },
  swatchCard: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    height: "100%",
    paddingTop: 12,
    paddingLeft: 12,
    borderTopLeftRadius: 6,
  },
  swatchLine: { display: "block", width: "70%", height: 5, borderRadius: 3 },
  swatchShort: { width: "45%" },
  swatchColors: (background: string) => ({ backgroundColor: background }),
  swatchInk: (color: string, opacity: number) => ({ backgroundColor: color, opacity }),
  switch: {
    position: "relative",
    flexShrink: 0,
    width: 30,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderRadius: 9,
    backgroundColor: tokens.border,
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: 2,
  },
  switchOn: { backgroundColor: tokens.accent },
  knob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    boxShadow: "0 1px 2px #0003",
    transitionProperty: "transform",
    transitionDuration: "120ms",
  },
  knobOn: { transform: "translateX(12px)" },
});
