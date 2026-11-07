import * as stylex from "@stylexjs/stylex";
import { Popover } from "@base-ui/react/popover";
import { useEffect, useState, type ReactNode } from "react";
import { CODE_SIZES, type CodeSize } from "../data/view-settings";
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
 * The review's header: the session's toggle with its agent's mark, the
 * review's title with Med's mark, its branch, then Display and the page
 * switch. `trail` holds the controls that have no other place yet.
 */
export function ReviewHeader({
  session,
  title,
  reviewed,
  branch,
  lead,
  trail,
  display,
  pages,
  page,
  onPage,
  controls,
}: {
  session?: { agent: IconName; shown: boolean; toggle(): void };
  title: string;
  /** A saved review, which starts its title with Med's mark. */
  reviewed: boolean;
  branch?: string;
  lead?: ReactNode;
  trail?: ReactNode;
  display?: DisplayOptions;
  pages: readonly ReviewPage[];
  /** The page on screen; null while a file shows. */
  page: string | null;
  onPage(value: string): void;
  /** The pane's own controls, at the row's end. */
  controls?: ReactNode;
}) {
  return (
    <header aria-label="Review header" {...paneHandle} {...stylex.props(styles.bar)}>
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
      <h2 {...stylex.props(styles.title, reviewed && styles.marked)} title={title}>
        {reviewed && <MedMark />}
        <span data-truncates="" {...stylex.props(styles.name)}>
          {title}
        </span>
      </h2>
      {branch && <BranchLabel branch={branch} />}
      <span data-row-grow="" {...stylex.props(styles.grow)} />
      {trail}
      {display && <DisplayButton options={display} />}
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
    </header>
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

/** The Display button and its options. While it is open, S, W, and C flip
 * the layout, wrapping, and comments. */
function DisplayButton({ options }: { options: DisplayOptions }) {
  const [open, setOpen] = useState(false);
  const { layout, wrap, comments, size } = options;
  const at = CODE_SIZES.indexOf(size.value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Display"
        {...tooltip("Split, wrap, comments, and text size")}
        {...stylex.props(ui.button, ui.pressable, styles.display)}
      >
        <Icon name="selector" size={14} />
        <span {...stylex.props(styles.displayLabel)}>Display</span>
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
            <div {...stylex.props(styles.line)}>
              <div role="radiogroup" aria-label="Diff layout" {...stylex.props(styles.segment)}>
                {(["split", "unified"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={layout.mode === mode}
                    disabled={mode === "split" && !layout.canSplit}
                    title={
                      mode === "split" && !layout.canSplit ? "Split needs a wider pane" : undefined
                    }
                    onClick={() => layout.set(mode)}
                    {...stylex.props(ui.button, styles.half, layout.mode === mode && styles.pageOn)}
                  >
                    {mode === "split" ? "Split" : "Unified"}
                  </button>
                ))}
              </div>
              <kbd {...stylex.props(styles.key)}>S</kbd>
            </div>
            <span role="separator" {...stylex.props(styles.separator)} />
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
            {/* Settings › Code has these, plus theme, font, and the file view's. */}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                history.pushState(null, "", "/settings/code");
                window.dispatchEvent(new PopStateEvent("popstate"));
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
  bar: {
    display: "flex",
    alignItems: "center",
    flex: "none",
    gap: 2,
    height: 44,
    minWidth: 0,
    paddingInline: 8,
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
    color: tokens.text,
    // A narrow row keeps Display's icon and drops its word.
    containerType: "inline-size",
  },
  session: { color: tokens.muted },
  claude: { display: "flex", color: CLAUDE },
  // The trail's comparison moves into ⋯ first (see QuietChrome's rowRoom);
  // then the branch and the title shorten, so the row never overflows.
  title: {
    display: "flex",
    alignItems: "center",
    flexShrink: 1,
    gap: 7,
    minWidth: 0,
    maxWidth: "45%",
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
  display: { gap: 6, height: 28, marginInlineEnd: 6, paddingInline: 8, color: tokens.muted },
  displayLabel: { display: { default: "inline", "@container (max-width: 640px)": "none" } },
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
  toggle: { justifyContent: "flex-start", borderRadius: `calc(7px * ${tokens.round})` },
  segment: {
    flex: "1",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 2,
    marginBlock: 4,
    padding: 2,
    borderRadius: `calc(9px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    backgroundColor: tokens.canvas,
  },
  half: {
    justifyContent: "center",
    height: 24,
    borderRadius: `calc(7px * ${tokens.round})`,
    color: tokens.muted,
    fontSize: 12.5,
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
