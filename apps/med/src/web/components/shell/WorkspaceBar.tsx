import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { Thread, ThreadList } from "../../../shared/threads";
import type { Workspace } from "../../data/workspaces";
import { useQuietChrome } from "../../data/chrome";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { ToolButton, tooltip } from "../ToolButton";
import { RenameField } from "./RenameField";

const basename = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) ?? path;

/** What the band names: a checkout, or a vault or pull request by its title. A
 * thread's checkout also carries the thread's title. */
export type BarContext =
  | {
      kind: "checkout";
      repository: string;
      branch?: string;
      path: string;
      linked: boolean;
      title?: string;
    }
  | { kind: "label"; icon: IconName; text: string };

/** A thread names the checkout it works in; a repository workspace, the one
 * it reports once it loads. A worktree goes by its repository's name. */
export function barContext(workspace: Workspace | undefined, list: ThreadList | null) {
  if (!workspace) return undefined;
  if (workspace.kind === "vault")
    return { kind: "label", icon: "vault", text: workspace.title ?? "Vault" } as const;
  if (workspace.kind === "review") {
    const thread = list?.threads.find((entry) => entry.id === workspace.reviewId);
    if (!thread?.checkout) return undefined;
    return {
      kind: "checkout",
      repository: thread.repository?.name ?? basename(thread.checkout),
      branch: thread.branch,
      path: thread.checkout,
      linked: !!thread.linked,
      title: thread.title,
    } as const;
  }
  if (workspace.kind === "pull")
    return { kind: "label", icon: "pullRequest", text: workspace.title ?? "Pull request" } as const;
  if (!workspace.path) return undefined;
  return {
    kind: "checkout",
    repository:
      list?.repositories.find((entry) => entry.id === workspace.repositoryId)?.name ??
      workspace.repository ??
      basename(workspace.path),
    branch: workspace.branch,
    path: workspace.path,
    linked: !!workspace.worktree,
    // A session that Med found is a thread, and its workspace has its title.
    title: workspace.found ? workspace.title : undefined,
  } as const;
}

/**
 * The workspace's title band, above its panes: what the workspace has checked
 * out, and Show sidebar while the sidebar is hidden. With the installed app's
 * title bar hidden, the band is the title bar beside the window controls; it
 * moves the window, and its controls take clicks.
 *
 * With quiet chrome, the band is the one place for the thread's branch. While
 * the sidebar, which lists the thread, is hidden, the band names the thread
 * too, and a dot on Show sidebar tells that a tab needs the reader.
 */
export function WorkspaceBar({
  context,
  showSidebar,
  needs = 0,
  rename,
}: {
  context?: BarContext;
  /** The sidebar is hidden or covers the workspace: the band starts with its toggle. */
  showSidebar?: () => void;
  /** The tabs that need the reader, while the sidebar that counts them is hidden. */
  needs?: number;
  /** The thread on screen: a double-click on its name, or ⌘K, names it here
   * while the sidebar hides. */
  rename?: { thread: Thread; editing: boolean; start(): void; done(name: string | null): void };
}) {
  const quiet = useQuietChrome();
  const title = quiet && showSidebar && context?.kind === "checkout" ? context.title : undefined;
  return (
    <header
      aria-label="Workspace"
      className={`med-title-row ${stylex.props(styles.bar, showSidebar && styles.afterControls).className ?? ""}`}
    >
      {showSidebar && (
        <ToolButton
          label={needs > 0 ? `Show sidebar · ${needs} needs you` : "Show sidebar"}
          shortcut="Mod+B"
          icon="panelLeft"
          dot={needs > 0}
          onClick={showSidebar}
        />
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
      {context?.kind === "checkout" && (
        <Checkout {...context} quiet={quiet} after={!!title || !!rename?.editing} />
      )}
      {context?.kind === "label" && (
        <span {...stylex.props(styles.checkout)}>
          <Icon name={context.icon} size={14} />
          <span {...stylex.props(styles.name, styles.ellipsis)}>{context.text}</span>
        </span>
      )}
    </header>
  );
}

/** The repository, the branch, and a linked worktree's folder. A click copies
 * the checkout's path. */
function Checkout({
  repository,
  branch,
  path,
  linked,
  quiet,
  after,
}: Extract<BarContext, { kind: "checkout" }> & { quiet: boolean; after: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`${repository}, ${branch ?? "detached HEAD"}${linked ? `, worktree ${basename(path)}` : ""}. Copy path`}
      {...tooltip(copied ? "Copied" : `Copy path · ${path}`)}
      onClick={() =>
        void navigator.clipboard.writeText(path).then(
          () => setCopied(true),
          () => {},
        )
      }
      {...stylex.props(ui.button, ui.pressable, styles.checkout, styles.copy)}
    >
      <span {...stylex.props(styles.name, after && styles.nameAfter)}>{repository}</span>
      <span {...stylex.props(styles.part)}>
        <Icon name="branch" size={13} />
        <span {...stylex.props(styles.ellipsis)}>{branch ?? "Detached HEAD"}</span>
      </span>
      {/* Quiet chrome leaves out a worktree folder that has the branch's name. */}
      {linked && !(quiet && basename(path) === branch) && (
        <span {...stylex.props(styles.part, styles.worktree)}>
          <Icon name="folder" size={13} />
          <span {...stylex.props(styles.ellipsis)}>{basename(path)}</span>
        </span>
      )}
    </button>
  );
}

const styles = stylex.create({
  // Level with the sidebar's own top row, so both read as one band.
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    minWidth: 0,
    height: "max(var(--med-titlebar-height), 40px)",
    paddingInlineStart: 8,
    // Clear of the window controls at the right, as on Windows and Linux.
    paddingInlineEnd: "max(calc(var(--med-titlebar-right) + 4px), 8px)",
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12.5,
  },
  // Past the window controls, where the sidebar would otherwise start.
  afterControls: { paddingInlineStart: "max(calc(var(--med-titlebar-left) + 4px), 8px)" },
  checkout: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    height: 28,
    paddingInline: 8,
    whiteSpace: "nowrap",
  },
  copy: {
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    cursor: "default",
  },
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
  part: { display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 },
  worktree: { color: tokens.faint },
  ellipsis: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
});
