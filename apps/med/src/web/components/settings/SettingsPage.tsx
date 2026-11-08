import * as stylex from "@stylexjs/stylex";
import { MultiFileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef } from "react";
import { CODE_SIZES, useViewSetting, viewSettings } from "../../data/view-settings";
import { useDocumentTitle } from "../../data/document-title";
import { useSettingsFile } from "../../data/settings-file";
import { HIGHLIGHTER } from "../../pierre-theme";
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
import { diffSurfaceStyle } from "../diff-surface";
import { OpenInSettings } from "./OpenInSettings";
import { Icon } from "../Icon";
import { Row, Section, settingStyles, Switch, type SettingsSection } from "./SettingsParts";

export type { SettingsSection };

const MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * Settings, on one page as Linear lays a page out: the title, each section's
 * heading and the text in the cards share one left edge, and the cards reach
 * 20 pixels past it on each side. A row is a name and a note, with its
 * control at the right. `section` scrolls to a section, as from Display's
 * All code settings.
 */
export function SettingsPage({
  section,
  onSources,
}: {
  section?: SettingsSection;
  onSources(): void;
}) {
  // Above a vault's or a file's title, which the page covers.
  useDocumentTitle("Settings", 3);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const target = section && box?.querySelector<HTMLElement>(`[data-section="${section}"]`);
    if (box) box.scrollTop = target ? target.offsetTop - 24 : 0;
  }, [section]);
  const file = useSettingsFile();
  return (
    <div {...stylex.props(styles.page)}>
      <div ref={scroller} {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.column)}>
          <h1 {...stylex.props(styles.title)}>Settings</h1>
          <p {...stylex.props(styles.intro)}>
            {file ? (
              <>
                Each setting is also a key in{" "}
                <code {...stylex.props(styles.path)}>{file.path}</code>, so an agent can change it;
                Med applies a saved change at once.
              </>
            ) : (
              "How Med looks, and how it shows code."
            )}
          </p>
          <Appearance />
          <Code />
          <OpenInSettings />
          <Files />
          <Sources onSources={onSources} />
          {file && <FileSection file={file} />}
        </div>
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
    <Section
      id="appearance"
      title="Appearance"
      note="Med can follow your system between a light and a dark theme."
    >
      <Row label="Interface theme" block>
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
          trigger={settingStyles.select}
          label="Light theme"
          value={light.id}
          choices={choices("light")}
          onChange={(id) => themeController.setTheme(id)}
        />
      </Row>
      <Row label="Dark theme" note="In Dark, and in System while the system is dark.">
        <ChoiceSelect
          trigger={settingStyles.select}
          label="Dark theme"
          value={dark.id}
          choices={choices("dark")}
          onChange={(id) => themeController.setTheme(id)}
        />
      </Row>
    </Section>
  );
}

function Code() {
  const layout = useViewSetting(viewSettings.diffLayout);
  const wrap = useViewSetting(viewSettings.wrap);
  const comments = useViewSetting(viewSettings.comments);
  const size = useViewSetting(viewSettings.codeSize);
  return (
    <Section id="code" title="Code" note="How diffs and files show code.">
      <Row label="Diff layout" note="Split needs a review at least 760 pixels wide.">
        <ChoiceSelect
          trigger={settingStyles.select}
          label="Diff layout"
          value={layout}
          choices={[
            { value: "split", label: "Split" },
            { value: "unified", label: "Unified" },
          ]}
          onChange={(value) => viewSettings.diffLayout.set(value as "split" | "unified")}
        />
      </Row>
      <Row label="Wrap long lines" note="Otherwise long lines scroll sideways.">
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
          trigger={settingStyles.select}
          label="Text size"
          value={size}
          choices={CODE_SIZES.map((value) => ({ value, label: `${value} px` }))}
          onChange={(value) => viewSettings.codeSize.set(value as (typeof CODE_SIZES)[number])}
        />
      </Row>
      <Row label="Preview" note="A change in your theme, with the choices above." block>
        <DiffSample layout={layout} wrap={wrap === "on"} />
      </Row>
    </Section>
  );
}

function Files() {
  const vim = useViewSetting(viewSettings.vim);
  const blame = useViewSetting(viewSettings.lineBlame);
  const preview = useViewSetting(viewSettings.filePreview);
  const followUp = useViewSetting(viewSettings.followUp);
  const flip = (setting: typeof viewSettings.vim, value: "on" | "off") =>
    setting.set(value === "on" ? "off" : "on");
  return (
    <Section
      id="files"
      title="Files and sessions"
      note="Editing files, finding them, and messages to an agent."
    >
      <Row label="Vim keys" note="In files you open.">
        <Switch label="Vim keys" on={vim === "on"} toggle={() => flip(viewSettings.vim, vim)} />
      </Row>
      <Row label="Blame on the cursor's line" note="Its author, age, and commit, after the line.">
        <Switch
          label="Blame on the cursor's line"
          on={blame === "on"}
          toggle={() => flip(viewSettings.lineBlame, blame)}
        />
      </Row>
      <Row label="Preview in Find file" note="The chosen file beside the results.">
        <Switch
          label="Preview in Find file"
          on={preview === "on"}
          toggle={() => flip(viewSettings.filePreview, preview)}
        />
      </Row>
      <Row label="A message while the agent works" note="⌘↩ does this; ⇧⌘↩ does the other.">
        <ChoiceSelect
          trigger={settingStyles.select}
          label="A message while the agent works"
          value={followUp}
          choices={[
            { value: "now", label: "Send at its next step" },
            { value: "queue", label: "Queue for the turn's end" },
          ]}
          onChange={(value) => viewSettings.followUp.set(value as "now" | "queue")}
        />
      </Row>
    </Section>
  );
}

function Sources({ onSources }: { onSources(): void }) {
  const pull = useViewSetting(viewSettings.pullBase);
  return (
    <Section id="sources" title="Sources" note="The repositories and folders that Med shows.">
      <Row label="Repositories and folders">
        <button type="button" onClick={onSources} {...stylex.props(settingStyles.link)}>
          Open Sources
        </button>
      </Row>
      <Row
        label="Pull base branches"
        note="Every 15 minutes, each repository's main branch moves up to its remote's, where nothing of yours would change."
      >
        <Switch
          label="Pull base branches"
          on={pull === "on"}
          toggle={() => viewSettings.pullBase.set(pull === "on" ? "off" : "on")}
        />
      </Row>
    </Section>
  );
}

/** The settings file, which an agent can edit: its path, and what it holds. */
function FileSection({ file }: { file: NonNullable<ReturnType<typeof useSettingsFile>> }) {
  const text = JSON.stringify(file.settings, null, 2);
  return (
    <Section
      id="file"
      title="Settings file"
      note="What the file holds now. Keys left out keep their defaults."
    >
      <div aria-label="Settings file" role="region">
        {file.error && (
          <p role="alert" {...stylex.props(styles.fileError)}>
            {file.error}
          </p>
        )}
        <pre {...stylex.props(styles.fileText)}>{text}</pre>
      </div>
    </Section>
  );
}

// A made-up change for the preview: a config that waits longer and retries.
const SAMPLE_BEFORE = `const config = {
  url: "api.acme.build",
  timeout: 5000,
  debug: true,
};
`;
const SAMPLE_AFTER = `const config = {
  url: "api.acme.build",
  timeout: 8000,
  retries: 2,
};
`;

/** A small diff as the review shows one: the theme on screen, its layout,
 * wrap, and text size, so a choice shows at once. */
function DiffSample({ layout, wrap }: { layout: "split" | "unified"; wrap: boolean }) {
  const { active } = useTheme();
  const options = useMemo(
    () => ({
      theme: active.pierreTheme,
      preferredHighlighter: HIGHLIGHTER,
      themeType: active.appearance,
      diffStyle: layout,
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      diffIndicators: "bars" as const,
      lineDiffType: "word-alt" as const,
      disableFileHeader: true,
    }),
    [active, layout, wrap],
  );
  return (
    <div aria-label="A diff in your theme" role="img" {...stylex.props(styles.sample)}>
      <MultiFileDiff
        oldFile={{ name: "config.ts", contents: SAMPLE_BEFORE }}
        newFile={{ name: "config.ts", contents: SAMPLE_AFTER }}
        options={options}
        style={diffSurfaceStyle as never}
      />
    </div>
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
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    WebkitFontSmoothing: "antialiased",
  },
  card: {
    flex: "1",
    minWidth: 0,
    overflowY: "auto",
    backgroundColor: tokens.canvas,
  },
  // The text's column; the cards reach 20 pixels past it on each side.
  column: {
    boxSizing: "content-box",
    maxWidth: 640,
    marginInline: "auto",
    paddingInline: 44,
    paddingTop: 56,
    paddingBottom: 72,
  },
  title: {
    margin: 0,
    fontSize: 26,
    lineHeight: 1.2,
    fontWeight: 550,
    letterSpacing: "-0.022em",
  },
  intro: { margin: 0, marginTop: 8, color: tokens.muted, fontSize: 15, lineHeight: 1.5 },
  path: { fontFamily: tokens.code, fontSize: 13, color: tokens.text },
  fileError: { margin: 0, paddingTop: 14, color: tokens.red, fontSize: 13 },
  fileText: {
    margin: 0,
    paddingBlock: 14,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 12.5,
    lineHeight: 1.6,
    overflowX: "auto",
  },
  sample: {
    overflow: "hidden",
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    backgroundColor: tokens.canvas,
  },
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
});
