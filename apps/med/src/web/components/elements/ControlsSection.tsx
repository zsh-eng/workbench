import * as stylex from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";
import { tokens, ui } from "../../theme.stylex";
import {
  ActionMenu,
  ChoiceSelect,
  CommandDialog,
  SegmentedControl,
  type ReviewCommand,
} from "../Controls";
import { Icon, type IconName } from "../Icon";
import { KeySequence, ShortcutKeys } from "../ShortcutKeys";
import { ActionTooltip, ToolButton } from "../ToolButton";
import { Section, Specimen } from "./Specimen";

const noop = () => {};

/** One control with the name of the state it shows. */
function Cell({
  label,
  stretch = false,
  children,
}: {
  label: string;
  stretch?: boolean;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.cell, stretch && styles.stretch)}>
      {children}
      <span {...stylex.props(styles.label)}>{label}</span>
    </div>
  );
}

/** The `ui` button looks, each with the label the app gives it. */
const buttons: {
  state: string;
  text?: string;
  label?: string;
  icon?: IconName;
  look?: stylex.StyleXStyles;
  pressed?: boolean;
  disabled?: boolean;
}[] = [
  { state: "Default", text: "Open before" },
  { state: "Icon and text", text: "Copy path", icon: "copy" },
  { state: "Active", text: "Comments", icon: "note", look: ui.active, pressed: true },
  { state: "Primary", text: "Review", look: ui.primary },
  { state: "Outlined", text: "Push", icon: "push", look: ui.outlined },
  { state: "Icon only", label: "More options", icon: "more", look: ui.iconButton },
  { state: "Disabled", text: "Open before", disabled: true },
  { state: "Disabled primary", text: "Push", look: ui.primary, disabled: true },
];

/** Key notation from `data/keys.ts`; legacy glyph strings still render. */
const keyExamples = [
  { value: "Mod+K", sequence: false },
  { value: "Mod+Shift+K", sequence: false },
  { value: "↑ ↓", sequence: false },
  { value: "g g", sequence: true },
  { value: "Mod+Shift+K", sequence: true },
  { value: ": {line} Enter", sequence: true },
];

const comparisonChoices = [
  {
    value: "working",
    label: "Working changes",
    description: "HEAD to working files, including untracked",
  },
  { value: "staged", label: "Staged changes", description: "HEAD to the index" },
  { value: "unstaged", label: "Unstaged changes", description: "Index to working files" },
];

const remoteChoices = [
  { value: "origin", label: "origin" },
  { value: "upstream", label: "upstream" },
];

const commands: ReviewCommand[] = [
  { id: "open-file", label: "Find file in this workspace", shortcut: "Mod+Shift+K", run: noop },
  { id: "find", label: "Find in diff contents", shortcut: "Mod+F", run: noop },
  {
    id: "content-search",
    label: "Search workspace file contents",
    shortcut: "Mod+Shift+F",
    run: noop,
  },
  { id: "layout", label: "Use split diff layout", run: noop },
  { id: "next-hunk", label: "Go to next hunk", shortcut: "]", run: noop },
  { id: "open-branch", label: "Open branch or worktree", shortcut: "Mod+Shift+G", run: noop },
  { id: "zen", label: "Enter zen mode", shortcut: "Alt+Z", run: noop },
  { id: "theme", label: "Change color theme", run: noop },
  { id: "help", label: "Show keyboard shortcuts", shortcut: "?", run: noop },
  { id: "close-file", label: "Close current file", shortcut: "Alt+W", disabled: true, run: noop },
];

function ToolButtons() {
  const [blame, setBlame] = useState(true);
  return (
    <div {...stylex.props(styles.row)}>
      <Cell label="Idle">
        <ToolButton label="Commands" shortcut="Mod+K" icon="search" />
      </Cell>
      <Cell label="Active">
        <ToolButton
          label="Toggle Git blame"
          shortcut="Alt+B"
          icon="history"
          active={blame}
          aria-pressed={blame}
          onClick={() => setBlame(!blame)}
        />
      </Cell>
      <Cell label="Busy">
        <ToolButton label="Refresh review" icon="refresh" busy />
      </Cell>
      <Cell label="Disabled">
        <ToolButton label="Zen mode" shortcut="Alt+Z" icon="focus" disabled />
      </Cell>
    </div>
  );
}

function Segmented() {
  const [layout, setLayout] = useState<"split" | "unified">("unified");
  return (
    <SegmentedControl<"split" | "unified">
      label="Diff layout"
      value={layout}
      onChange={setLayout}
      options={[
        { value: "split", label: "Split", icon: "split" },
        { value: "unified", label: "Unified", icon: "unified" },
      ]}
    />
  );
}

function Choices() {
  const [comparison, setComparison] = useState("working");
  const [remote, setRemote] = useState("origin");
  return (
    <div {...stylex.props(styles.row)}>
      <Cell label="With descriptions">
        <ChoiceSelect
          label="Comparison"
          value={comparison}
          choices={comparisonChoices}
          onChange={setComparison}
        />
      </Cell>
      <Cell label="Plain">
        <ChoiceSelect
          label="Push remote"
          value={remote}
          choices={remoteChoices}
          onChange={setRemote}
        />
      </Cell>
    </div>
  );
}

function Menus() {
  const [notes, setNotes] = useState(true);
  const [wrap, setWrap] = useState(false);
  return (
    <div {...stylex.props(styles.row)}>
      <Cell label="View options">
        <ActionMenu
          sections={[
            [
              { label: "Open working file", onClick: noop },
              { label: "Reveal in Files", onClick: noop },
            ],
            [
              { label: "Find in diffs", shortcut: "Mod+F", onClick: noop },
              { label: "Compare revisions…", onClick: noop },
            ],
            [
              { label: "Show review notes", checked: notes, onClick: () => setNotes(!notes) },
              { label: "Wrap long lines", checked: wrap, onClick: () => setWrap(!wrap) },
            ],
            [
              { label: "Zen mode", shortcut: "Alt+Z", onClick: noop },
              { label: "Refresh review", disabled: true, onClick: noop },
            ],
          ]}
        />
      </Cell>
      <Cell label="Own trigger">
        <ActionMenu
          label="Brief options"
          sections={[
            [
              { label: "Paste a new brief", shortcut: "Mod+V", onClick: noop },
              { label: "Copy brief text", onClick: noop },
            ],
            [{ label: "Remove brief", onClick: noop }],
          ]}
        >
          <Icon name="more" size={15} />
        </ActionMenu>
      </Cell>
    </div>
  );
}

function Palette() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        {...stylex.props(ui.button, ui.outlined, ui.pressable)}
      >
        <Icon name="command" size={14} />
        Open command palette
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} commands={commands} />
    </>
  );
}

export function ControlsSection() {
  return (
    <Section
      id="controls"
      title="Controls"
      lede="Buttons, inputs, menus, and tooltips. Each one is the component the app uses, so a change here shows in the app."
    >
      <Specimen title="Buttons" note="Hover and press to see states.">
        <div {...stylex.props(styles.row)}>
          {buttons.map(({ state, text, label, icon, look, pressed, disabled }) => (
            <Cell key={state} label={state}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={pressed}
                aria-label={label}
                {...stylex.props(ui.button, ui.pressable, look)}
              >
                {icon && <Icon name={icon} size={text ? 14 : 15} />}
                {text}
              </button>
            </Cell>
          ))}
        </div>
      </Specimen>
      <Specimen
        title="Tool buttons"
        note="Icon buttons with a tooltip and a shortcut. Click the active one to toggle it."
        span="half"
      >
        <ToolButtons />
      </Specimen>
      <Specimen title="Tooltips" note="Hover or focus a button to open its tooltip." span="half">
        <div {...stylex.props(styles.row)}>
          <Cell label="Label">
            <ActionTooltip label="Show comments">
              <button
                type="button"
                aria-label="Show comments"
                {...stylex.props(ui.button, ui.iconButton, ui.pressable)}
              >
                <Icon name="note" size={15} />
              </button>
            </ActionTooltip>
          </Cell>
          <Cell label="Label and shortcut">
            <ActionTooltip label="Find in diffs" shortcut="Mod+F">
              <button type="button" {...stylex.props(ui.button, ui.pressable)}>
                <Icon name="search" size={14} />
                Find
              </button>
            </ActionTooltip>
          </Cell>
        </div>
      </Specimen>
      <Specimen title="Segmented control" note="The pill slides to the pressed option." span="half">
        <Segmented />
      </Specimen>
      <Specimen
        title="Choice select"
        note="Click to open. The check marks the current choice."
        span="half"
      >
        <Choices />
      </Specimen>
      <Specimen
        title="Text input"
        note="Hover for the strong edge. Focus for the accent ring. The input has no disabled style."
        span="half"
      >
        <div {...stylex.props(styles.fields)}>
          <Cell label="Empty" stretch>
            <input aria-label="Base revision" placeholder="main" {...stylex.props(ui.input)} />
          </Cell>
          <Cell label="Filled" stretch>
            <input aria-label="Head revision" defaultValue="ab41597" {...stylex.props(ui.input)} />
          </Cell>
          <Cell label="Disabled" stretch>
            <input
              aria-label="Destination branch"
              defaultValue="feature/elements"
              disabled
              {...stylex.props(ui.input)}
            />
          </Cell>
        </div>
      </Specimen>
      <Specimen
        title="Keyboard shortcuts"
        note="Top: keycaps in menus and tooltips. Bottom: sequences in the shortcut guide. Modifiers show for this platform. A dashed cap is a value to type."
        span="half"
      >
        <div {...stylex.props(styles.keys)}>
          {keyExamples.map(({ value, sequence }) => (
            <Cell key={`${value}${sequence}`} label={value}>
              {sequence ? <KeySequence value={value} /> : <ShortcutKeys value={value} />}
            </Cell>
          ))}
        </div>
      </Specimen>
      <Specimen
        title="Menus"
        note="Click to open. Toggles show a check. Refresh review is disabled."
        span="half"
      >
        <Menus />
      </Specimen>
      <Specimen
        title="Command palette"
        note="Modal. It opens over the page. Type to filter, Esc to close. One command is disabled."
        span="half"
      >
        <Palette />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  row: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 12 },
  cell: {
    display: "grid",
    gridTemplateRows: "minmax(28px, auto) auto",
    alignItems: "center",
    justifyItems: "start",
    gap: 6,
  },
  stretch: { justifyItems: "stretch" },
  label: { color: tokens.faint, fontSize: 11 },
  fields: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: 12,
  },
  keys: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, max-content))",
    columnGap: 24,
    rowGap: 12,
  },
});
