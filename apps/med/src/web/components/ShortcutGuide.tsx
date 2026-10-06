import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { focusPaletteInput } from "../data/palette-focus";
import { keyLabel, platform, shortcutSearchText } from "../data/keys";
import {
  guideContexts,
  type GuideContextId,
  type GuideEntry,
  type GuideGroup,
} from "../data/shortcut-guide";
import { tokens, ui } from "../theme.stylex";
import type { ReviewCommand } from "./Controls";
import { Icon } from "./Icon";
import { KeySequence, ShortcutKeys } from "./ShortcutKeys";

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
        <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop, ui.instant)} />
        <Dialog.Popup
          initialFocus={() => {
            commandManagesFocus.current = false;
            return focusPaletteInput(inputRef.current);
          }}
          finalFocus={() => !commandManagesFocus.current}
          {...stylex.props(ui.palette, styles.dialog, ui.instant)}
        >
          <Dialog.Title {...stylex.props(styles.hidden)}>Shortcuts & commands</Dialog.Title>
          <Dialog.Description {...stylex.props(styles.hidden)}>
            Keyboard shortcuts for review, files, the editor, and pickers. Type to search actions or
            keys; Enter runs a highlighted command.
          </Dialog.Description>
          <div {...stylex.props(ui.paletteInput)}>
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
              placeholder="Search actions or keys, such as “zz” or “close”"
              aria-label="Search shortcuts and commands"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={rows[selectedIndex]?.id}
              {...stylex.props(ui.paletteField)}
            />
            <ShortcutKeys value="Esc" />
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
            <Tabs.List aria-label="Shortcut contexts" {...stylex.props(styles.contexts)}>
              {guideContexts.map((guide) => (
                <Tabs.Tab
                  key={guide.id}
                  value={guide.id}
                  {...stylex.props(
                    styles.context,
                    !searching && guide.id === tab && styles.contextSelected,
                  )}
                >
                  {guide.label}
                  {guide.id === context && (
                    <span {...stylex.props(styles.here)} title="Your current context">
                      <span {...stylex.props(styles.hidden)}> (current)</span>
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
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label="Shortcuts"
            {...stylex.props(styles.body)}
          >
            <div {...stylex.props(styles.columns)}>
              {sections.map((section) => (
                <div
                  key={section.key}
                  role="group"
                  aria-labelledby={`${id}-${section.key}`}
                  {...stylex.props(styles.group)}
                >
                  <div id={`${id}-${section.key}`} {...stylex.props(styles.groupTitle)}>
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
                          styles.row,
                          runnable && styles.runnable,
                          index === selectedIndex && styles.rowActive,
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
                              <KeySequence key={value} value={value} />
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
              <div {...stylex.props(styles.empty)}>
                <p {...stylex.props(styles.emptyTitle)}>No shortcuts match “{query.trim()}”</p>
                <p {...stylex.props(styles.emptyHint)}>
                  Search command names in the command palette.
                </p>
              </div>
            )}
          </div>
          <div {...stylex.props(ui.paletteFooter)}>
            {platform === "mac" &&
              (["Mod", "Alt", "Ctrl", "Shift"] as const).map((key) => (
                <span key={key} {...stylex.props(styles.legend)}>
                  <kbd {...stylex.props(styles.legendKey)}>{keyLabel(key)}</kbd>
                  {{ Mod: "Command", Alt: "Option", Ctrl: "Control", Shift: "Shift" }[key]}
                </span>
              ))}
            <span {...stylex.props(styles.legend)}>
              <KeySequence value="g g" /> in sequence
            </span>
            <span {...stylex.props(ui.grow)} />
            <span {...stylex.props(styles.legend)}>
              <ShortcutKeys value="↵" /> Run
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  backdrop: { zIndex: 110 },
  dialog: {
    zIndex: 111,
    top: "9vh",
    width: "min(880px, calc(100vw - 32px))",
    height: "min(660px, 82vh)",
    display: "flex",
    flexDirection: "column",
  },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  contexts: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    minHeight: 40,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  context: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 450,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  contextSelected: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
  },
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
  body: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    paddingBlock: 14,
    paddingInline: 14,
    scrollbarWidth: "thin",
  },
  // Columns live in an unconstrained box; inside the fixed-height scroller
  // they would overflow sideways into hidden extra columns.
  columns: { columnCount: { default: 2, "@media (max-width: 760px)": 1 }, columnGap: 28 },
  group: { breakInside: "avoid", marginBottom: 18 },
  groupTitle: {
    paddingInline: 8,
    marginBottom: 4,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 500,
  },
  groupDescription: {
    marginBlock: 0,
    marginBottom: 6,
    paddingInline: 8,
    color: tokens.faint,
    fontSize: 11.5,
    lineHeight: 1.45,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minHeight: 30,
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: 6,
    cursor: "default",
  },
  runnable: { cursor: "pointer" },
  rowActive: { backgroundColor: tokens.fillStrong },
  text: { display: "flex", flexDirection: "column", gap: 1, flex: "1", minWidth: 0 },
  label: {
    color: tokens.text,
    fontSize: 12.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  unavailable: { color: tokens.muted },
  note: {
    color: tokens.faint,
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  keys: {
    display: "inline-flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    columnGap: 8,
    rowGap: 4,
    flexShrink: 0,
    maxWidth: "58%",
  },
  syntax: {
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11,
    lineHeight: "18px",
  },
  empty: { paddingBlock: 48, textAlign: "center" },
  emptyTitle: { margin: 0, color: tokens.text, fontSize: 13 },
  emptyHint: { marginBlock: 6, color: tokens.faint, fontSize: 12 },
  legend: { display: "inline-flex", alignItems: "center", gap: 5 },
  legendKey: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 10.5,
  },
});
