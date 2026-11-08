import * as stylex from "@stylexjs/stylex";
import { Popover } from "@base-ui/react/popover";
import { useEffect, useState, type ReactNode } from "react";
import { CODE_SIZES, type CodeSize } from "../data/view-settings";
import { themeController, useTheme, type ThemeMode } from "../themes";
import { openSettings } from "./settings/settings-commands";
import { tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { paneHandle } from "./PaneTree";
import { tooltip } from "./ToolButton";

/** A review's pages, which the header's switch and the keys 1–3 choose. */
export interface ReviewPage {
  value: string;
  label: string;
}

/** The diff's options where the reader reads them (the Display button). */
export interface DisplayOptions {
  layout: { mode: "split" | "unified"; canSplit: boolean; set(mode: "split" | "unified"): void };
  wrap: { on: boolean; toggle(): void };
  comments: { on: boolean; toggle(): void };
  size: { value: CodeSize; set(size: CodeSize): void };
}

/** Claude's orange, as on New thread; other agents keep the text's colour. */
const CLAUDE = "#d97757";

/**
 * The review's header, in two rows. The title row names the review and holds
 * what acts on all of it: Copy comments, ⋯, and Display (ReviewTitleRow).
 * Where the review reaches the window's top right, that row is in the title
 * band above it, and this header is the second row only: the toggles of the
 * session and the review's sidebar and the page's own controls, then the
 * pages and the pane's controls at its end, where they keep their places.
 */
export function ReviewHeader({
  session,
  identity,
  lead,
  pages,
  page,
  onPage,
  tools,
  more,
  controls,
}: {
  session?: { agent: IconName; shown: boolean; toggle(): void };
  /** The title row, when the title band does not hold it. */
  identity?: ReactNode;
  /** The review's sidebar's toggle, while the sidebar hides. */
  lead?: ReactNode;
  pages: readonly ReviewPage[];
  /** The page on screen; null while a file shows. */
  page: string | null;
  onPage(value: string): void;
  /** The page's own controls, after the toggles. */
  tools?: ReactNode;
  /** ⋯, with what the row folds away when narrow, before the pages. */
  more?: ReactNode;
  /** The pane's own controls, at the row's end. */
  controls?: ReactNode;
}) {
  return (
    <header aria-label="Review header" {...paneHandle} {...stylex.props(styles.header)}>
      {identity}
      <div {...stylex.props(styles.bar)}>
        {session && (
          <button
            type="button"
            aria-label={session.shown ? "Hide agent session" : "Show agent session"}
            aria-pressed={session.shown}
            data-pane-show="session"
            {...tooltip(session.shown ? "Hide agent session" : "Show agent session", "Mod+Shift+B")}
            onClick={session.toggle}
            {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.session)}
          >
            <span {...stylex.props(session.agent === "claude" && styles.claude)}>
              <Icon name={session.agent} size={15} />
            </span>
          </button>
        )}
        {lead}
        {tools}
        <span data-row-grow="" {...stylex.props(styles.grow)} />
        {more}
        {pages.length > 1 && (
          <div role="radiogroup" aria-label="Page" {...stylex.props(styles.pages)}>
            {pages.map((entry, index) => (
              <button
                key={entry.value}
                type="button"
                role="radio"
                aria-checked={page === entry.value}
                {...tooltip(entry.label, String(index + 1))}
                onClick={() => onPage(entry.value)}
                {...stylex.props(ui.button, styles.page, page === entry.value && styles.pageOn)}
              >
                <span data-truncates="" {...stylex.props(styles.name)}>
                  {entry.label}
                </span>
              </button>
            ))}
          </div>
        )}
        {controls}
      </div>
    </header>
  );
}

/** The review's title, with Med's mark when it is a saved review. */
export function ReviewTitle({ title, reviewed }: { title: string; reviewed: boolean }) {
  return (
    <h2 {...stylex.props(styles.title, reviewed && styles.marked)} title={title}>
      {reviewed && <MedMark />}
      <span data-truncates="" {...stylex.props(styles.name)}>
        {title}
      </span>
    </h2>
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

/**
 * The review's title row: its title, its branch, then ReviewActions. In the
 * title band it covers the band above the review, `width` wide, with the
 * line between the panes running up its start; in the pane it is the
 * header's first row.
 */
export function ReviewTitleRow({
  name,
  branch,
  actions,
  display,
  width,
}: {
  name: ReactNode;
  branch?: string;
  actions?: ReactNode;
  display?: DisplayOptions;
  /** In the title band: the width it covers, from the line between the panes. */
  width?: number;
}) {
  return (
    <div
      {...stylex.props(
        styles.titleRow,
        width === undefined ? styles.inPane : [styles.inBand, styles.width(width)],
      )}
    >
      {name}
      {branch && <BranchLabel branch={branch} />}
      <span {...stylex.props(styles.grow)} />
      <ReviewActions actions={actions} display={display} />
    </div>
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

/** The branch in a quiet mono label; a click copies its name. */
function BranchLabel({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`Branch ${branch}. Copy its name`}
      {...tooltip(copied ? "Copied" : "Copy the branch name")}
      onClick={() =>
        void navigator.clipboard.writeText(branch).then(
          () => setCopied(true),
          () => {},
        )
      }
      {...stylex.props(ui.button, styles.branch)}
    >
      <Icon name="branch" size={12} />
      <span {...stylex.props(styles.name)}>{branch}</span>
    </button>
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
  header: { display: "flex", flexDirection: "column", flex: "none", minWidth: 0 },
  bar: {
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
  // A narrow row hides the branch (styles.branch).
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    minWidth: 0,
    color: tokens.text,
    containerType: "inline-size",
  },
  // As tall as the title band, so the rows line up across the panes.
  inPane: {
    flex: "none",
    height: "var(--med-top-row)",
    paddingInline: 8,
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
  },
  // It ends where window controls at the band's end start, as on Windows and
  // Linux (the band keeps their room); the line between the panes runs up
  // its start.
  inBand: {
    flexShrink: 0,
    boxSizing: "border-box",
    height: "100%",
    paddingInlineStart: 8,
    paddingInlineEnd: "max(calc(8px - var(--med-titlebar-right)), 4px)",
    boxShadow: `inset 1px 0 0 ${tokens.line}`,
  },
  width: (width: number) => ({ width: `calc(${width}px - var(--med-titlebar-right))` }),
  actions: { display: "flex", alignItems: "center", flexShrink: 0, gap: 2 },
  session: { color: tokens.muted },
  claude: { display: "flex", color: CLAUDE },
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
  branch: {
    display: { default: "inline-flex", "@container (max-width: 440px)": "none" },
    gap: 5,
    minWidth: 0,
    maxWidth: 260,
    height: 24,
    paddingInline: 6,
    color: { default: tokens.faint, ":hover": tokens.muted },
    fontFamily: tokens.code,
    fontSize: 12,
  },
  grow: { flex: "1", minWidth: 0 },
  display: { width: 28, height: 28, marginInlineEnd: 6, color: tokens.muted },
  // The pages' names shorten last, once the title is down to its mark.
  pages: {
    display: "flex",
    flexShrink: 0.001,
    minWidth: 0,
    gap: 2,
    padding: 2,
    borderRadius: `calc(9px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    backgroundColor: tokens.canvas,
  },
  page: {
    minWidth: 0,
    height: 24,
    paddingInline: 10,
    borderRadius: `calc(7px * ${tokens.round})`,
    color: { default: tokens.muted, ":hover": tokens.text },
    fontSize: 12.5,
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
