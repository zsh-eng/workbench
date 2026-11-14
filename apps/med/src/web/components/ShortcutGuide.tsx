import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { focusPaletteInput } from "../data/palette-focus";
import {
  describeShortcut,
  isPlaceholder,
  keyLabel,
  parseShortcut,
  platform,
  shortcutSearchText,
} from "../data/keys";
import {
  guideContexts,
  type GuideContextId,
  type GuideEntry,
  type GuideGroup,
} from "../data/shortcut-guide";
import { picked, tokens, ui } from "../theme.stylex";
import type { ReviewCommand } from "./Controls";
import { Icon } from "./Icon";
import { PaletteTitle, usePaletteFade } from "./Palette";

type Section = { key: string; title: string; description?: string; entries: GuideEntry[] };

function searchText(entry: GuideEntry, group: GuideGroup, context: string) {
  return [
    entry.label,
    entry.note ?? "",
    group.title,
    context,
    ...entry.keys.map((value) => (entry.syntax ? value : shortcutSearchText(value))),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * A searchable keyboard reference. It opens on the context the person is in;
 * typing searches actions and keys in every context. Rows backed by a command
 * run with Enter or a click.
 */
export function ShortcutGuide({
  open,
  onOpenChange,
  context,
  commands,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  context: GuideContextId;
  commands: ReviewCommand[];
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fade = usePaletteFade<HTMLDivElement>();
  const bodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      return fade(node);
    },
    [fade],
  );
  const commandManagesFocus = useRef(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<GuideContextId>(context);
  const [active, setActive] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setTab(context);
      setQuery("");
      setActive(0);
    }
  }
  const searching = query.trim().length > 0;
  const sections = useMemo<Section[]>(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      const selected = guideContexts.find((entry) => entry.id === tab) ?? guideContexts[0]!;
      return selected.groups.map((group) => ({
        key: `${selected.id}:${group.title}`,
        title: group.title,
        description: group.description,
        entries: group.entries,
      }));
    }
    return guideContexts.flatMap((guide) =>
      guide.groups.flatMap((group) => {
        const entries = group.entries.filter((entry) => {
          const text = searchText(entry, group, guide.label);
          return words.every((word) => text.includes(word));
        });
        return entries.length
          ? [
              {
                key: `${guide.id}:${group.title}`,
                title: `${guide.label} · ${group.title}`,
                entries,
              },
            ]
          : [];
      }),
    );
  }, [query, tab]);
  const rows = sections.flatMap((section) =>
    section.entries.map((entry, index) => ({
      section,
      entry,
      id: `${id}-${section.key}-${index}`,
    })),
  );
  const commandFor = (entry: GuideEntry) =>
    entry.command ? commands.find((command) => command.id === entry.command) : undefined;
  const selectedIndex = Math.min(active, Math.max(0, rows.length - 1));
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, query, tab]);
  const run = (entry: GuideEntry) => {
    const command = commandFor(entry);
    if (!command || command.disabled) return;
    commandManagesFocus.current = !!command.managesFocus;
    onOpenChange(false);
    command.run();
  };
  const current = guideContexts.find((entry) => entry.id === tab) ?? guideContexts[0]!;
  let rowIndex = 0;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(ui.scrim, ui.paletteScrim, ui.instant)} />
        <Dialog.Popup
          initialFocus={() => {
            commandManagesFocus.current = false;
            return focusPaletteInput(inputRef.current);
          }}
          finalFocus={() => !commandManagesFocus.current}
          {...stylex.props(ui.palette, ui.paletteGuide, ui.instant)}
        >
          <PaletteTitle>Keyboard shortcuts</PaletteTitle>
          <Dialog.Description {...stylex.props(ui.srOnly)}>
            Keyboard shortcuts for review, commits, files, the editor, and pickers. Type to search
            actions or keys; Enter runs a highlighted command.
          </Dialog.Description>
          <div {...stylex.props(ui.paletteInput, ui.paletteInputOpen)}>
            <Icon name="search" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  setActive(Math.max(0, Math.min(rows.length - 1, selectedIndex + delta)));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const row = rows[selectedIndex];
                  if (row) run(row.entry);
                }
              }}
              placeholder="Search shortcuts, such as “zz” or “close”…"
              aria-label="Search shortcuts and commands"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={rows[selectedIndex]?.id}
              {...stylex.props(ui.paletteField)}
            />
          </div>
          <Tabs.Root
            value={searching ? null : tab}
            onValueChange={(value) => {
              setTab(value as GuideContextId);
              setQuery("");
              setActive(0);
              inputRef.current?.focus();
            }}
          >
            <Tabs.List aria-label="Shortcut contexts" {...stylex.props(ui.paletteChips)}>
              {guideContexts.map((guide) => (
                <Tabs.Tab
                  key={guide.id}
                  value={guide.id}
                  {...stylex.props(
                    ui.button,
                    ui.paletteChip,
                    styles.context,
                    !searching && guide.id === tab && ui.paletteChipOn,
                  )}
                >
                  {guide.label}
                  {guide.id === context && (
                    <span {...stylex.props(styles.here)} title="Your current context">
                      <span {...stylex.props(ui.srOnly)}> (current)</span>
                    </span>
                  )}
                </Tabs.Tab>
              ))}
              <span {...stylex.props(styles.contextHint)}>
                {searching
                  ? `${rows.length} ${rows.length === 1 ? "match" : "matches"} in every context`
                  : current.description}
              </span>
            </Tabs.List>
          </Tabs.Root>
          <div
            ref={bodyRef}
            id={`${id}-list`}
            role="listbox"
            aria-label="Shortcuts"
            {...stylex.props(ui.paletteList, ui.paletteListFill, styles.body)}
          >
            <div {...stylex.props(styles.columns)}>
              {sections.map((section) => (
                <div
                  key={section.key}
                  role="group"
                  aria-labelledby={`${id}-${section.key}`}
                  {...stylex.props(styles.group)}
                >
                  <div id={`${id}-${section.key}`} {...stylex.props(ui.label, ui.paletteSection)}>
                    {section.title}
                  </div>
                  {section.description && (
                    <p {...stylex.props(styles.groupDescription)}>{section.description}</p>
                  )}
                  {section.entries.map((entry) => {
                    const index = rowIndex++;
                    const command = commandFor(entry);
                    const runnable = !!command && !command.disabled;
                    return (
                      <div
                        key={rows[index]!.id}
                        id={rows[index]!.id}
                        role="option"
                        aria-selected={index === selectedIndex}
                        aria-disabled={command?.disabled || undefined}
                        tabIndex={-1}
                        onMouseMove={() => setActive(index)}
                        onClick={() => run(entry)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") run(entry);
                        }}
                        {...stylex.props(
                          ui.paletteRow,
                          styles.row,
                          runnable && styles.runnable,
                          index === selectedIndex && [ui.paletteRowOn, picked],
                        )}
                      >
                        <span {...stylex.props(styles.text)}>
                          <span
                            {...stylex.props(styles.label, command?.disabled && styles.unavailable)}
                          >
                            {entry.label}
                          </span>
                          {entry.note && <span {...stylex.props(styles.note)}>{entry.note}</span>}
                        </span>
                        <span {...stylex.props(styles.keys)}>
                          {entry.keys.map((value) =>
                            entry.syntax ? (
                              <code key={value} {...stylex.props(styles.syntax)}>
                                {value}
                              </code>
                            ) : (
                              <GuideKeys key={value} value={value} />
                            ),
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {!rows.length && (
              <div {...stylex.props(ui.paletteEmpty)}>
                <p {...stylex.props(styles.emptyTitle)}>No shortcuts match “{query.trim()}”</p>
                <p {...stylex.props(styles.emptyHint)}>
                  Search command names in the command palette.
                </p>
              </div>
            )}
          </div>
          {/* The one footer: what each glyph means. */}
          <div {...stylex.props(styles.footer)}>
            {platform === "mac" &&
              (["Mod", "Alt", "Ctrl", "Shift"] as const).map((key) => (
                <span key={key} {...stylex.props(styles.legend)}>
                  <kbd {...stylex.props(styles.legendKey)}>{keyLabel(key)}</kbd>
                  {{ Mod: "Command", Alt: "Option", Ctrl: "Control", Shift: "Shift" }[key]}
                </span>
              ))}
            <span {...stylex.props(styles.legend)}>
              <kbd {...stylex.props(styles.legendKey)}>{"g\u2009g"}</kbd> in sequence
            </span>
            <span {...stylex.props(ui.grow)} />
            <span {...stylex.props(styles.legend)}>
              <kbd {...stylex.props(styles.legendKey)}>↵</kbd> Run
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * A shortcut as one quiet run of glyphs: a chord's keys together, a
 * sequence's steps apart, and a placeholder such as {char} in italics.
 */
function GuideKeys({ value }: { value: string }) {
  const steps = parseShortcut(value);
  return (
    <kbd title={describeShortcut(value)} {...stylex.props(ui.paletteKeys, styles.glyphs)}>
      {steps.map((chord, step) => (
        <Fragment key={step}>
          {/* A thin space between a sequence's steps; a chord's keys touch. */}
          {step > 0 && "\u2009"}
          {chord.map((key, index) => (
            <Fragment key={index}>
              {index > 0 && platform !== "mac" && "+"}
              {isPlaceholder(key) ? (
                <i {...stylex.props(styles.placeholder)}>{keyLabel(key)}</i>
              ) : (
                keyLabel(key)
              )}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </kbd>
  );
}

const styles = stylex.create({
  context: { position: "relative" },
  // The context the guide opened on: a small accent dot.
  here: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
  },
  contextHint: {
    flex: "1",
    minWidth: 0,
    marginInlineStart: 10,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 12,
    textAlign: "end",
  },
  body: { scrollbarWidth: "thin" },
  // Columns live in an unconstrained box; inside the fixed-height scroller
  // they would overflow sideways into hidden extra columns.
  columns: { columnCount: { default: 2, "@media (max-width: 760px)": 1 }, columnGap: 12 },
  group: { breakInside: "avoid", paddingBottom: 10 },
  groupDescription: {
    marginBlock: 0,
    paddingBottom: 6,
    paddingInline: 12,
    color: tokens.faint,
    fontSize: 12,
    lineHeight: 1.45,
  },
  // A row may hold a note under its name.
  row: { gap: 16, paddingBlock: 6 },
  runnable: { cursor: "pointer" },
  text: { display: "flex", flexDirection: "column", gap: 1, flex: "1", minWidth: 0 },
  label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  unavailable: { color: tokens.muted },
  note: {
    color: tokens.faint,
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  keys: {
    display: "inline-flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    columnGap: 12,
    rowGap: 2,
    flexShrink: 0,
    maxWidth: "50%",
  },
  glyphs: { whiteSpace: "pre" },
  placeholder: { fontStyle: "italic", letterSpacing: "normal" },
  syntax: { color: "var(--palette-keys)", fontFamily: tokens.code, fontSize: 11.5 },
  emptyTitle: { margin: 0 },
  emptyHint: { marginBlock: 6, fontSize: 12 },
  // The legend of the glyphs, the guide's own footer.
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    flexShrink: 0,
    boxSizing: "border-box",
    height: 38,
    paddingInline: 18,
    color: tokens.faint,
    fontSize: 12,
    whiteSpace: "nowrap",
    overflow: "hidden",
  },
  legend: { display: "inline-flex", alignItems: "center", gap: 6 },
  legendKey: {
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    letterSpacing: "0.12em",
  },
});
