import * as stylex from "@stylexjs/stylex";
import { Popover } from "@base-ui/react/popover";
import { useState, type ReactNode } from "react";
import { CODE_SIZES, type CodeSize } from "../data/view-settings";
import { themeController, useTheme, type ThemeMode } from "../themes";
import { openSettings } from "./settings/settings-commands";
import { tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { paneHandle } from "./PaneTree";
import { clippedTooltip, tooltip } from "./ToolButton";

/** A review's pages, which the header's switch and the keys 1–3 choose. */
export interface ReviewPage {
  value: string;
  label: string;
  /** The page's icon in the switch, which names it in a tooltip. */
  icon: IconName;
}

/** The diff's options where the reader reads them (the Display button). */
export interface DisplayOptions {
  layout: { mode: "split" | "unified"; canSplit: boolean; set(mode: "split" | "unified"): void };
  wrap: { on: boolean; toggle(): void };
  comments: { on: boolean; toggle(): void };
  size: { value: CodeSize; set(size: CodeSize): void };
}

/** The review's pages: the switch, the page on screen, and the choice. */
export interface ReviewPages {
  pages: readonly ReviewPage[];
  /** The page on screen; null while a file shows or the review hides. */
  page: string | null;
  onPage(value: string): void;
}

/**
 * The review pane's one row: its name, the page's own controls (such as the
 * line totals), ⋯ with what a narrow row folds away, and the pane's Expand
 * at its end. The pages and what acts on the whole review are at the title
 * band's end (ReviewTools); without the band, as in a test, `end` puts them
 * in this row.
 */
export function ReviewHeader({
  lead,
  name,
  tools,
  more,
  end,
  controls,
}: {
  /** The review's sidebar's toggle, while the sidebar hides. */
  lead?: ReactNode;
  name: ReactNode;
  /** The page's own controls, after the name. */
  tools?: ReactNode;
  /** ⋯, with what the row folds away when narrow. */
  more?: ReactNode;
  /** The pages and the review's actions, where the title band does not hold them. */
  end?: ReactNode;
  /** The pane's own control, Expand, at the row's end. */
  controls?: ReactNode;
}) {
  return (
    <header aria-label="Review header" {...paneHandle} {...stylex.props(styles.header)}>
      {lead}
      <span data-row-yields="" {...stylex.props(styles.nameBox)}>
        {name}
      </span>
      {tools}
      <span data-row-grow="" {...stylex.props(styles.grow)} />
      {more}
      {end}
      {controls}
    </header>
  );
}

/**
 * The workspace's pages, then what acts on the whole review (the pull
 * request's comments, Copy comments) and Display: at the title band's end,
 * whether or not the review shows. A page opens the review beside the
 * thread.
 */
export function ReviewTools({
  pages,
  actions,
  display,
}: {
  pages: ReviewPages;
  actions?: ReactNode;
  display?: DisplayOptions;
}) {
  return (
    <span role="group" aria-label="Review tools" {...stylex.props(styles.actions)}>
      <PageSwitch {...pages} />
      <ReviewActions actions={actions} display={display} />
    </span>
  );
}

/**
 * The pages as icons side by side, the one on screen filled: Review's
 * signpost (its Guide walks through the change), Changes' plus and minus,
 * and Commit's Git mark. A tooltip names each, with its number key.
 */
export function PageSwitch({ pages, page, onPage }: ReviewPages) {
  if (pages.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Page" {...stylex.props(styles.pages)}>
      {pages.map((entry, index) => (
        <button
          key={entry.value}
          type="button"
          role="radio"
          aria-checked={page === entry.value}
          aria-label={entry.label}
          {...tooltip(entry.label, String(index + 1))}
          onClick={() => onPage(entry.value)}
          {...stylex.props(ui.button, styles.page, page === entry.value && styles.pageOn)}
        >
          <Icon name={entry.icon} size={15} />
        </button>
      ))}
    </div>
  );
}

/**
 * The review's title, with Med's mark when it is a saved review. A title
 * that the row cuts fades out at its end, and a tooltip has all of it.
 */
export function ReviewTitle({ title, reviewed }: { title: string; reviewed: boolean }) {
  return (
    <h2 {...clippedTooltip(title)} {...stylex.props(styles.title, reviewed && styles.marked)}>
      {reviewed && <MedMark />}
      <FadingName text={title} />
    </h2>
  );
}

/**
 * A name on one line that fades out at its end while the line cuts it, its
 * ellipsis faint (TitleRow.css: a scroll timeline, so only a name that
 * overflows has the fade; without one, the ellipsis alone).
 */
export function FadingName({ text, style }: { text: string; style?: stylex.StyleXStyles }) {
  return (
    <span
      data-truncates=""
      data-clip=""
      className={`med-fading-name ${stylex.props(styles.name, style).className ?? ""}`}
    >
      {text}
    </span>
  );
}

/** What acts on the whole review, then Display: at the title row's end. */
export function ReviewActions({
  actions,
  display,
}: {
  actions?: ReactNode;
  display?: DisplayOptions;
}) {
  return (
    <span {...stylex.props(styles.actions)}>
      {actions}
      {display && <DisplayButton options={display} />}
    </span>
  );
}

/** Med's mark: two offset half-discs in the accent. */
export function MedMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="12 12 40 40"
      style={{ flex: "none" }}
    >
      <path d="M14 30A15 15 0 0 1 44 30Z" fill="var(--med-accent)" />
      <path d="M20 34A15 15 0 0 0 50 34Z" fill="var(--med-accent)" fillOpacity="0.5" />
    </svg>
  );
}

const MODES: { mode: ThemeMode; label: string; icon: IconName }[] = [
  { mode: "system", label: "Auto", icon: "theme" },
  { mode: "light", label: "Light", icon: "sun" },
  { mode: "dark", label: "Dark", icon: "moon" },
];

/** The Display button and its options, a name and its control on each row,
 * as Pierre lays its own out. While it is open, S, W, and C flip the
 * layout, wrapping, and comments. */
function DisplayButton({ options }: { options: DisplayOptions }) {
  const [open, setOpen] = useState(false);
  const { layout, wrap, comments, size } = options;
  const at = CODE_SIZES.indexOf(size.value);
  const theme = useTheme();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Display"
        {...tooltip("Display: layout, wrap, comments, text size, and theme")}
        {...stylex.props(ui.button, ui.pressable, styles.display)}
      >
        <Icon name="display" size={15} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={6} {...stylex.props(styles.positioner)}>
          <Popover.Popup
            aria-label="Display"
            onKeyDown={(event) => {
              if (event.metaKey || event.ctrlKey || event.altKey) return;
              const key = event.key.toLowerCase();
              if (key === "s" && (layout.canSplit || layout.mode === "split"))
                layout.set(layout.mode === "split" ? "unified" : "split");
              else if (key === "w") wrap.toggle();
              else if (key === "c") comments.toggle();
              else return;
              event.preventDefault();
            }}
            {...stylex.props(ui.popup, ui.pop, styles.popup)}
          >
            <div {...stylex.props(styles.line, styles.row)}>
              <span {...stylex.props(styles.grow)}>Layout</span>
              <div role="radiogroup" aria-label="Diff layout" {...stylex.props(styles.segment)}>
                {(["split", "unified"] as const).map((mode) => {
                  const name = mode === "split" ? "Split" : "Unified";
                  const blocked = mode === "split" && !layout.canSplit;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-label={name}
                      aria-checked={layout.mode === mode}
                      disabled={blocked}
                      {...tooltip(blocked ? "Split needs a wider pane" : name)}
                      onClick={() => layout.set(mode)}
                      {...stylex.props(
                        ui.button,
                        styles.half,
                        layout.mode === mode && styles.pageOn,
                      )}
                    >
                      <Icon name={mode} size={15} />
                    </button>
                  );
                })}
              </div>
              <kbd {...stylex.props(styles.key)}>S</kbd>
            </div>
            <Toggle label="Wrap long lines" letter="W" on={wrap.on} toggle={wrap.toggle} />
            <Toggle
              label="Comments in the diff"
              letter="C"
              on={comments.on}
              toggle={comments.toggle}
            />
            <div {...stylex.props(styles.line, styles.row)}>
              <span {...stylex.props(styles.grow)}>Text size</span>
              <button
                type="button"
                aria-label="Smaller text"
                disabled={at <= 0}
                onClick={() => size.set(CODE_SIZES[at - 1]!)}
                {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.step)}
              >
                −
              </button>
              <output aria-label="Text size" {...stylex.props(styles.size)}>
                {size.value}
              </output>
              <button
                type="button"
                aria-label="Larger text"
                disabled={at >= CODE_SIZES.length - 1}
                onClick={() => size.set(CODE_SIZES[at + 1]!)}
                {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.step)}
              >
                +
              </button>
              <kbd {...stylex.props(styles.key)} />
            </div>
            <span role="separator" {...stylex.props(styles.separator)} />
            <div {...stylex.props(styles.line, styles.row)}>
              <span {...stylex.props(styles.grow)}>Theme</span>
              <div role="radiogroup" aria-label="Theme" {...stylex.props(styles.segment)}>
                {MODES.map(({ mode, label, icon }) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-label={label}
                    aria-checked={theme.mode === mode}
                    {...tooltip(
                      mode === "system"
                        ? `Auto: ${theme.light.label} or ${theme.dark.label}, as the system is`
                        : mode === "light"
                          ? theme.light.label
                          : theme.dark.label,
                    )}
                    onClick={() => themeController.setMode(mode)}
                    {...stylex.props(ui.button, styles.half, theme.mode === mode && styles.pageOn)}
                  >
                    <Icon name={icon} size={15} />
                  </button>
                ))}
              </div>
              <kbd {...stylex.props(styles.key)} />
            </div>
            <span role="separator" {...stylex.props(styles.separator)} />
            {/* Settings › Code has these; Appearance has the themes. */}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openSettings("code");
              }}
              {...stylex.props(
                ui.button,
                ui.pressable,
                styles.line,
                styles.row,
                styles.toggle,
                styles.more,
              )}
            >
              <span {...stylex.props(styles.grow)}>All code settings</span>
              <Icon name="arrowLeft" size={12} style={{ transform: "rotate(180deg)" }} />
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Toggle({
  label,
  letter,
  on,
  toggle,
}: {
  label: string;
  letter: string;
  on: boolean;
  toggle(): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      {...stylex.props(ui.button, styles.line, styles.row, styles.toggle)}
    >
      <span {...stylex.props(styles.grow)}>{label}</span>
      <span aria-hidden="true" {...stylex.props(styles.track, on && styles.trackOn)}>
        <span {...stylex.props(styles.knob, on && styles.knobOn)} />
      </span>
      <kbd {...stylex.props(styles.key)}>{letter}</kbd>
    </button>
  );
}

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    flex: "none",
    gap: 2,
    height: tokens.bar,
    minWidth: 0,
    paddingInline: 8,
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
    color: tokens.text,
  },
  actions: { display: "flex", alignItems: "center", flexShrink: 0, gap: 2 },
  // The name gives way first, down to Med's mark: the row's optional
  // controls, such as what the diff compares, count it at this least width
  // (QuietChrome's rowRoom), and it takes the room they leave. It shrinks
  // far ahead of the comparison, which shrinks ahead of the rest.
  nameBox: { display: "flex", alignItems: "center", flexShrink: 100000, minWidth: 34 },
  // The branch hides first, then the title shortens, so the row never
  // overflows. No cap in percent: in the title band its box is its own size.
  title: {
    display: "flex",
    alignItems: "center",
    flexShrink: 1,
    gap: 7,
    minWidth: 0,
    margin: 0,
    paddingInline: 6,
    fontSize: 13.5,
    fontWeight: 550,
    letterSpacing: "-0.005em",
  },
  // The title keeps Med's mark.
  marked: { minWidth: 34 },
  name: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  grow: { flex: "1", minWidth: 0 },
  display: { width: 28, height: 28, marginInlineEnd: 6, color: tokens.muted },
  // Icons, so the pages keep their width; the title gives way first.
  pages: {
    display: "flex",
    flexShrink: 0,
    marginInline: 4,
    gap: 2,
    padding: 2,
    borderRadius: `calc(9px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    backgroundColor: tokens.canvas,
  },
  page: {
    justifyContent: "center",
    width: 30,
    minWidth: 30,
    height: 24,
    paddingInline: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    color: { default: tokens.muted, ":hover": tokens.text },
  },
  // The same weight on and off, so the pages keep their places.
  pageOn: { backgroundColor: tokens.fill, color: tokens.text },
  positioner: { zIndex: 100, outline: "none" },
  popup: { width: 280, paddingBlock: 6, paddingInline: 6 },
  line: { display: "flex", alignItems: "center", gap: 10, paddingInline: 8 },
  row: { width: "100%", height: 34, fontSize: 13, color: tokens.text },
  // A button centres its text; a row's name starts at its left, as in Pierre's.
  toggle: {
    justifyContent: "flex-start",
    textAlign: "start",
    borderRadius: `calc(7px * ${tokens.round})`,
  },
  // Icons side by side; the chosen one is filled.
  segment: {
    display: "flex",
    gap: 2,
    padding: 2,
    borderRadius: `calc(9px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    backgroundColor: tokens.canvas,
  },
  half: {
    justifyContent: "center",
    width: 30,
    minWidth: 30,
    height: 24,
    paddingInline: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    color: tokens.muted,
  },
  separator: { display: "block", height: 1, marginBlock: 4, backgroundColor: tokens.line },
  more: { color: { default: tokens.muted, ":hover": tokens.text } },
  key: {
    width: 12,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11.5,
    textAlign: "end",
  },
  track: {
    position: "relative",
    flex: "none",
    width: 28,
    height: 16,
    borderRadius: 999,
    backgroundColor: tokens.lineStrong,
  },
  trackOn: { backgroundColor: tokens.accent },
  knob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 12,
    height: 12,
    borderRadius: "50%",
    backgroundColor: tokens.muted,
    transitionProperty: "left",
    transitionDuration: "120ms",
  },
  knobOn: { left: 14, backgroundColor: tokens.canvas },
  step: { width: 24, minWidth: 24, height: 24, color: tokens.muted },
  size: {
    width: 34,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 12,
    textAlign: "center",
  },
});
