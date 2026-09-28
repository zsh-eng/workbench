import { ToolButton } from "./ToolButton";
import { ShortcutKeys } from "./ShortcutKeys";
import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useRef, useState } from "react";
import type { RegisteredRepository } from "../../shared/protocol";
import { tokens, ui } from "../theme.stylex";
import { focusPaletteInput } from "../data/palette-focus";
import { distinctLabels } from "../data/tab-labels";
import { Icon } from "./Icon";

export interface BranchEntry {
  key: string;
  repositoryId: string;
  label: string;
  path?: string;
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
}: {
  repositories: RegisteredRepository[];
  entries: BranchEntry[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(entry: BranchEntry): string | void;
  onAddRepository(path: string): Promise<unknown>;
  onRemoveRepository(id: string): Promise<unknown>;
  onRefresh(): Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const id = useId();
  const [query, setQuery] = useState("");
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
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const allResults = entries.filter((entry) => {
    const repository = repositories.find((item) => item.id === entry.repositoryId);
    const text =
      `${repository?.name} ${repository?.path} ${entry.label} ${entry.path ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const results = allResults.slice(0, 200);
  const resultIndex = new Map(results.map((entry, index) => [entry.key, index]));
  const selectedIndex = Math.min(active, Math.max(0, results.length - 1));
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
  function select(entry: BranchEntry | undefined) {
    if (!entry || pending) return;
    const failure = onSelect(entry);
    if (failure) {
      setError(failure);
      return;
    }
    setError(null);
    onOpenChange(false);
    setActive(0);
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop, ui.instant)} />
        <Dialog.Popup
          initialFocus={() => focusPaletteInput(adding ? pathInput.current : input.current)}
          {...stylex.props(styles.dialog, ui.instant)}
        >
          <div {...stylex.props(styles.heading)}>
            <Dialog.Title {...stylex.props(styles.title)}>Open branch</Dialog.Title>
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
            Choose a branch or worktree from your repositories.
          </Dialog.Description>
          <div {...stylex.props(styles.search)}>
            <Icon name="search" />
            <input
              ref={input}
              value={query}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive(Math.min(selectedIndex + 1, Math.max(0, results.length - 1)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive(Math.max(0, selectedIndex - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  select(results[selectedIndex]);
                }
              }}
              {...stylex.props(styles.field)}
              placeholder="Search branches, worktrees, or repositories"
              aria-label="Search branches"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-results`}
              aria-activedescendant={
                results[selectedIndex] ? `${id}-result-${selectedIndex}` : undefined
              }
            />
          </div>
          <div ref={resultList} {...stylex.props(styles.results)}>
            {allResults.length > results.length && (
              <p role="status" {...stylex.props(styles.notice)}>
                Showing the first 200 of {allResults.length} matches. Refine your search.
              </p>
            )}
            <div id={`${id}-results`} role="listbox" aria-label="Branches and worktrees">
              {repositories.map((repository, repositoryIndex) => {
                const grouped = results.filter((entry) => entry.repositoryId === repository.id);
                const matchesRepository = words.every((word) =>
                  `${repository.name} ${repository.path}`.toLowerCase().includes(word),
                );
                if (!grouped.length && !matchesRepository) return null;
                return (
                  <div key={repository.id} role="group" aria-label={labels[repositoryIndex]}>
                    <div {...stylex.props(styles.groupTitle)}>
                      <span>{labels[repositoryIndex]}</span>
                      <span {...stylex.props(styles.detail)} title={repository.path}>
                        {repository.path}
                      </span>
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
                              select(entry);
                            }
                          }}
                          aria-selected={index === selectedIndex}
                          onClick={() => select(entry)}
                          onPointerMove={() => setActive(index)}
                          {...stylex.props(
                            styles.option,
                            index === selectedIndex && styles.selected,
                          )}
                        >
                          <Icon name="branch" size={14} />
                          <span {...stylex.props(styles.entry)}>
                            <span>{entry.label}</span>
                            <span {...stylex.props(styles.detail)}>
                              {entry.path ?? `Committed files only · ${entry.head.slice(0, 7)}`}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {!results.length && (
                <p {...stylex.props(styles.notice)}>No matching branches or worktrees.</p>
              )}
            </div>
          </div>
          <div {...stylex.props(styles.management)}>
            <details>
              <summary {...stylex.props(styles.summary)}>Manage repositories</summary>
              {repositories.map((repository, index) => (
                <div key={repository.id} {...stylex.props(styles.repository)}>
                  <span {...stylex.props(styles.entry)}>
                    <span>{labels[index]}</span>
                    <span {...stylex.props(styles.detail)}>{repository.path}</span>
                  </span>
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
  backdrop: { position: "fixed", inset: 0, backgroundColor: "#00000050", zIndex: 110 },
  dialog: {
    position: "fixed",
    top: "12vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(620px, 92vw)",
    maxHeight: "80vh",
    overflowY: "auto",
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    boxShadow: tokens.shadow,
    zIndex: 111,
    outline: "none",
  },
  heading: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12 },
  title: { fontSize: 13, fontWeight: 600, margin: 0 },
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
    padding: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    color: tokens.muted,
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
  groupTitle: { display: "flex", flexDirection: "column", gap: 3, padding: 8, fontWeight: 600 },
  detail: {
    fontSize: 11,
    fontWeight: 400,
    color: tokens.muted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 8,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.hover },
  },
  selected: { backgroundColor: tokens.hover },
  entry: { display: "flex", flexDirection: "column", minWidth: 0, flex: "1", gap: 3 },
  notice: { padding: 8, color: tokens.muted, margin: 0 },
  management: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  summary: { cursor: "pointer", color: tokens.muted },
  repository: { display: "flex", alignItems: "center", gap: 8, paddingBlock: 8 },
  addForm: { display: "flex", gap: 6 },
  path: { flex: "1", minWidth: 0 },
});
