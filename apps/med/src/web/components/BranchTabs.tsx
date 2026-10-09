import { ActionTooltip } from "./ToolButton";
import * as stylex from "@stylexjs/stylex";
import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RegisteredRepository } from "../../shared/protocol";
import { tokens } from "../theme.stylex";
import type { BranchEntry } from "./BranchPicker";
import { Icon } from "./Icon";
import { distinctLabels } from "../data/tab-labels";

export interface BranchTabsOptions {
  repositories: RegisteredRepository[];
  activeRepositoryId: string | null;
  activeBranch: string | null;
  repo?: string;
  error: string | null;
  onBranch(name: string, repositoryId: string): void;
  onWorktree(path: string, repositoryId: string): void;
}

export type BranchTabsModel = ReturnType<typeof useBranchTabs>;

/**
 * Branches the reader has opened, in order. The strip shows them only when more
 * than one is open; a single branch needs no tab bar, only the switcher.
 */
export function useBranchTabs({
  repositories,
  activeRepositoryId,
  activeBranch,
  repo,
  error,
  onBranch,
  onWorktree,
}: BranchTabsOptions) {
  const [opened, setOpened] = useState<string[]>([]);
  const lastActive = useRef<string | null>(null);
  const entries = useMemo<BranchEntry[]>(
    () =>
      repositories.flatMap((repository) => [
        ...repository.branches.map((branch) => ({
          key: JSON.stringify([repository.id, "branch", branch.name]),
          repositoryId: repository.id,
          label: branch.name,
          branch: branch.name,
          path: branch.worktreePath,
          head: branch.head,
          run: () => onBranch(branch.name, repository.id),
        })),
        ...repository.worktrees
          .filter((tree) => !tree.bare && (!tree.branch || tree.branch === "Detached HEAD"))
          .map((tree) => ({
            key: JSON.stringify([repository.id, "worktree", tree.path]),
            repositoryId: repository.id,
            label: `Detached · ${tree.head.slice(0, 7)}`,
            path: tree.path,
            head: tree.head,
            run: () => onWorktree(tree.path, repository.id),
          })),
      ]),
    [repositories, onBranch, onWorktree],
  );
  const active = JSON.stringify([
    activeRepositoryId,
    activeBranch ? "branch" : "worktree",
    activeBranch ?? repo,
  ]);
  const repositoryLabels = distinctLabels(
    repositories.map((repository) => ({
      label: repository.name,
      qualifier: repository.path.split("/").slice(0, -1).join("/"),
    })),
  );
  const repositoryFor = (entry: BranchEntry) => {
    const index = repositories.findIndex((repository) => repository.id === entry.repositoryId);
    return repositories.length > 1 ? repositoryLabels[index] : null;
  };
  const labelFor = (entry: BranchEntry) => {
    const repository = repositoryFor(entry);
    return repository ? `${repository} / ${entry.label}` : entry.label;
  };
  useEffect(() => {
    const changed = lastActive.current !== active;
    lastActive.current = entries.some((entry) => entry.key === active) ? active : null;
    setOpened((current) => {
      const available = new Set(entries.map((entry) => entry.key));
      const next = current.filter((key) => available.has(key));
      if (changed && available.has(active) && !next.includes(active) && next.length < 32)
        next.push(active);
      return next.length === current.length && next.every((key, index) => key === current[index])
        ? current
        : next;
    });
  }, [active, entries]);
  const visible = opened.flatMap((key) => {
    const entry = entries.find((candidate) => candidate.key === key);
    return entry ? [entry] : [];
  });
  const activeIndex = repositories.findIndex((repository) => repository.id === activeRepositoryId);
  // The branch name the switch last showed. It lives here, not in the switch,
  // because toggling the sidebar moves the switch and mounts it again.
  const shownBranch = useRef<string | null>(null);
  return {
    entries,
    visible,
    active,
    current: entries.find((entry) => entry.key === active),
    /** Name of the active repository, qualified only when names collide. */
    repositoryName:
      activeIndex < 0
        ? repo?.split("/").at(-1)
        : repositories.length > 1
          ? repositoryLabels[activeIndex]
          : repositories[activeIndex]!.name,
    branchName: activeBranch,
    /** Whether a name differs from the one the switch last showed, so it rolls in. */
    isNewBranch: (name: string) => shownBranch.current !== null && shownBranch.current !== name,
    showedBranch(name: string) {
      shownBranch.current = name;
    },
    error,
    labelFor,
    repositoryFor,
    close(entry: BranchEntry) {
      if (visible.length <= 1) return;
      const index = visible.indexOf(entry);
      const next = visible[index + 1] ?? visible[index - 1];
      setOpened((current) => current.filter((key) => key !== entry.key));
      if (entry.key === active && next) next.run();
    },
    /** Picker selection: open the branch as a tab and switch to it. */
    open(entry: BranchEntry): string | void {
      if (!opened.includes(entry.key) && opened.length >= 32)
        return "You have 32 branch tabs open. Close a tab before opening another.";
      setOpened((current) => (current.includes(entry.key) ? current : [...current, entry.key]));
      entry.run();
    },
  };
}

/** Open branches as tabs. Renders nothing until a second branch is open. */
export function BranchStrip({ model }: { model: BranchTabsModel }) {
  const { visible, active } = model;
  if (visible.length < 2) return null;
  return (
    <Tabs.Root
      value={active}
      onValueChange={(key) => model.entries.find((entry) => entry.key === key)?.run()}
      {...stylex.props(styles.strip)}
    >
      <Tabs.List aria-label="Branches and worktrees" {...stylex.props(styles.list)}>
        {visible.map((entry) => {
          const selected = entry.key === active;
          const repository = model.repositoryFor(entry);
          const label = model.labelFor(entry);
          return (
            <div key={entry.key} {...stylex.props(styles.tabGroup, stylex.defaultMarker())}>
              <ActionTooltip
                label={
                  entry.path
                    ? `${entry.label}\nWorktree: ${entry.path}`
                    : `${entry.label}\nCommit ${entry.head.slice(0, 7)} · no worktree`
                }
              >
                <Tabs.Tab
                  value={entry.key}
                  aria-label={label}
                  aria-controls="review-workspace"
                  onKeyDown={(event) => {
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      model.close(entry);
                    }
                  }}
                  {...stylex.props(styles.tab, selected && styles.active)}
                >
                  <Icon name={entry.path ? "branch" : "commit"} size={14} />
                  <span {...stylex.props(styles.name)}>
                    {repository && (
                      <>
                        <span {...stylex.props(styles.repository)}>{repository}</span>
                        <span {...stylex.props(styles.slash)}>/</span>
                      </>
                    )}
                    {entry.label}
                  </span>
                </Tabs.Tab>
              </ActionTooltip>
              <ActionTooltip label={`Close ${label}`}>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Close ${label}`}
                  onClick={() => model.close(entry)}
                  {...stylex.props(styles.close, selected && styles.closeVisible)}
                >
                  <Icon name="close" size={12} />
                </button>
              </ActionTooltip>
            </div>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}

/**
 * The current repository and branch, and the way to another. It stays in one
 * place whether or not the strip is showing, so the layout does not shift.
 */
export function BranchSwitch({ model, onOpen }: { model: BranchTabsModel; onOpen(): void }) {
  const branch = model.current?.label ?? model.branchName ?? "Choose a branch";
  return (
    <span {...stylex.props(styles.switchRow)}>
      <ActionTooltip label="Open branch" shortcut="⌘ ⇧ G">
        <button
          type="button"
          aria-label="Open branch"
          aria-haspopup="dialog"
          aria-keyshortcuts="Meta+Shift+G Control+Shift+G"
          onClick={onOpen}
          {...stylex.props(styles.switch, stylex.defaultMarker())}
        >
          <Icon name={model.current && !model.current.path ? "commit" : "branch"} size={14} />
          <span {...stylex.props(styles.switchText)}>
            {model.repositoryName && (
              <>
                <span {...stylex.props(styles.switchRepository)}>{model.repositoryName}</span>
                <span {...stylex.props(styles.slash)}>/</span>
              </>
            )}
            {/* Keyed so a branch change rolls the new name in. */}
            <BranchName
              key={branch}
              name={branch}
              isNew={model.isNewBranch}
              onShown={model.showedBranch}
            />
          </span>
          <span {...stylex.props(styles.switchChevron)}>
            <Icon name="selector" size={14} />
          </span>
        </button>
      </ActionTooltip>
      {model.error && (
        <span role="status" title={model.error} {...stylex.props(styles.error)}>
          Branches unavailable
        </span>
      )}
    </span>
  );
}

/** Rolls in only for a new branch, not when the switch mounts in another place. */
function BranchName({
  name,
  isNew,
  onShown,
}: {
  name: string;
  isNew(name: string): boolean;
  onShown(name: string): void;
}) {
  const [rolls] = useState(() => isNew(name));
  useEffect(() => onShown(name), [name, onShown]);
  return <span {...stylex.props(styles.switchBranch, rolls && styles.roll)}>{name}</span>;
}

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-3px)" },
  to: { opacity: 1, transform: "none" },
});
const roll = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(5px)", filter: "blur(2px)" },
  to: { opacity: 1, transform: "none", filter: "none" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  // The strip sits on the app frame above both columns. It appears with the
  // second open branch, so its tabs settle in rather than the row sliding.
  strip: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: 36,
    minHeight: 36,
    paddingInline: 8,
    backgroundColor: tokens.panel,
  },
  list: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    minWidth: 0,
    overflowX: "auto",
    scrollbarWidth: "none",
    animationName: { default: enter, [reduced]: "none" },
    animationDuration: "180ms",
    animationTimingFunction: tokens.easeOut,
  },
  tabGroup: { position: "relative", display: "flex", alignItems: "center", flexShrink: 0 },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    height: 26,
    minWidth: 0,
    maxWidth: 260,
    paddingInlineStart: 9,
    paddingInlineEnd: 28,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.muted },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 450,
    cursor: "pointer",
    flexShrink: 0,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  active: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
  },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  repository: { opacity: 0.72 },
  slash: { color: tokens.faint, marginInline: 5 },
  // Close controls stay out of the way until the tab is active or hovered.
  close: {
    position: "absolute",
    insetInlineEnd: 5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1, ":focus-visible": 1 },
  },
  closeVisible: { opacity: 1 },
  switchRow: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 },
  switch: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    height: 28,
    minWidth: 0,
    paddingInlineStart: 7,
    paddingInlineEnd: 4,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  switchText: {
    display: "flex",
    alignItems: "baseline",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  // The repository name gives way first; the branch is what changes.
  switchRepository: {
    flexShrink: 1,
    minWidth: 24,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.muted,
    fontWeight: 450,
  },
  switchBranch: {
    flexShrink: 0,
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  roll: {
    animationName: { default: roll, [reduced]: "none" },
    animationDuration: "220ms",
    animationTimingFunction: tokens.easeOut,
  },
  switchChevron: {
    display: "flex",
    color: { default: tokens.faint, [stylex.when.ancestor(":hover")]: tokens.muted },
  },
  error: { color: tokens.faint, fontSize: 11, whiteSpace: "nowrap" },
});
