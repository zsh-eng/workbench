import { tooltip } from "./ToolButton";
import { ActionMenu } from "./Controls";
import { Matched, matchRanges, PaletteActions, PaletteTitle, usePaletteFade } from "./Palette";
import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RegisteredRepository } from "../../shared/protocol";
import { parsePullUrl } from "../../shared/pull-workspace";
import { picked, tokens, ui } from "../theme.stylex";
import { focusPaletteInput } from "../data/palette-focus";
import { distinctLabels } from "../data/tab-labels";
import { rankRepositories, recordOpen } from "../data/repository-opens";
import { Icon } from "./Icon";

export interface BranchEntry {
  key: string;
  repositoryId: string;
  label: string;
  /** The branch name; a detached worktree has none. */
  branch?: string;
  /** The worktree's absolute path, to open it; the picker never shows it. */
  path?: string;
  /** The worktree's short name, shown and matched in place of its path. */
  checkout?: string;
  head: string;
  run(): void;
}

export function BranchPicker({
  repositories,
  entries,
  open,
  onOpenChange,
  onSelect,
  onAddRepository,
  onRemoveRepository,
  onRefresh,
  workspaces,
  onPullRequest,
  agents = [],
  initialQuery = "",
  repositoriesFirst = false,
  current,
}: {
  repositories: RegisteredRepository[];
  entries: BranchEntry[];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** `newWorkspace` is set by ⌘↵ or ⌘-click. */
  onSelect(entry: BranchEntry, newWorkspace: boolean): string | void;
  onAddRepository(path: string): Promise<unknown>;
  onRemoveRepository(id: string): Promise<unknown>;
  onRefresh(): Promise<unknown>;
  /** With workspaces, where a plain ↵ opens the branch: here, or in a new one. */
  workspaces?: "here" | "new";
  /** Opens a pasted GitHub pull request link in a new workspace. */
  onPullRequest?(url: string, agent?: string): void;
  /** Installed agents that can review the pull request in its worktree. */
  agents?: { id: string; name: string }[];
  /** The search it opens with, such as a link on the Elements page. */
  initialQuery?: string;
  /**
   * ⌘O: the repositories first, ranked as zoxide does; Tab searches the
   * chosen one's branches, and ⇧Tab goes back.
   */
  repositoriesFirst?: boolean;
  /** The key of the branch or worktree on screen, which its row marks Current. */
  current?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const fade = usePaletteFade<HTMLDivElement>();
  const listRef = useCallback(
    (node: HTMLDivElement | null) => {
      resultList.current = node;
      return fade(node);
    },
    [fade],
  );
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = distinctLabels(
    repositories.map((repository) => ({
      label: repository.name,
      qualifier: repository.path.split("/").slice(0, -1).join("/"),
    })),
  );
  const labelOf = new Map(repositories.map((repository, index) => [repository.id, labels[index]]));
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  // ⌘O's repository whose branches the box searches, after Tab.
  const [scope, setScope] = useState<string | null>(null);
  // The picker opens again on the repositories.
  const setOpen = (next: boolean) => {
    if (!next) {
      setScope(null);
      setActive(0);
    }
    onOpenChange(next);
  };
  const scoped = scope ? repositories.find((repository) => repository.id === scope) : undefined;
  // Branch groups: the repository of the branch on screen first.
  const currentRepository = entries.find((entry) => entry.key === current)?.repositoryId;
  const groups = repositories
    .map((repository, index) => ({ repository, label: labels[index]! }))
    .toSorted(
      (a, b) =>
        Number(b.repository.id === currentRepository) -
        Number(a.repository.id === currentRepository),
    );
  const groupRank = (repositoryId: string) =>
    groups.findIndex((group) => group.repository.id === repositoryId);
  const allResults = entries
    .filter((entry) => {
      if (scoped && entry.repositoryId !== scoped.id) return false;
      const text = (
        scoped
          ? `${entry.label} ${entry.checkout ?? ""}`
          : `${labelOf.get(entry.repositoryId)} ${entry.label} ${entry.checkout ?? ""}`
      ).toLowerCase();
      return words.every((word) => text.includes(word));
    })
    // In the order the rows show: the repository on screen first, then the
    // others; in each, the branch on screen first and, in a repository, its
    // worktrees next.
    .toSorted(
      (a, b) =>
        groupRank(a.repositoryId) - groupRank(b.repositoryId) ||
        Number(b.key === current) - Number(a.key === current) ||
        (scoped ? Number(!a.path) - Number(!b.path) : 0),
    );
  const results = allResults.slice(0, 200);
  // The checkout that opens for a repository: its own folder's branch.
  const checkoutOf = (id: string) => {
    const repository = repositories.find((entry) => entry.id === id);
    const own = entries.filter((entry) => entry.repositoryId === id);
    return own.find((entry) => entry.path === repository?.path) ?? own[0];
  };
  const showRepositories = repositoriesFirst && !scoped;
  const repositoryRows = showRepositories
    ? rankRepositories(repositories).filter((repository) =>
        words.every((word) => labelOf.get(repository.id)!.toLowerCase().includes(word)),
      )
    : [];
  // A pasted pull request link opens it, alone or with an agent to review it.
  const pull = onPullRequest ? parsePullUrl(query) : undefined;
  const pullRows = pull
    ? [{ id: "", name: "" }, ...agents].map((agent) => ({
        agent: agent.id || undefined,
        label: agent.id
          ? `Open and review with ${agent.name}`
          : `Open pull request #${pull.number}`,
      }))
    : [];
  const count = pull ? pullRows.length : showRepositories ? repositoryRows.length : results.length;
  const resultIndex = new Map(results.map((entry, index) => [entry.key, index]));
  // Add repository… is the list's last row, after the results.
  const showAdd = !pull && !scoped && !adding;
  const addIndex = count;
  const total = count + (showAdd ? 1 : 0);
  const selectedIndex = Math.min(active, Math.max(0, total - 1));
  const addSelected = showAdd && selectedIndex === addIndex;
  useEffect(() => {
    resultList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    if (adding) pathInput.current?.focus();
  }, [adding]);
  function startAdding() {
    if (pending) return;
    setError(null);
    setAdding(true);
    // Already adding, as from the ⋯ menu: the field takes the focus again.
    if (adding) requestAnimationFrame(() => pathInput.current?.focus());
  }
  function stopAdding() {
    setAdding(false);
    input.current?.focus();
  }
  async function manage(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cannot update repositories.");
    } finally {
      setPending(false);
    }
  }
  function openPull(row: (typeof pullRows)[number] | undefined) {
    if (!pull || !row) return;
    onPullRequest?.(pull.url, row.agent);
    setOpen(false);
    setQuery(initialQuery);
    setActive(0);
  }
  function select(entry: BranchEntry | undefined, newWorkspace = false) {
    if (!entry || pending) return;
    const failure = onSelect(entry, newWorkspace);
    if (failure) {
      setError(failure);
      return;
    }
    setError(null);
    recordOpen(entry.repositoryId);
    setOpen(false);
    setActive(0);
  }
  function enter(repository: RegisteredRepository | undefined) {
    if (!repository) return;
    setScope(repository.id);
    setQuery("");
    setActive(0);
  }
  function leave() {
    const back = scope;
    setScope(null);
    setQuery("");
    setActive(
      Math.max(
        0,
        rankRepositories(repositories).findIndex((entry) => entry.id === back),
      ),
    );
  }
  const title = repositoriesFirst
    ? "Open repository"
    : workspaces === "new"
      ? "New workspace"
      : "Open branch";
  // The selected row's actions, where Enter is not the only one.
  const branchActions =
    workspaces === "here"
      ? [
          { label: "Open", keys: "↵" },
          { label: "New workspace", keys: "⌘↵" },
        ]
      : null;
  const repositoryActions = [
    { label: "Open", keys: "↵" },
    { label: "Branches", keys: "⇥" },
  ];
  const row = (index: number, extra?: stylex.StyleXStyles) =>
    stylex.props(
      ui.paletteRow,
      styles.option,
      extra,
      index === selectedIndex && [ui.paletteRowOn, picked],
    );
  const addRow = showAdd && (
    <div
      id={`${id}-result-${addIndex}`}
      role="option"
      tabIndex={-1}
      aria-selected={addSelected}
      aria-disabled={pending || undefined}
      data-add-repository=""
      onClick={startAdding}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startAdding();
        }
      }}
      onPointerMove={() => setActive(addIndex)}
      {...row(addIndex)}
    >
      <span {...stylex.props(ui.paletteRowIcon)}>
        <Icon name="plus" />
      </span>
      <span {...stylex.props(ui.paletteRowText, styles.quiet)}>Add repository…</span>
    </div>
  );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(ui.scrim, ui.paletteScrim, ui.instant)} />
        <Dialog.Popup
          initialFocus={() => focusPaletteInput(adding ? pathInput.current : input.current)}
          {...stylex.props(ui.palette, ui.instant)}
        >
          <PaletteTitle>{title}</PaletteTitle>
          <Dialog.Description {...stylex.props(ui.srOnly)}>
            {repositoriesFirst
              ? "Choose a repository. Enter opens it; Tab searches its branches, and Shift-Tab goes back."
              : workspaces === "here"
                ? "Choose a branch or worktree from your repositories. Enter opens it here; Command-Enter opens it in a new workspace."
                : "Choose a branch or worktree from your repositories. Enter opens it."}
          </Dialog.Description>
          <div {...stylex.props(ui.paletteInput)}>
            <Icon name="search" />
            {scoped && (
              <span
                title="Shift-Tab or Backspace goes back to the repositories"
                {...stylex.props(styles.chip)}
              >
                <Icon name="repository" size={13} />
                {labelOf.get(scoped.id)}
              </span>
            )}
            <input
              ref={input}
              value={query}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Tab" && !event.shiftKey && showRepositories && !pull) {
                  event.preventDefault();
                  enter(repositoryRows[selectedIndex]);
                } else if (
                  scoped &&
                  ((event.key === "Tab" && event.shiftKey) || (event.key === "Backspace" && !query))
                ) {
                  event.preventDefault();
                  leave();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive(Math.min(selectedIndex + 1, Math.max(0, total - 1)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive(Math.max(0, selectedIndex - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (addSelected) startAdding();
                  else if (pull) openPull(pullRows[selectedIndex]);
                  else if (showRepositories) {
                    const repository = repositoryRows[selectedIndex];
                    if (repository)
                      select(checkoutOf(repository.id), event.metaKey || event.ctrlKey);
                  } else select(results[selectedIndex], event.metaKey || event.ctrlKey);
                }
              }}
              {...stylex.props(ui.paletteField)}
              placeholder={
                showRepositories
                  ? "Search repositories…"
                  : scoped
                    ? `Search ${scoped.name}'s branches and worktrees…`
                    : workspaces === "new"
                      ? onPullRequest
                        ? "New workspace from a branch or a pull request link…"
                        : "New workspace from a branch…"
                      : onPullRequest
                        ? "Search branches, or paste a pull request link…"
                        : "Search branches, worktrees, or repositories…"
              }
              aria-label={showRepositories ? "Search repositories" : "Search branches"}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-results`}
              aria-activedescendant={
                addSelected ||
                (pull
                  ? pullRows[selectedIndex]
                  : showRepositories
                    ? repositoryRows[selectedIndex]
                    : results[selectedIndex])
                  ? `${id}-result-${selectedIndex}`
                  : undefined
              }
            />
            <button
              type="button"
              aria-label="Refresh branches"
              disabled={pending}
              {...tooltip("Refresh branches")}
              onClick={() => void manage(onRefresh)}
              {...stylex.props(ui.button, ui.iconButton, ui.paletteTool)}
            >
              <Icon name="refresh" />
            </button>
            <ActionMenu
              label="Manage repositories"
              layer="dialog"
              trigger={[ui.button, ui.iconButton, ui.paletteTool]}
              sections={[
                [{ label: "Add repository…", disabled: pending, onClick: startAdding }],
                repositories.map((repository, index) => ({
                  label: `Remove ${labels[index]}`,
                  hint: "Closes its tabs. Files stay on disk.",
                  disabled: pending,
                  onClick: () => void manage(() => onRemoveRepository(repository.id)),
                })),
              ]}
            >
              <Icon name="more" />
            </ActionMenu>
          </div>
          <div ref={listRef} {...stylex.props(ui.paletteList)}>
            {allResults.length > results.length && (
              <p role="status" {...stylex.props(ui.label, ui.paletteSection, styles.cap)}>
                Showing the first 200 of {allResults.length} matches. Refine your search.
              </p>
            )}
            {showRepositories && !pull && (
              <div id={`${id}-results`} role="listbox" aria-label="Repositories">
                {repositoryRows.map((repository, index) => {
                  const checkout = checkoutOf(repository.id);
                  return (
                    <div
                      key={repository.id}
                      id={`${id}-result-${index}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === selectedIndex}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          select(checkout, event.metaKey || event.ctrlKey);
                        }
                      }}
                      onClick={(event) => select(checkout, event.metaKey || event.ctrlKey)}
                      onPointerMove={() => setActive(index)}
                      {...row(index)}
                    >
                      <span {...stylex.props(ui.paletteRowIcon)}>
                        <Icon name="repository" />
                      </span>
                      <span {...stylex.props(ui.paletteRowText)}>
                        <Matched
                          text={labelOf.get(repository.id)!}
                          ranges={matchRanges(labelOf.get(repository.id)!, query)}
                        />
                      </span>
                      {/* The selected row shows its actions; its end text stays for screen readers. */}
                      {checkout?.branch && (
                        <span
                          {...stylex.props(index === selectedIndex ? ui.srOnly : ui.paletteAside)}
                        >
                          {checkout.branch}
                        </span>
                      )}
                      {index === selectedIndex && <PaletteActions actions={repositoryActions} />}
                    </div>
                  );
                })}
                {!repositoryRows.length && (
                  <p {...stylex.props(ui.paletteEmpty, styles.short)}>
                    No repositories match “{query.trim()}”
                  </p>
                )}
                {addRow}
              </div>
            )}
            <div
              id={showRepositories && !pull ? undefined : `${id}-results`}
              role="listbox"
              aria-label="Branches and worktrees"
              hidden={showRepositories && !pull}
            >
              {pull && (
                <div role="group" aria-labelledby={`${id}-pull`} {...stylex.props(ui.paletteGroup)}>
                  <div id={`${id}-pull`} {...stylex.props(ui.label, ui.paletteSection)}>
                    Pull request ·{" "}
                    <span {...stylex.props(styles.asIs)}>
                      {pull.owner}/{pull.name} #{pull.number}
                    </span>
                  </div>
                  {pullRows.map((pullRow, index) => (
                    <div
                      key={pullRow.agent ?? ""}
                      id={`${id}-result-${index}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === selectedIndex}
                      onClick={() => openPull(pullRow)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openPull(pullRow);
                        }
                      }}
                      onPointerMove={() => setActive(index)}
                      {...row(index)}
                    >
                      <span {...stylex.props(ui.paletteRowIcon)}>
                        <Icon name={pullRow.agent ? "superagent" : "pullRequest"} />
                      </span>
                      <span {...stylex.props(ui.paletteRowText)}>{pullRow.label}</span>
                      <span {...stylex.props(ui.paletteAside)}>
                        {pullRow.agent ? "Starts the agent in its worktree" : "In a worktree"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!pull &&
                !showRepositories &&
                groups.map(({ repository, label }) => {
                  if (scoped && repository.id !== scoped.id) return null;
                  const grouped = results.filter((entry) => entry.repositoryId === repository.id);
                  const matchesRepository = words.every((word) =>
                    label.toLowerCase().includes(word),
                  );
                  if (!grouped.length && !matchesRepository) return null;
                  return (
                    <div
                      key={repository.id}
                      role="group"
                      aria-label={label}
                      {...stylex.props(ui.paletteGroup)}
                    >
                      <div {...stylex.props(ui.label, ui.paletteSection, styles.asIs)}>{label}</div>
                      {repository.error && (
                        <p role="status" {...stylex.props(styles.notice)}>
                          {repository.error}
                        </p>
                      )}
                      {grouped.map((entry) => {
                        const index = resultIndex.get(entry.key)!;
                        // Current for the one on screen; a detached worktree's
                        // folder, as its label is only a commit; nothing for a
                        // branch's worktree; and for a branch without one, its
                        // commit, whose committed files open.
                        // A worktree's folder also shows when the query
                        // found the row by it.
                        const byFolder =
                          !!entry.checkout &&
                          words.some(
                            (word) =>
                              !entry.label.toLowerCase().includes(word) &&
                              entry.checkout!.toLowerCase().includes(word),
                          );
                        const end =
                          entry.key === current
                            ? "Current"
                            : !entry.branch || byFolder
                              ? (entry.checkout ?? null)
                              : entry.path
                                ? null
                                : `committed · ${entry.head.slice(0, 7)}`;
                        return (
                          <div
                            key={entry.key}
                            id={`${id}-result-${index}`}
                            role="option"
                            tabIndex={-1}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                select(entry, event.metaKey || event.ctrlKey);
                              }
                            }}
                            aria-selected={index === selectedIndex}
                            onClick={(event) => select(entry, event.metaKey || event.ctrlKey)}
                            onPointerMove={() => setActive(index)}
                            {...row(index)}
                          >
                            <span {...stylex.props(ui.paletteRowIcon)}>
                              <Icon name="branch" />
                            </span>
                            <span {...stylex.props(ui.paletteRowText)}>
                              <Matched
                                text={entry.label}
                                ranges={matchRanges(entry.label, query)}
                              />
                            </span>
                            {end && (
                              <span
                                {...stylex.props(
                                  branchActions && index === selectedIndex
                                    ? ui.srOnly
                                    : ui.paletteAside,
                                )}
                              >
                                {end}
                              </span>
                            )}
                            {branchActions && index === selectedIndex && (
                              <PaletteActions actions={branchActions} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              {!pull && !showRepositories && !results.length && (
                <p {...stylex.props(ui.paletteEmpty, styles.short)}>
                  {words.length
                    ? `No branches or worktrees match “${query.trim()}”`
                    : "No branches or worktrees"}
                </p>
              )}
              {!showRepositories && addRow}
            </div>
            {adding && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!path.trim() || pending) return;
                  void manage(async () => {
                    await onAddRepository(path.trim());
                    setPath("");
                    setAdding(false);
                    setQuery("");
                    setActive(0);
                    input.current?.focus();
                  });
                }}
                {...stylex.props(ui.paletteRow, styles.addForm)}
              >
                <span {...stylex.props(ui.paletteRowIcon)}>
                  <Icon name="plus" />
                </span>
                <input
                  ref={pathInput}
                  aria-label="Repository path"
                  placeholder="/path/to/repository"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  disabled={pending}
                  {...stylex.props(ui.input, styles.path)}
                />
                <button
                  type="submit"
                  disabled={pending || !path.trim()}
                  {...stylex.props(ui.button)}
                >
                  {pending ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  {...stylex.props(ui.button)}
                  onClick={stopAdding}
                >
                  Cancel
                </button>
              </form>
            )}
          </div>
          {error && (
            <p role="alert" {...stylex.props(ui.paletteNotice, styles.error)}>
              {error}
            </p>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  // ⌘O's repository, in the search band, after Tab.
  chip: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: 5,
    height: 24,
    paddingInline: 8,
    marginInlineEnd: -4,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 7%, transparent)`,
    color: tokens.text,
    fontSize: 13,
  },
  option: { cursor: "pointer" },
  quiet: { color: tokens.muted },
  // A repository's name in a section label keeps its case.
  asIs: { textTransform: "none", letterSpacing: "normal" },
  cap: { height: "auto", paddingTop: 6, whiteSpace: "normal" },
  // A repository's failure, under its label, where the rows' text starts.
  notice: {
    margin: 0,
    paddingBlock: 6,
    paddingInlineStart: 40,
    paddingInlineEnd: 10,
    color: tokens.muted,
    fontSize: 12,
  },
  // An empty list still has its last row, Add repository….
  short: { paddingTop: 24, paddingBottom: 26 },
  error: { color: tokens.warning },
  addForm: { gap: 8, cursor: "auto" },
  path: { flex: "1", minWidth: 0 },
});
