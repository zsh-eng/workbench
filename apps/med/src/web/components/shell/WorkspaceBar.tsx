import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, type Ref } from "react";
import type { Thread } from "../../../shared/threads";
import { basename, type BarContext } from "../../data/bar-context";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { ToolButton } from "../ToolButton";
import { HistoryArrows } from "./HistoryArrows";
import { RenameField } from "./RenameField";

export { barContext, type BarContext } from "../../data/bar-context";

/**
 * The workspace's title band, above its panes: what the workspace has checked
 * out, and Show sidebar while the sidebar is hidden. With the installed app's
 * title bar hidden, the band is the title bar beside the window controls; it
 * moves the window, and its controls take clicks.
 *
 * The band is the one place for the thread's branch. While
 * the sidebar, which lists the thread, is hidden, the band names the thread
 * too, and a dot on Show sidebar tells that a tab needs the reader. A
 * thread's pull request is its title here (InTitleBand): the checkout follows
 * it, quieter.
 */
export function WorkspaceBar({
  context,
  showSidebar,
  needs = 0,
  rename,
  slots,
  titled = false,
  covered = false,
}: {
  context?: BarContext;
  /** The sidebar is hidden or covers the workspace: the band starts with its toggle. */
  showSidebar?: () => void;
  /** The tabs that need the reader, while the sidebar that counts them is hidden. */
  needs?: number;
  /** The thread on screen: a double-click on its name, or ⌘K, names it here
   * while the sidebar hides. */
  rename?: { thread: Thread; editing: boolean; start(): void; done(name: string | null): void };
  /** Where the workspace on screen puts its own title (InTitleBand): `lead`
   * before the checkout, `trail` at the band's end, and `cover`, a pane's own
   * row over the band's end, above the pane. */
  slots?: {
    lead: Ref<HTMLSpanElement>;
    trail: Ref<HTMLSpanElement>;
    cover: Ref<HTMLSpanElement>;
    /** The session's controls, then the workspace's pages and tools, at the
     * band's end, in every workspace's band the same place. */
    session?: Ref<HTMLSpanElement>;
    tools?: Ref<HTMLSpanElement>;
  };
  /** The workspace's own title leads the band, such as a thread's pull
   * request: the checkout follows it, quieter, and goes in a narrow band. */
  titled?: boolean;
  /** A pane's row covers the band's end, such as the review's title beside
   * the session: it names the thread, so the band does not. */
  covered?: boolean;
}) {
  const title =
    showSidebar && !titled && !covered && context?.kind === "checkout" ? context.title : undefined;
  return (
    <header
      aria-label="Workspace"
      className={`med-title-row ${stylex.props(styles.bar, showSidebar && styles.afterControls, covered && styles.covered).className ?? ""}`}
    >
      {/* Back and Forward follow the toggle: in the sidebar's top row while it
          shows, here while it hides, at the same place. */}
      {showSidebar && (
        <>
          <ToolButton
            label={needs > 0 ? `Show sidebar · ${needs} needs you` : "Show sidebar"}
            shortcut="Mod+B"
            icon="panelLeft"
            dot={needs > 0}
            onClick={showSidebar}
          />
          <HistoryArrows narrow="hide" />
        </>
      )}
      {rename?.editing ? (
        <span {...stylex.props(styles.title, styles.naming)}>
          <RenameField thread={rename.thread} onDone={rename.done} />
        </span>
      ) : (
        title && (
          <span
            data-thread-title=""
            title="Double-click to rename"
            onDoubleClick={rename?.start}
            {...stylex.props(styles.title)}
          >
            {title}
          </span>
        )
      )}
      <span ref={slots?.lead} {...stylex.props(styles.lead, !titled && styles.empty)} />
      {context?.kind === "checkout" && (
        <Checkout {...context} after={!!title || !!rename?.editing || titled} secondary={titled} />
      )}
      {context?.kind === "label" && (
        <span {...stylex.props(styles.checkout)}>
          <Icon name={context.icon} size={14} />
          <span {...stylex.props(styles.name, styles.ellipsis)}>{context.text}</span>
        </span>
      )}
      <span ref={slots?.trail} {...stylex.props(styles.trail, !titled && styles.empty)} />
      <span ref={slots?.cover} {...stylex.props(styles.cover, !covered && styles.empty)} />
      <span {...stylex.props(styles.ends)}>
        <span ref={slots?.session} {...stylex.props(styles.endSlot)} />
        <span ref={slots?.tools} {...stylex.props(styles.endSlot)} />
      </span>
    </header>
  );
}

/** Which part of the checkout a click copied, for a moment. */
type Copied = "repository" | "branch" | "folder";

/**
 * The repository and the branch; a linked worktree on a detached HEAD, which
 * has no branch to go by, shows its folder. The branch copies its name; the
 * repository's name, and the folder, copy the checkout's path. The part that copied turns to the accent, its icon a check, for a
 * moment. No tooltip: each part says what it is.
 */
function Checkout({
  repository,
  branch,
  path,
  linked,
  after,
  secondary,
}: Extract<BarContext, { kind: "checkout" }> & {
  after: boolean;
  secondary: boolean;
}) {
  const [copied, setCopied] = useState<Copied | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (part: Copied, text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => setCopied(part),
      () => {},
    );
  const part = (which: Copied) =>
    stylex.props(ui.button, ui.pressable, styles.part, copied === which && styles.copied);
  const folder = basename(path);
  return (
    <span {...stylex.props(styles.checkout, secondary && styles.secondary)}>
      <button
        type="button"
        aria-label={`${repository}. Copy the path`}
        onClick={() => copy("repository", path)}
        {...part("repository")}
      >
        <span
          {...stylex.props(
            styles.name,
            after && styles.nameAfter,
            copied === "repository" && styles.copied,
          )}
        >
          {repository}
        </span>
      </button>
      <button
        type="button"
        aria-label={`${branch ?? "Detached HEAD"}. Copy the branch name`}
        disabled={!branch}
        onClick={() => branch && copy("branch", branch)}
        {...part("branch")}
      >
        <Icon name={copied === "branch" ? "check" : "branch"} size={13} />
        <span {...stylex.props(styles.ellipsis)}>{branch ?? "Detached HEAD"}</span>
      </button>
      {/* The branch names a worktree. Only one without a branch goes by its folder. */}
      {linked && !branch && (
        <button
          type="button"
          aria-label={`${folder}. Copy the path`}
          onClick={() => copy("folder", path)}
          {...stylex.props(
            ui.button,
            ui.pressable,
            styles.part,
            styles.worktree,
            copied === "folder" && styles.copied,
          )}
        >
          <Icon name={copied === "folder" ? "check" : "folder"} size={13} />
          <span {...stylex.props(styles.ellipsis)}>{folder}</span>
        </button>
      )}
      <span role="status" {...stylex.props(styles.announce)}>
        {copied === "branch" ? "Copied the branch name" : copied ? "Copied the path" : ""}
      </span>
    </span>
  );
}

const styles = stylex.create({
  // Level with the sidebar's own top row, so both read as one band; a line
  // at its foot, where the panes start.
  bar: {
    display: "flex",
    alignItems: "center",
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
    gap: 4,
    flexShrink: 0,
    minWidth: 0,
    height: "var(--med-top-row)",
    // The checkout's name starts close to the band's start (12 pixels in).
    paddingInlineStart: 6,
    // Clear of the window controls at the right, as on Windows and Linux.
    paddingInlineEnd: "max(calc(var(--med-titlebar-right) + 4px), 8px)",
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    // A title in the band gives way to the band's width (InTitleBand).
    containerType: "inline-size",
  },
  afterControls: { paddingInlineStart: "max(calc(var(--med-titlebar-left) + 4px), 8px)" },
  // The covering row reaches the band's end, or the window controls there.
  covered: { paddingInlineEnd: "var(--med-titlebar-right)" },
  // A pane's row over the band's end (InTitleBand's cover): it sets its own
  // width, the pane's, and the band's start gives way.
  cover: {
    display: "flex",
    flexShrink: 0,
    alignSelf: "stretch",
    marginInlineStart: "auto",
  },
  checkout: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    minWidth: 0,
    whiteSpace: "nowrap",
  },
  // After a workspace's own title, the checkout keeps its width up to a
  // limit, and goes where the band is narrow.
  secondary: {
    display: { default: "inline-flex", "@container (max-width: 720px)": "none" },
    flexShrink: 0,
    maxWidth: "36cqi",
    overflow: "hidden",
  },
  // The workspace's own title (InTitleBand): it gives way first, cut at its end.
  lead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
    paddingInlineStart: 8,
  },
  // At the band's end; a row that ends the band (the review's, alone) fills
  // the rest of it, and the title gives way before it does.
  trail: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexGrow: 1,
    flexShrink: 0.001,
    minWidth: 0,
    marginInlineStart: "auto",
  },
  empty: { display: "none" },
  // The band's end: the session's controls, then the pages and tools.
  ends: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    marginInlineStart: "auto",
    paddingInlineStart: 8,
  },
  endSlot: { display: { default: "flex", ":empty": "none" }, alignItems: "center", gap: 6 },
  name: { color: tokens.text, fontWeight: 500 },
  // After the thread's title, the repository is secondary.
  nameAfter: { color: tokens.muted },
  // The thread's name field: room for a name, in the title's place.
  naming: { display: "flex", flexShrink: 0, width: "min(320px, 40vw)", overflow: "visible" },
  // The thread's name, as its sidebar row has it, while the sidebar is hidden.
  title: {
    flexShrink: 1,
    minWidth: 0,
    margin: 0,
    paddingInline: 8,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    fontWeight: 500,
  },
  // Each part copies on its own, so each has its own hover.
  part: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
    height: 26,
    paddingInline: 6,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": tokens.fill },
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    cursor: "default",
  },
  worktree: { color: tokens.faint },
  copied: { color: tokens.accent },
  // Read out once, by a screen reader; nothing to see.
  announce: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  ellipsis: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
});
