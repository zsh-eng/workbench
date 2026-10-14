import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { ThreadList } from "../../../shared/threads";
import type { Workspace } from "../../data/workspaces";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { ActionTooltip, ToolButton } from "../ToolButton";

const basename = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) ?? path;

/** What the band names: a checkout, or a vault or pull request by its title. */
export type BarContext =
  | { kind: "checkout"; repository: string; branch?: string; path: string; linked: boolean }
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
  } as const;
}

/**
 * The workspace's title band, above its panes: what the workspace has checked
 * out, and Show sidebar while the sidebar is hidden. With the installed app's
 * title bar hidden, the band is the title bar beside the window controls; it
 * moves the window, and its controls take clicks.
 */
export function WorkspaceBar({
  context,
  showSidebar,
}: {
  context?: BarContext;
  /** The sidebar is hidden or covers the workspace: the band starts with its toggle. */
  showSidebar?: () => void;
}) {
  return (
    <header
      aria-label="Workspace"
      className={`med-title-row ${stylex.props(styles.bar, showSidebar && styles.afterControls).className ?? ""}`}
    >
      {showSidebar && (
        <ToolButton
          label="Show sidebar"
          shortcut="Mod+B"
          icon="panelLeft"
          aria-label="Show sidebar"
          onClick={showSidebar}
        />
      )}
      {context?.kind === "checkout" && <Checkout {...context} />}
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
function Checkout({ repository, branch, path, linked }: Extract<BarContext, { kind: "checkout" }>) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <ActionTooltip label={copied ? "Copied" : `Copy path · ${path}`}>
      <button
        type="button"
        aria-label={`${repository}, ${branch ?? "detached HEAD"}${linked ? `, worktree ${basename(path)}` : ""}. Copy path`}
        onClick={() =>
          void navigator.clipboard.writeText(path).then(
            () => setCopied(true),
            () => {},
          )
        }
        {...stylex.props(ui.button, ui.pressable, styles.checkout, styles.copy)}
      >
        <span {...stylex.props(styles.name)}>{repository}</span>
        <span {...stylex.props(styles.part)}>
          <Icon name="branch" size={13} />
          <span {...stylex.props(styles.ellipsis)}>{branch ?? "Detached HEAD"}</span>
        </span>
        {linked && (
          <span {...stylex.props(styles.part, styles.worktree)}>
            <Icon name="folder" size={13} />
            <span {...stylex.props(styles.ellipsis)}>{basename(path)}</span>
          </span>
        )}
      </button>
    </ActionTooltip>
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
    paddingInline: 8,
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
  part: { display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 },
  worktree: { color: tokens.faint },
  ellipsis: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
});
