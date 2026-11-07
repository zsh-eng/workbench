import { ToolButton } from "./ToolButton";
import { ShortcutKeys } from "./ShortcutKeys";
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
  /** With workspaces, where a plain ↵ opens the branch: here, in a new one, or,
   * in a thread, as the checkout that the thread shows. */
  workspaces?: "here" | "new" | "thread";
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
  const selectedIndex = Math.min(active, Math.max(0, count - 1));
  useEffect(() => {
    resultList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    if (adding) pathInput.current?.focus();
  }, [adding]);
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
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop, ui.instant)} />
        <Dialog.Popup
          initialFocus={() => focusPaletteInput(adding ? pathInput.current : input.current)}
          {...stylex.props(styles.dialog, ui.instant)}
        >
          <div {...stylex.props(styles.heading)}>
            <Dialog.Title {...stylex.props(styles.title)}>
              {repositoriesFirst
                ? "Open repository"
                : workspaces === "new"
                  ? "New workspace"
                  : workspaces === "thread"
                    ? "Thread checkout"
                    : "Open branch"}
            </Dialog.Title>
            <span {...stylex.props(ui.grow)} />
            <ToolButton
              label="Refresh branches"
              icon="refresh"
              disabled={pending}
              onClick={() => void manage(onRefresh)}
            />
            <Dialog.Close aria-label="Close branch picker" {...stylex.props(ui.button)}>
              <ShortcutKeys value="Esc" />
            </Dialog.Close>
          </div>
          <Dialog.Description {...stylex.props(styles.hidden)}>
            {workspaces === "thread"
              ? "Choose the checkout whose changes this thread shows. The agent keeps its own folder."
              : "Choose a branch or worktree from your repositories."}
          </Dialog.Description>
          <div {...stylex.props(styles.search)}>
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
                  setActive(Math.min(selectedIndex + 1, Math.max(0, count - 1)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive(Math.max(0, selectedIndex - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (pull) openPull(pullRows[selectedIndex]);
                  else if (showRepositories) {
                    const repository = repositoryRows[selectedIndex];
                    if (repository)
                      select(checkoutOf(repository.id), event.metaKey || event.ctrlKey);
                  } else select(results[selectedIndex], event.metaKey || event.ctrlKey);
                }
              }}
              {...stylex.props(styles.field)}
              placeholder={
                showRepositories
                  ? "Search repositories"
                  : scoped
                    ? `Search ${scoped.name}'s branches and worktrees`
                    : onPullRequest
                      ? "Search branches, or paste a pull request link"
                      : "Search branches, worktrees, or repositories"
              }
              aria-label={showRepositories ? "Search repositories" : "Search branches"}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-results`}
              aria-activedescendant={
                (
                  pull
                    ? pullRows[selectedIndex]
                    : showRepositories
                      ? repositoryRows[selectedIndex]
                      : results[selectedIndex]
                )
                  ? `${id}-result-${selectedIndex}`
                  : undefined
              }
            />
          </div>
          <div ref={resultList} {...stylex.props(styles.results)}>
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
                        styles.option,
                        index === selectedIndex && [styles.selected, picked],
                      )}
                    >
                      <Icon name="folder" size={14} />
                      <span {...stylex.props(styles.entry, styles.line)}>
                        <span>{labelOf.get(repository.id)}</span>
                        {checkout?.branch && (
                          <span {...stylex.props(styles.detail, styles.branch)}>
                            {checkout.branch}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {!repositoryRows.length && (
                  <p {...stylex.props(styles.notice)}>No matching repositories.</p>
                )}
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
                  <div {...stylex.props(styles.groupTitle)}>
                    <span>Pull request</span>
                    <span {...stylex.props(styles.detail)}>
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
                        styles.option,
                        index === selectedIndex && [styles.selected, picked],
                      )}
                    >
                      <Icon name={row.agent ? "agent" : "pullRequest"} size={14} />
                      <span {...stylex.props(styles.entry)}>
                        <span>{row.label}</span>
                        <span {...stylex.props(styles.detail)}>
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
                      <div {...stylex.props(styles.groupTitle)}>{labels[repositoryIndex]}</div>
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
                              styles.option,
                              index === selectedIndex && [styles.selected, picked],
                            )}
                          >
                            <Icon name="branch" size={14} />
                            <span {...stylex.props(styles.entry)}>
                              <span>{entry.label}</span>
                              <span {...stylex.props(styles.detail)}>
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
            </div>
          </div>
          {repositoriesFirst && (
            <div {...stylex.props(styles.hints)}>
              <span {...stylex.props(styles.hint)}>
                <ShortcutKeys value="Enter" /> Open
              </span>
              {scoped ? (
                <span {...stylex.props(styles.hint)}>
                  <ShortcutKeys value="Shift+Tab" /> Repositories
                </span>
              ) : (
                <span {...stylex.props(styles.hint)}>
                  <ShortcutKeys value="Tab" /> Its branches
                </span>
              )}
            </div>
          )}
          {workspaces && !repositoriesFirst && (
            <div {...stylex.props(styles.hints)}>
              {workspaces === "new" ? (
                <span {...stylex.props(styles.hint)}>
                  <ShortcutKeys value="Enter" /> Open in a new workspace
                </span>
              ) : workspaces === "thread" ? (
                <>
                  <span {...stylex.props(styles.hint)}>
                    <ShortcutKeys value="Enter" /> Move this thread to the checkout
                  </span>
                  <span {...stylex.props(styles.hint)}>
                    <ShortcutKeys value="Mod+Enter" /> New workspace
                  </span>
                </>
              ) : (
                <>
                  <span {...stylex.props(styles.hint)}>
                    <ShortcutKeys value="Enter" /> Open here
                  </span>
                  <span {...stylex.props(styles.hint)}>
                    <ShortcutKeys value="Mod+Enter" /> New workspace
                  </span>
                </>
              )}
            </div>
          )}
          <div {...stylex.props(styles.management, repositoriesFirst && styles.gone)}>
            <details>
              <summary {...stylex.props(styles.summary)}>Manage repositories</summary>
              {repositories.map((repository, index) => (
                <div key={repository.id} {...stylex.props(styles.repository)}>
                  <span {...stylex.props(styles.entry)}>{labels[index]}</span>
                  <button
                    {...stylex.props(ui.button)}
                    disabled={pending}
                    aria-label={`Remove repository ${labels[index]}`}
                    title="Remove from this session"
                    onClick={() => void manage(() => onRemoveRepository(repository.id))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <p {...stylex.props(styles.detail)}>
                Removing a repository closes its tabs. Files stay on disk.
              </p>
            </details>
            {adding ? (
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
                {...stylex.props(styles.addForm)}
              >
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
                  onClick={() => {
                    setAdding(false);
                    input.current?.focus();
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                disabled={pending}
                {...stylex.props(ui.button)}
                onClick={() => {
                  setError(null);
                  setAdding(true);
                }}
              >
                <Icon name="plus" size={14} />
                Add repository…
              </button>
            )}
            {error && (
              <p role="alert" {...stylex.props(styles.notice)}>
                {error}
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  gone: { display: "none" },
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
  // A repository's row: its name, then its branch.
  line: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  branch: { fontFamily: tokens.code },
  backdrop: { position: "fixed", inset: 0, backgroundColor: tokens.scrim, zIndex: 110 },
  dialog: {
    position: "fixed",
    top: "12vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(620px, 92vw)",
    maxHeight: "80vh",
    overflowY: "auto",
    backgroundColor: tokens.raised,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    borderRadius: `calc(12px * ${tokens.round})`,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    zIndex: 111,
    outline: "none",
  },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    minHeight: 44,
    paddingInlineStart: 16,
    paddingInlineEnd: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  title: { fontSize: 12.5, fontWeight: 550, margin: 0 },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    color: tokens.faint,
  },
  field: {
    flex: "1",
    minWidth: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 14,
  },
  results: { padding: 6, maxHeight: "42vh", overflowY: "auto" },
  groupTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    paddingInline: 8,
    paddingTop: 10,
    paddingBottom: 4,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 500,
  },
  detail: {
    fontSize: 11,
    fontWeight: 400,
    color: tokens.faint,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
    paddingBlock: 5,
    paddingInline: 10,
    boxSizing: "border-box",
    borderRadius: `calc(7px * ${tokens.round})`,
    color: tokens.muted,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
  },
  selected: {
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
    color: tokens.selectedText,
  },
  entry: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: "1",
    gap: 2,
    color: tokens.text,
    fontSize: 12.5,
  },
  notice: { padding: 8, color: tokens.muted, margin: 0 },
  hints: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minHeight: 34,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    color: tokens.faint,
    fontSize: 11.5,
  },
  hint: { display: "flex", alignItems: "center", gap: 6 },
  management: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  summary: { cursor: "pointer", color: tokens.muted },
  repository: { display: "flex", alignItems: "center", gap: 8, paddingBlock: 8 },
  addForm: { display: "flex", gap: 6 },
  path: { flex: "1", minWidth: 0 },
});
