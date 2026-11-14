import { ToolButton } from "./ToolButton";
import { ActionMenu } from "./Controls";
import { PaletteHeader, PaletteHint, plural } from "./Palette";
import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useRef, useState } from "react";
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
}) {
  const input = useRef<HTMLInputElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
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
    if (!next) setScope(null);
    onOpenChange(next);
  };
  const scoped = scope ? repositories.find((repository) => repository.id === scope) : undefined;
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
    // In a repository, its worktrees come first.
    .toSorted((a, b) => (scoped ? Number(!a.path) - Number(!b.path) : 0));
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
      {...stylex.props(ui.paletteRow, styles.option, addSelected && [ui.menuHighlighted, picked])}
    >
      <span {...stylex.props(ui.paletteRowIcon)}>
        <Icon name="plus" size={14} />
      </span>
      <span {...stylex.props(ui.paletteRowText)}>Add repository…</span>
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
          <PaletteHeader title={title} closeLabel="Close branch picker">
            <ToolButton
              label="Refresh branches"
              icon="refresh"
              disabled={pending}
              onClick={() => void manage(onRefresh)}
            />
            <ActionMenu
              label="Manage repositories"
              layer="dialog"
              trigger={[ui.button, ui.iconButton]}
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
              <Icon name="more" size={15} />
            </ActionMenu>
          </PaletteHeader>
          <Dialog.Description {...stylex.props(ui.srOnly)}>
            Choose a branch or worktree from your repositories.
          </Dialog.Description>
          <div {...stylex.props(ui.paletteInput)}>
            <Icon name="search" />
            {scoped && (
              <span {...stylex.props(styles.chip)}>
                <Icon name="folder" size={13} />
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
          </div>
          <div ref={resultList} {...stylex.props(ui.paletteList)}>
            {allResults.length > results.length && (
              <p role="status" {...stylex.props(styles.notice)}>
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
                      {...stylex.props(
                        ui.paletteRow,
                        styles.option,
                        index === selectedIndex && [ui.menuHighlighted, picked],
                      )}
                    >
                      <span {...stylex.props(ui.paletteRowIcon)}>
                        <Icon name="folder" size={14} />
                      </span>
                      <span {...stylex.props(ui.paletteRowText)}>{labelOf.get(repository.id)}</span>
                      {checkout?.branch && (
                        <span {...stylex.props(ui.paletteRowSecondary, styles.branch)}>
                          {checkout.branch}
                        </span>
                      )}
                    </div>
                  );
                })}
                {!repositoryRows.length && (
                  <p {...stylex.props(styles.notice)}>No matching repositories.</p>
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
                <div role="group" aria-label="Pull request">
                  <div {...stylex.props(ui.label, ui.paletteSection)}>
                    <span>Pull request</span>
                    <span {...stylex.props(ui.paletteRowSecondary, styles.asIs)}>
                      {pull.owner}/{pull.name} #{pull.number}
                    </span>
                  </div>
                  {pullRows.map((row, index) => (
                    <div
                      key={row.agent ?? ""}
                      id={`${id}-result-${index}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === selectedIndex}
                      onClick={() => openPull(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openPull(row);
                        }
                      }}
                      onPointerMove={() => setActive(index)}
                      {...stylex.props(
                        ui.paletteRow,
                        ui.paletteRowTall,
                        styles.option,
                        index === selectedIndex && [ui.menuHighlighted, picked],
                      )}
                    >
                      <span {...stylex.props(ui.paletteRowIcon)}>
                        <Icon name={row.agent ? "agent" : "pullRequest"} size={14} />
                      </span>
                      <span {...stylex.props(ui.paletteRowLines)}>
                        <span {...stylex.props(ui.paletteRowText)}>{row.label}</span>
                        <span {...stylex.props(ui.paletteRowSecondary)}>
                          {row.agent
                            ? "Check out in a worktree, then start the agent there"
                            : "Check out in a worktree and open its review"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!pull &&
                !showRepositories &&
                repositories.map((repository, repositoryIndex) => {
                  if (scoped && repository.id !== scoped.id) return null;
                  const grouped = results.filter((entry) => entry.repositoryId === repository.id);
                  const matchesRepository = words.every((word) =>
                    labels[repositoryIndex]!.toLowerCase().includes(word),
                  );
                  if (!grouped.length && !matchesRepository) return null;
                  return (
                    <div key={repository.id} role="group" aria-label={labels[repositoryIndex]}>
                      <div {...stylex.props(ui.label, ui.paletteSection)}>
                        {labels[repositoryIndex]}
                      </div>
                      {repository.error && (
                        <p role="status" {...stylex.props(styles.notice)}>
                          {repository.error}
                        </p>
                      )}
                      {grouped.map((entry) => {
                        const index = resultIndex.get(entry.key)!;
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
                            {...stylex.props(
                              ui.paletteRow,
                              ui.paletteRowTall,
                              styles.option,
                              index === selectedIndex && [ui.menuHighlighted, picked],
                            )}
                          >
                            <span {...stylex.props(ui.paletteRowIcon)}>
                              <Icon name="branch" size={14} />
                            </span>
                            <span {...stylex.props(ui.paletteRowLines)}>
                              <span {...stylex.props(ui.paletteRowText)}>{entry.label}</span>
                              <span {...stylex.props(ui.paletteRowSecondary)}>
                                {entry.checkout ??
                                  `Committed files only · ${entry.head.slice(0, 7)}`}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              {!pull && !showRepositories && !results.length && (
                <p {...stylex.props(styles.notice)}>No matching branches or worktrees.</p>
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
                  <Icon name="plus" size={14} />
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
            <p role="alert" {...stylex.props(ui.paletteNotice)}>
              {error}
            </p>
          )}
          <div {...stylex.props(ui.paletteFooter)}>
            {repositoriesFirst ? (
              <>
                <PaletteHint keys="Enter">Open</PaletteHint>
                {scoped ? (
                  <PaletteHint keys="Shift+Tab">Back</PaletteHint>
                ) : (
                  <PaletteHint keys="Tab">Search its branches</PaletteHint>
                )}
              </>
            ) : workspaces === "new" ? (
              <PaletteHint keys="Enter">Open in a new workspace</PaletteHint>
            ) : workspaces === "here" ? (
              <>
                <PaletteHint keys="Enter">Open here</PaletteHint>
                <PaletteHint keys="Mod+Enter">New workspace</PaletteHint>
              </>
            ) : (
              <PaletteHint keys="Enter">Open</PaletteHint>
            )}
            <span {...stylex.props(ui.paletteCount)}>
              {pull
                ? "1 pull request"
                : showRepositories
                  ? plural(repositoryRows.length, "repository", "repositories")
                  : allResults.length > results.length
                    ? `${results.length} of ${allResults.length} branches`
                    : plural(results.length, "branch", "branches")}
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  // ⌘O's repository, in the search box, after Tab.
  chip: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: 5,
    height: 22,
    paddingInline: 7,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.text,
    fontSize: 12.5,
  },
  // A repository's current branch, at its row's end.
  branch: { flexShrink: 1, fontFamily: tokens.code, fontSize: 11 },
  option: { cursor: "pointer" },
  // A repository's name in a section label keeps its case.
  asIs: { textTransform: "none", letterSpacing: "normal" },
  notice: { margin: 0, paddingBlock: 8, paddingInline: 36, color: tokens.muted },
  addForm: { gap: 6, cursor: "auto" },
  path: { flex: "1", minWidth: 0 },
});
