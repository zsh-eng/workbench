import { ActionTooltip, ToolButton } from "./ToolButton";
import * as stylex from "@stylexjs/stylex";
import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RegisteredRepository } from "../../shared/protocol";
import { tokens, ui } from "../theme.stylex";
import { BranchPicker, type BranchEntry } from "./BranchPicker";
import { Icon } from "./Icon";
import { distinctLabels } from "../data/tab-labels";

export function BranchTabs({
  repositories,
  activeRepositoryId,
  activeBranch,
  repo,
  error,
  onBranch,
  onWorktree,
  onAddRepository,
  onRemoveRepository,
  onRefresh,
  pickerOpen,
  onPickerOpenChange,
}: {
  repositories: RegisteredRepository[];
  activeRepositoryId: string | null;
  activeBranch: string | null;
  repo?: string;
  error: string | null;
  onBranch(name: string, repositoryId: string): void;
  onWorktree(path: string, repositoryId: string): void;
  onAddRepository(path: string): Promise<unknown>;
  onRemoveRepository(id: string): Promise<unknown>;
  onRefresh(): Promise<unknown>;
  pickerOpen: boolean;
  onPickerOpenChange(open: boolean): void;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  const lastActive = useRef<string | null>(null);
  const entries = useMemo<BranchEntry[]>(
    () =>
      repositories.flatMap((repository) => [
        ...repository.branches.map((branch) => ({
          key: JSON.stringify([repository.id, "branch", branch.name]),
          repositoryId: repository.id,
          label: branch.name,
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
  const labelFor = (entry: BranchEntry) => {
    const index = repositories.findIndex((repository) => repository.id === entry.repositoryId);
    return repositories.length > 1 ? `${repositoryLabels[index]} / ${entry.label}` : entry.label;
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
  const close = (entry: BranchEntry) => {
    if (visible.length <= 1) return;
    const index = visible.indexOf(entry);
    const next = visible[index + 1] ?? visible[index - 1];
    setOpened((current) => current.filter((key) => key !== entry.key));
    if (entry.key === active && next) next.run();
  };
  return (
    <div {...stylex.props(styles.row)}>
      <Tabs.Root
        value={active}
        onValueChange={(key) => entries.find((entry) => entry.key === key)?.run()}
        {...stylex.props(styles.root)}
      >
        <Tabs.List aria-label="Branches and worktrees" {...stylex.props(styles.list)}>
          {visible.map((entry) => (
            <div key={entry.key} {...stylex.props(styles.tabGroup)}>
              <ActionTooltip
                label={
                  entry.path
                    ? `${entry.label}\nWorktree: ${entry.path}`
                    : `${entry.label}\nCommit ${entry.head.slice(0, 7)} · no worktree`
                }
              >
                <Tabs.Tab
                  value={entry.key}
                  aria-label={labelFor(entry)}
                  aria-controls="review-workspace"
                  onKeyDown={(event) => {
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      close(entry);
                    }
                  }}
                  {...stylex.props(styles.tab, entry.key === active && styles.active)}
                >
                  <Icon name="branch" size={14} />
                  <span {...stylex.props(styles.name)}>{labelFor(entry)}</span>
                  {entry.path && (
                    <span
                      aria-label="Existing worktree"
                      title="Existing worktree"
                      {...stylex.props(styles.dot)}
                    />
                  )}
                </Tabs.Tab>
              </ActionTooltip>
              <ActionTooltip label={`Close ${labelFor(entry)}`}>
                <button
                  type="button"
                  disabled={visible.length <= 1}
                  tabIndex={-1}
                  aria-label={`Close ${labelFor(entry)}`}
                  onClick={() => close(entry)}
                  {...stylex.props(styles.close)}
                >
                  <Icon name="close" size={11} />
                </button>
              </ActionTooltip>
            </div>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <ToolButton label="Open branch" icon="plus" onClick={() => onPickerOpenChange(true)} />
      {error && (
        <span role="status" {...stylex.props(ui.faint)} title={error}>
          Branches unavailable
        </span>
      )}
      <BranchPicker
        repositories={repositories}
        entries={entries}
        open={pickerOpen}
        onOpenChange={onPickerOpenChange}
        onAddRepository={onAddRepository}
        onRemoveRepository={onRemoveRepository}
        onRefresh={onRefresh}
        onSelect={(entry) => {
          if (!opened.includes(entry.key) && opened.length >= 32)
            return "You have 32 branch tabs open. Close a tab before opening another.";
          setOpened((current) => (current.includes(entry.key) ? current : [...current, entry.key]));
          entry.run();
        }}
      />
    </div>
  );
}
const styles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    minHeight: 29,
    backgroundColor: tokens.panel,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    paddingInline: 8,
    gap: 4,
  },
  tabGroup: { display: "flex", alignItems: "center", flexShrink: 0 },
  close: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 22,
    borderWidth: 0,
    borderRadius: 3,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.hover },
    color: tokens.muted,
  },
  root: { minWidth: 0, flex: "1" },
  list: { display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "thin" },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    minWidth: 0,
    maxWidth: 240,
    paddingInline: 8,
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    borderRadius: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.hover },
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    flexShrink: 0,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accent}` },
    outlineOffset: -3,
  },
  active: { color: tokens.text, backgroundColor: tokens.canvas, borderBottomColor: tokens.accent },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dot: { width: 5, height: 5, borderRadius: "50%", backgroundColor: tokens.green, flexShrink: 0 },
});
