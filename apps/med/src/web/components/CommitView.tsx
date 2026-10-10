import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import type { FileDiffMetadata } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewFile } from "../../shared/protocol";
import { normalizeDiffMetadataPaths } from "../../shared/hunk/diffPaths";
import { emptyMetadata, parseReviewPatch, reviewFileMatchesFilter } from "../../shared/review";
import {
  predictStage,
  rowPaths,
  stageState,
  type CommitApi,
  type StageChange,
  type WorkingDiff,
  type WorkingFile,
  type WorkingStatus,
} from "../data/commit";
import { visibleElement } from "../data/palette-focus";
import { useTheme } from "../themes";
import { picked, tokens, ui } from "../theme.stylex";
import { createPatchParser } from "../workers/client";
import { diffSurfaceStyle } from "./diff-surface";
import { Icon } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";

type Change = NonNullable<WorkingFile["staged"]>;
const letters: Record<Change, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechange: "T",
  untracked: "?",
  conflicted: "U",
};
const marks = {
  staged: { glyph: "●", label: "staged" },
  partial: { glyph: "◐", label: "partly staged" },
  unstaged: { glyph: "○", label: "not staged" },
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const aborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const short = (id: string) => id.slice(0, 7);
const change = (file: WorkingFile) => file.unstaged ?? file.staged;
/** A file that is still on disk, so it can open in a tab. */
const onDisk = (file: WorkingFile) => change(file) !== "deleted";

const readDraft = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const writeDraft = (key: string, text: string) => {
  try {
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // The draft is a convenience; the message stays in the field.
  }
};

/** Each file's change from HEAD to the working files, by path. */
interface ParsedDiff {
  id: string;
  files: Map<string, { info: ReviewFile; metadata: FileDiffMetadata | null }>;
}
/** A partly staged file shows its staged and unstaged halves. */
interface Split {
  key: string;
  staged: FileDiffMetadata | null;
  unstaged: FileDiffMetadata | null;
  note: string | null;
}
/** One file, or one half of a partly staged file, in the stream. */
interface StreamEntry {
  id: string;
  file: WorkingFile;
  part: "staged" | "unstaged" | null;
  metadata: FileDiffMetadata | null;
  info?: ReviewFile;
  note: string | null;
}

// What a file's diff shows, without the object IDs on its index line: staging
// a new file changes them, not the lines.
const fingerprints = new WeakMap<FileDiffMetadata, string>();
function fingerprint(metadata: FileDiffMetadata) {
  let value = fingerprints.get(metadata);
  if (value === undefined) {
    const { name, prevName, type, mode, prevMode, hunks, additionLines, deletionLines } = metadata;
    value = JSON.stringify([
      name,
      prevName,
      type,
      mode,
      prevMode,
      hunks,
      additionLines,
      deletionLines,
    ]);
    fingerprints.set(metadata, value);
  }
  return value;
}

/** Parse the working diff. A file whose diff did not change keeps its
 * metadata, so the stream does not draw or measure it again. */
async function parseDiff(
  diff: WorkingDiff,
  parse: (patch: string) => Promise<FileDiffMetadata[]>,
  previous: ParsedDiff | null,
): Promise<ParsedDiff> {
  const byName = new Map<string, FileDiffMetadata>();
  for (const item of await parse(diff.patch)) {
    const metadata = normalizeDiffMetadataPaths(item);
    if (!byName.has(metadata.name)) byName.set(metadata.name, metadata);
  }
  const files: ParsedDiff["files"] = new Map();
  for (const info of diff.files) {
    if (files.has(info.path)) continue;
    const parsed = info.binary || info.tooLarge ? undefined : byName.get(info.path);
    const before = previous?.files.get(info.path)?.metadata;
    files.set(info.path, {
      info,
      metadata: !parsed
        ? null
        : before && fingerprint(before) === fingerprint(parsed)
          ? before
          : { ...parsed, cacheKey: `${diff.id}:${info.path}` },
    });
  }
  return { id: diff.id, files };
}

// The stream redraws an item only when its metadata changes. These keep one
// version and one placeholder per metadata, across renders.
const versions = new WeakMap<FileDiffMetadata, number>();
let nextVersion = 0;
const versionOf = (metadata: FileDiffMetadata) => {
  let version = versions.get(metadata);
  if (version === undefined) versions.set(metadata, (version = ++nextVersion));
  return version;
};
const placeholders = new WeakMap<object, Map<string, FileDiffMetadata>>();
const loading = {};
function placeholder(owner: object, file: WorkingFile) {
  let byPath = placeholders.get(owner);
  if (!byPath) placeholders.set(owner, (byPath = new Map()));
  const kind = change(file);
  const key = `${file.path}\0${kind}`;
  let metadata = byPath.get(key);
  if (!metadata) {
    metadata = emptyMetadata({
      path: file.path,
      previousPath: file.previousPath,
      status: kind === "deleted" ? "D" : kind === "added" ? "A" : "M",
      additions: 0,
      deletions: 0,
      binary: false,
      untracked: kind === "untracked",
    });
    byPath.set(key, metadata);
  }
  return metadata;
}

/**
 * Stage files, commit them, and push the branch: the part of lazygit that a
 * review needs. The changed files and their diffs are one stream in the same
 * order, so moving through files scrolls. Keys: j/k move, Space stages a
 * file, a stages all, / filters, c writes the message, Mod+Enter commits,
 * P pushes. Staging shows at once; Git's answer follows.
 */
export default function CommitView({
  api,
  revision,
  active,
  draftKey,
  keys = "window",
  onOpenFile,
}: {
  api: CommitApi;
  /** Changes when the checkout changes; the view reads its status again. */
  revision: number;
  active: boolean;
  /** Keeps an unsent message across reloads. */
  draftKey?: string;
  /** Opens a working file in a tab, as a file name in Changes does. */
  onOpenFile?(path: string, background: boolean): void;
  /** "view" takes keys only while focus is inside, as on the elements page. */
  keys?: "window" | "view";
}) {
  const { active: theme } = useTheme();
  // Git's last answer, and the stages it has not answered yet.
  const [server, setServer] = useState<WorkingStatus | null>(null);
  const [pending, setPending] = useState<readonly StageChange[]>([]);
  const status = useMemo(() => server && pending.reduce(predictStage, server), [server, pending]);
  const latest = useRef<WorkingStatus | null>(null);
  const writes = useRef(0);
  const [diff, setDiff] = useState<ParsedDiff | null>(null);
  const [splits, setSplits] = useState<ReadonlyMap<string, Split>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [text, setText] = useState(() => (draftKey ? readDraft(draftKey) : ""));
  const [busy, setBusy] = useState<"commit" | "push" | null>(null);
  const [notice, setNotice] = useState<{ tone: "done" | "error"; text: string } | null>(null);
  const [confirmTrack, setConfirmTrack] = useState(false);
  // The message appears only while the user writes it.
  const [composing, setComposing] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const queue = useRef(Promise.resolve());
  const shownDiff = useRef<ParsedDiff | null>(null);
  const parser = useRef<ReturnType<typeof createPatchParser> | null>(null);
  // After a key or a click on the list, the list leads and the stream follows,
  // until the user scrolls the stream.
  const following = useRef(false);
  // The focused path as of the last key, before React draws it: held keys
  // can arrive faster than renders.
  const cursor = useRef<string | null>(null);

  const files = useMemo(() => status?.files ?? [], [status]);
  const shown = useMemo(
    () =>
      filter
        ? files.filter((file) =>
            reviewFileMatchesFilter({ path: file.path, previousPath: file.previousPath }, filter),
          )
        : files,
    [files, filter],
  );
  const focusedFile = shown.find((file) => file.path === focused) ?? shown[0] ?? null;
  const stagedCount = files.filter((file) => file.staged && file.staged !== "conflicted").length;

  const accept = useCallback((next: WorkingStatus) => {
    latest.current = next;
    setServer(next);
    setLoadError(null);
  }, []);
  // A status read that overlaps a write may predate it; the write's own
  // answer is newer.
  const readStatus = useCallback(
    async (signal?: AbortSignal) => {
      const seen = writes.current;
      const next = await api.status(signal);
      if (!signal?.aborted && writes.current === seen) accept(next);
    },
    [accept, api],
  );
  const parse = useCallback(
    (patch: string) =>
      patch.length > 256 * 1024
        ? (parser.current ??= createPatchParser()).parse(patch)
        : Promise.resolve(parseReviewPatch(patch)),
    [],
  );
  const showDiff = useCallback(
    async (next: WorkingDiff, signal?: AbortSignal) => {
      // The same id names the same changes; keep what is on screen.
      if (signal?.aborted || next.id === shownDiff.current?.id) return;
      const parsed = await parseDiff(next, parse, shownDiff.current);
      if (signal?.aborted) return;
      shownDiff.current = parsed;
      setDiff(parsed);
    },
    [parse],
  );
  const readDiff = useCallback(
    async (signal?: AbortSignal) => showDiff(await api.diff(signal), signal),
    [api, showDiff],
  );
  useEffect(() => () => parser.current?.dispose(), []);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const seen = writes.current;
    const fail = (error: unknown) => {
      if (!abort.signal.aborted && !aborted(error)) setLoadError(message(error));
    };
    api.status(abort.signal).then((next) => {
      if (!abort.signal.aborted && writes.current === seen) accept(next);
    }, fail);
    api
      .diff(abort.signal)
      .then((next) => showDiff(next, abort.signal))
      .catch(fail);
    return () => abort.abort();
  }, [accept, active, api, revision, showDiff]);

  // A partly staged file reads its two halves; other files use the stream's diff.
  const splitKey = `${server?.indexKey}\0${diff?.id}`;
  const partial = useMemo(() => files.filter((file) => stageState(file) === "partial"), [files]);
  useEffect(() => {
    const missing = partial.filter((file) => splits.get(file.path)?.key !== splitKey);
    if (!active || !server || !missing.length) return;
    const abort = new AbortController();
    Promise.all(
      missing.map(async (file): Promise<[string, Split]> => {
        const halves = await api.changes(file, abort.signal);
        const before = splits.get(file.path);
        // An unchanged half keeps its metadata, so the stream does not redraw it.
        const half = (patch: string, previous: FileDiffMetadata | null | undefined) => {
          const metadata = patch ? (parseReviewPatch(patch)[0] ?? null) : null;
          return metadata && previous && fingerprint(previous) === fingerprint(metadata)
            ? previous
            : metadata;
        };
        return [
          file.path,
          {
            key: splitKey,
            staged: half(halves.staged, before?.staged),
            unstaged: half(halves.unstaged, before?.unstaged),
            note: halves.binary ? "Binary file" : halves.tooLarge ? "Too large to show" : null,
          },
        ];
      }),
    ).then(
      (loaded) => {
        if (!abort.signal.aborted) setSplits((current) => new Map([...current, ...loaded]));
      },
      () => {
        // The stream keeps the file's whole change until the halves load.
      },
    );
    return () => abort.abort();
  }, [active, api, partial, server, splitKey, splits]);

  useEffect(() => {
    if (draftKey) writeDraft(draftKey, text);
  }, [draftKey, text]);
  useEffect(() => {
    if (active && keys === "window") list.current?.focus({ preventScroll: true });
  }, [active, keys]);
  useEffect(() => {
    if (confirmTrack) confirmButton.current?.focus();
  }, [confirmTrack]);
  useEffect(() => {
    if (focusedFile)
      document
        .getElementById(rowId(focusedFile.path))
        ?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [focusedFile]);

  /** Runs writes one at a time, so quick keys reach Git in order. */
  const run = useCallback(
    (kind: "commit" | "push" | null, work: () => Promise<string | void>) => {
      queue.current = queue.current.then(async () => {
        if (kind) setBusy(kind);
        try {
          const done = await work();
          if (kind) setNotice(done ? { tone: "done", text: done } : null);
        } catch (error) {
          setNotice({ tone: "error", text: message(error) });
          await readStatus().catch(() => {});
        } finally {
          if (kind) setBusy(null);
        }
      });
      return queue.current;
    },
    [readStatus],
  );
  const stage = useCallback(
    (paths: string[] | null, value: boolean) => {
      const change: StageChange = { paths: paths && new Set(paths), stage: value };
      setPending((current) => [...current, change]);
      writes.current += 1;
      return run(null, async () => {
        try {
          accept(await api.stage(paths, value));
        } finally {
          setPending((current) => current.filter((entry) => entry !== change));
          writes.current += 1;
        }
      });
    },
    [accept, api, run],
  );
  const toggle = useCallback(
    (file: WorkingFile) => stage(rowPaths(file), stageState(file) !== "staged"),
    [stage],
  );
  const stageShown = shown.some((file) => file.unstaged);
  const toggleShown = useCallback(() => {
    if (!shown.length) return;
    return stage(filter ? shown.flatMap(rowPaths) : null, stageShown);
  }, [filter, shown, stage, stageShown]);
  const compose = useCallback(() => {
    setCommitError(null);
    setComposing(true);
  }, []);
  const commit = useCallback(() => {
    if (!status || !text.trim() || !stagedCount) return;
    const summary = text;
    setCommitError(null);
    return run("commit", async () => {
      try {
        // Queued stages have finished; commit what Git last reported.
        const result = await api.commit(summary, latest.current!.indexKey);
        setText("");
        setComposing(false);
        await Promise.all([readStatus(), readDiff()]);
        return `Committed ${short(result.head)} ${result.summary}`;
      } catch (error) {
        // A failed hook's output stays beside the message it rejected.
        setCommitError(message(error));
        await readStatus().catch(() => {});
      }
    });
  }, [api, readDiff, readStatus, run, stagedCount, status, text]);
  const push = useCallback(
    (track = false) => {
      if (!status?.head || !status.branch) return;
      if (!status.upstream && !track) {
        if (status.pushRemote) setConfirmTrack(true);
        else setNotice({ tone: "error", text: "Add a remote to push this branch." });
        return;
      }
      setConfirmTrack(false);
      return run("push", async () => {
        const result = await api.push(latest.current?.head ?? status.head, track);
        await readStatus();
        return `Pushed ${short(result.head)} to ${result.remote}/${result.branch}`;
      });
    },
    [api, readStatus, run, status],
  );

  // The stream: files in list order; a partly staged file shows two halves.
  const entries = useMemo<StreamEntry[]>(
    () =>
      shown.flatMap((file): StreamEntry[] => {
        // Halves read for an older index stay until the new ones load.
        const split = stageState(file) === "partial" ? splits.get(file.path) : undefined;
        if (split)
          return [
            {
              id: `s:${file.path}`,
              file,
              part: "staged",
              metadata: split.staged,
              note: split.note,
            },
            {
              id: `u:${file.path}`,
              file,
              part: "unstaged",
              metadata: split.unstaged,
              note: split.note,
            },
          ];
        const entry = diff?.files.get(file.path);
        const note = !diff
          ? "Loading…"
          : !entry
            ? "No changes to show"
            : entry.info.binary
              ? "Binary file"
              : entry.info.tooLarge
                ? "Too large to show"
                : !entry.metadata?.hunks.length
                  ? "No text changes"
                  : null;
        return [
          {
            id: `f:${file.path}`,
            file,
            part: null,
            metadata: entry?.metadata ?? null,
            info: entry?.info,
            note,
          },
        ];
      }),
    [diff, shown, splits],
  );
  const items = useMemo<CodeViewItem<undefined>[]>(
    () =>
      entries.map((entry) => {
        const fileDiff = entry.metadata ?? placeholder(diff ?? loading, entry.file);
        return {
          id: entry.id,
          type: "diff" as const,
          fileDiff,
          version: versionOf(fileDiff),
          collapsed: !entry.metadata?.hunks.length,
        };
      }),
    [diff, entries],
  );
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  useEffect(() => {
    cursor.current = focusedFile?.path ?? null;
  }, [focusedFile]);
  const select = useCallback(
    (path: string, reveal: boolean) => {
      cursor.current = path;
      setFocused(path);
      if (!reveal) return;
      const id = entries.find((entry) => entry.file.path === path)?.id;
      if (!id) return;
      following.current = true;
      viewer.current?.scrollTo({ type: "item", id, align: "start" });
    },
    [entries],
  );
  const move = useCallback(
    (step: number) => {
      if (!shown.length) return;
      const index = Math.max(
        0,
        shown.findIndex((file) => file.path === (cursor.current ?? focusedFile?.path)),
      );
      select(shown[Math.min(shown.length - 1, Math.max(0, index + step))]!.path, true);
    },
    [focusedFile, select, shown],
  );

  // The lazygit keys, while this view is on screen and no field has focus.
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (keys === "view" && !root.current?.contains(target)) return;
      const typing =
        !!target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (typing || visibleElement('[role="dialog"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        compose();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // As in a search: Escape outside the field clears the filter.
      if (event.key === "Escape") {
        if (filter) {
          event.preventDefault();
          setFilter("");
        }
        return;
      }
      const bindings: Record<string, () => void> = {
        j: () => move(1),
        ArrowDown: () => move(1),
        k: () => move(-1),
        ArrowUp: () => move(-1),
        " ": () => focusedFile && void toggle(focusedFile),
        Enter: () => focusedFile && onDisk(focusedFile) && onOpenFile?.(focusedFile.path, false),
        a: () => void toggleShown(),
        "/": () => search.current?.focus(),
        c: compose,
        P: () => void push(),
      };
      // Shift with a letter is its capital, whatever the key event reports.
      const name = event.shiftKey && event.key.length === 1 ? event.key.toUpperCase() : event.key;
      const action = bindings[name];
      if (!action) return;
      // Enter on a focused button or link presses it.
      if (name === "Enter" && target?.closest("button, a, [role='button'], [role='link']")) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, compose, filter, focusedFile, keys, move, onOpenFile, push, toggle, toggleShown]);

  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(
    () => ({
      theme: theme.pierreTheme,
      themeType: theme.appearance,
      diffStyle: "unified",
      overflow: "wrap",
      diffIndicators: "bars",
      lineDiffType: "word-alt",
      hunkSeparators: "line-info",
      stickyHeaders: true,
    }),
    [theme.pierreTheme, theme.appearance],
  );
  const pushLabel = status?.upstream
    ? `${status.upstream.remote}/${status.upstream.branch}`
    : status?.pushRemote && status.branch
      ? `${status.pushRemote}/${status.branch}`
      : null;
  const rows = Math.min(16, Math.max(6, text.split("\n").length + 1));
  const summaryLength = text.split("\n", 1)[0]!.trim().length;
  return (
    <div ref={root} {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.side)}>
          <header {...stylex.props(styles.header)}>
            <Icon name="gitBranch" size={14} />
            <span {...stylex.props(styles.branch)}>{status?.branch || "Detached HEAD"}</span>
            {status?.upstream && (
              <span {...stylex.props(ui.faint)} title="Commits ahead and behind the upstream">
                {status.ahead > 0 && `↑${status.ahead}`}
                {status.behind > 0 && ` ↓${status.behind}`}
              </span>
            )}
            <span {...stylex.props(ui.grow)} />
            <button
              type="button"
              disabled={!shown.length}
              onClick={() => void toggleShown()}
              title="Stage or unstage every file shown (a)"
              {...stylex.props(ui.button, styles.small)}
            >
              {`${stageShown ? "Stage" : "Unstage"} ${filter ? `${shown.length} shown` : "all"}`}
            </button>
          </header>
          <div {...stylex.props(styles.filter)}>
            <Icon name="search" size={13} />
            <input
              ref={search}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  move(event.key === "ArrowDown" ? 1 : -1);
                } else if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault();
                  if (event.key === "Escape") setFilter("");
                  list.current?.focus({ preventScroll: true });
                }
              }}
              placeholder="Filter files (/)"
              aria-label="Filter files to commit"
              spellCheck={false}
              {...stylex.props(styles.filterInput)}
            />
            {filter && (
              <span {...stylex.props(ui.faint)}>
                {shown.length}/{files.length}
              </span>
            )}
          </div>
          <div
            ref={list}
            role="listbox"
            tabIndex={0}
            aria-label="Changed files"
            aria-activedescendant={focusedFile ? rowId(focusedFile.path) : undefined}
            {...stylex.props(styles.list)}
          >
            {loadError && !status && (
              <p role="alert" {...stylex.props(styles.empty)}>
                {loadError}
              </p>
            )}
            {status && !files.length && (
              <p {...stylex.props(styles.empty)}>No changes to commit.</p>
            )}
            {status && !!files.length && !shown.length && (
              <p {...stylex.props(styles.empty)}>No file matches “{filter}”.</p>
            )}
            {shown.map((file) => {
              const state = stageState(file);
              const slash = file.path.lastIndexOf("/") + 1;
              const kind = change(file);
              return (
                // The listbox takes the keys and names the focused row.
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  key={file.path}
                  id={rowId(file.path)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={file === focusedFile}
                  aria-label={`${file.path}, ${marks[state].label}${kind ? `, ${kind}` : ""}`}
                  title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                  onClick={() => {
                    select(file.path, true);
                    list.current?.focus({ preventScroll: true });
                  }}
                  onDoubleClick={() => void toggle(file)}
                  {...stylex.props(styles.row, file === focusedFile && [styles.rowFocused, picked])}
                >
                  <span
                    aria-hidden="true"
                    title={`${marks[state].label}; click to ${state === "staged" ? "unstage" : "stage"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setFocused(file.path);
                      void toggle(file);
                    }}
                    {...stylex.props(styles.mark, state !== "unstaged" && styles.markOn)}
                  >
                    {marks[state].glyph}
                  </span>
                  <span {...stylex.props(styles.path)}>
                    <span {...stylex.props(ui.faint)}>{file.path.slice(0, slash)}</span>
                    {file.path.slice(slash)}
                  </span>
                  {kind && <ChangeLetter kind={kind} />}
                </div>
              );
            })}
          </div>
          <footer {...stylex.props(styles.footer)}>
            {notice ? (
              <p
                role={notice.tone === "error" ? "alert" : "status"}
                {...stylex.props(styles.notice, notice.tone === "error" && styles.noticeError)}
              >
                {notice.text}
              </p>
            ) : (
              <p {...stylex.props(styles.notice)}>
                {stagedCount
                  ? `${stagedCount} of ${files.length} ${files.length === 1 ? "file" : "files"} staged`
                  : "Nothing staged"}
              </p>
            )}
            {confirmTrack && pushLabel ? (
              <div role="group" aria-label="Track a new upstream" {...stylex.props(styles.confirm)}>
                <span {...stylex.props(styles.confirmText)}>
                  Push to <strong>{pushLabel}</strong> and track it?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmTrack(false);
                    list.current?.focus({ preventScroll: true });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setConfirmTrack(false);
                  }}
                  {...stylex.props(ui.button, styles.small)}
                >
                  Cancel
                </button>
                <button
                  ref={confirmButton}
                  type="button"
                  onClick={() => void push(true)}
                  {...stylex.props(ui.button, ui.primary, styles.small)}
                >
                  Push and track
                </button>
              </div>
            ) : (
              <div {...stylex.props(styles.actions)}>
                <button
                  type="button"
                  disabled={
                    busy !== null ||
                    !status?.head ||
                    !status.branch ||
                    (!!status.upstream && status.ahead === 0)
                  }
                  title={pushLabel ? `Push to ${pushLabel} (⇧P)` : "No remote to push to"}
                  onClick={() => void push()}
                  {...stylex.props(ui.button, styles.action)}
                >
                  <Icon name="push" size={14} />
                  {busy === "push" ? "Pushing…" : "Push"}
                  {!!status?.ahead && <span {...stylex.props(ui.faint)}>↑{status.ahead}</span>}
                </button>
                <button
                  type="button"
                  disabled={busy !== null || !stagedCount}
                  title="Write the message and commit (c)"
                  onClick={compose}
                  {...stylex.props(ui.button, ui.primary, styles.action)}
                >
                  <Icon name="commit" size={14} />
                  {busy === "commit" ? "Committing…" : "Commit…"}
                  <ShortcutKeys value="c" />
                </button>
              </div>
            )}
          </footer>
        </div>
        <div {...stylex.props(styles.main)}>
          <section
            aria-label="Changes to commit"
            onWheel={() => (following.current = false)}
            onPointerDown={() => (following.current = false)}
            onTouchStart={() => (following.current = false)}
            {...stylex.props(styles.stream)}
          >
            {items.length > 0 ? (
              <CodeView
                ref={viewer}
                items={items}
                options={options}
                className={stylex.props(styles.codeView).className}
                style={diffSurfaceStyle}
                // The file at the top of the stream is the file in focus.
                onScroll={(top, view) => {
                  if (following.current) return;
                  let current: string | null = null;
                  for (const entry of entries) {
                    const itemTop = view.getTopForItem(entry.id);
                    if (itemTop === undefined) continue;
                    if (itemTop > top + 4) break;
                    current = entry.file.path;
                  }
                  if (current && current !== focusedFile?.path) setFocused(current);
                }}
                renderCustomHeader={(item) => {
                  const entry = entryById.get(item.id);
                  if (!entry) return null;
                  const state = stageState(entry.file);
                  const slash = entry.file.path.lastIndexOf("/") + 1;
                  const kind = change(entry.file);
                  return (
                    <div
                      {...stylex.props(
                        styles.diffHeader,
                        entry.file.path === focusedFile?.path && styles.diffHeaderFocused,
                      )}
                    >
                      <button
                        type="button"
                        aria-label={`${state === "staged" ? "Unstage" : "Stage"} ${entry.file.path}`}
                        title={`${marks[state].label}; click to ${state === "staged" ? "unstage" : "stage"}`}
                        onClick={() => {
                          setFocused(entry.file.path);
                          void toggle(entry.file);
                        }}
                        {...stylex.props(styles.headerMark, state !== "unstaged" && styles.markOn)}
                      >
                        {marks[state].glyph}
                      </button>
                      {onOpenFile && onDisk(entry.file) ? (
                        <button
                          type="button"
                          role="link"
                          aria-label={entry.file.path}
                          title={`Open full file · ${entry.file.path}`}
                          onClick={(event) =>
                            onOpenFile(entry.file.path, event.metaKey || event.ctrlKey)
                          }
                          {...stylex.props(styles.path, styles.headerPath, styles.fileLink)}
                        >
                          <span {...stylex.props(ui.faint)}>{entry.file.path.slice(0, slash)}</span>
                          <span {...stylex.props(styles.fileName)}>
                            {entry.file.path.slice(slash)}
                          </span>
                        </button>
                      ) : (
                        <span {...stylex.props(styles.path, styles.headerPath)}>
                          <span {...stylex.props(ui.faint)}>{entry.file.path.slice(0, slash)}</span>
                          <span {...stylex.props(styles.fileName)}>
                            {entry.file.path.slice(slash)}
                          </span>
                        </span>
                      )}
                      {entry.part && (
                        <span {...stylex.props(styles.part)}>
                          {entry.part === "staged" ? "Staged" : "Not staged"}
                        </span>
                      )}
                      {kind && <ChangeLetter kind={kind} />}
                      {entry.note && <span {...stylex.props(ui.faint)}>{entry.note}</span>}
                      <span {...stylex.props(ui.grow)} />
                      {entry.info && !entry.part && (
                        <span {...stylex.props(styles.stats)}>
                          <span {...stylex.props(ui.added)}>+{entry.info.additions}</span>
                          <span {...stylex.props(ui.removed)}>−{entry.info.deletions}</span>
                        </span>
                      )}
                    </div>
                  );
                }}
              />
            ) : (
              status &&
              !files.length && (
                <div {...stylex.props(styles.clean)}>
                  <Icon name="check" size={18} />
                  Nothing to commit. The working files match HEAD.
                </div>
              )
            )}
          </section>
        </div>
      </div>
      <Dialog.Root
        open={composing}
        onOpenChange={(open) => {
          if (!open && busy !== "commit") setComposing(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop)} />
          <Dialog.Popup initialFocus={field} finalFocus={list} {...stylex.props(styles.dialog)}>
            <Dialog.Title {...stylex.props(styles.dialogTitle)}>
              <Icon name="commit" size={15} />
              Commit {stagedCount} {stagedCount === 1 ? "file" : "files"}
              {status?.branch && (
                <span {...stylex.props(styles.dialogBranch)}>to {status.branch}</span>
              )}
            </Dialog.Title>
            <textarea
              ref={field}
              aria-label="Commit message"
              placeholder="Summary, then a blank line and the body"
              value={text}
              rows={rows}
              spellCheck
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void commit();
                }
              }}
              {...stylex.props(ui.input, styles.message)}
            />
            {commitError && (
              <p role="alert" {...stylex.props(styles.dialogError)}>
                {commitError}
              </p>
            )}
            <div {...stylex.props(styles.dialogActions)}>
              <span
                title="Characters in the summary line"
                {...stylex.props(styles.count, summaryLength > 72 && styles.countLong)}
              >
                {summaryLength > 0 && summaryLength}
              </span>
              <Dialog.Close {...stylex.props(ui.button)} disabled={busy === "commit"}>
                Cancel
              </Dialog.Close>
              <button
                type="button"
                disabled={busy !== null || !stagedCount || !text.trim()}
                onClick={() => void commit()}
                {...stylex.props(ui.button, ui.primary, styles.action)}
              >
                {busy === "commit" ? "Committing…" : "Commit"}
                <ShortcutKeys value="Mod+Enter" />
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

const rowId = (path: string) => `commit-row-${encodeURIComponent(path)}`;

function ChangeLetter({ kind }: { kind: Change }) {
  return (
    <span
      title={kind}
      {...stylex.props(
        styles.letter,
        (kind === "added" || kind === "untracked") && ui.added,
        kind === "deleted" && ui.removed,
        kind === "conflicted" && styles.conflict,
      )}
    >
      {letters[kind]}
    </span>
  );
}

const headerBackground = `color-mix(in srgb, ${tokens.canvas} 96%, ${tokens.text})`;
const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translate(-50%, 6px) scale(0.985)" },
  to: { opacity: 1, transform: "translate(-50%, 0) scale(1)" },
});
// A narrow view puts the file list above the message and the stream.
const narrow = "@container (max-width: 720px)";
const styles = stylex.create({
  root: {
    height: "100%",
    minHeight: 0,
    containerType: "inline-size",
    backgroundColor: tokens.canvas,
  },
  layout: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(240px, 28%) minmax(0, 1fr)",
      [narrow]: "minmax(0, 1fr)",
    },
    gridTemplateRows: { default: "minmax(0, 1fr)", [narrow]: "minmax(0, 34%) minmax(0, 1fr)" },
    height: "100%",
    minHeight: 0,
  },
  side: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRightWidth: { default: 1, [narrow]: 0 },
    borderRightStyle: "solid",
    borderRightColor: tokens.line,
    borderBottomWidth: { default: 0, [narrow]: 1 },
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    height: 40,
    flexShrink: 0,
    paddingInline: 12,
    color: tokens.muted,
    fontSize: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  branch: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontWeight: 500,
  },
  small: { flexShrink: 0, height: 24, paddingInline: 8, fontSize: 12 },
  filter: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexShrink: 0,
    height: 34,
    paddingInline: 12,
    color: tokens.faint,
    fontSize: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  filterInput: {
    flex: "1",
    minWidth: 0,
    height: "100%",
    padding: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    "::placeholder": { color: tokens.faint },
  },
  list: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    paddingBlock: 4,
    outline: "none",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 26,
    paddingInline: 12,
    fontSize: 12.5,
    color: tokens.muted,
    cursor: "default",
    userSelect: "none",
  },
  rowFocused: {
    color: tokens.selectedText,
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
  },
  mark: {
    width: 14,
    flexShrink: 0,
    textAlign: "center",
    color: tokens.faint,
    cursor: "pointer",
  },
  markOn: { color: tokens.accent },
  path: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  letter: {
    width: 14,
    flexShrink: 0,
    textAlign: "center",
    fontFamily: tokens.code,
    fontSize: 11,
    color: tokens.warning,
  },
  conflict: { color: tokens.red, fontWeight: 600 },
  empty: { margin: 0, padding: 12, color: tokens.faint, fontSize: 12.5 },
  main: { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
    padding: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  notice: {
    margin: 0,
    maxHeight: 120,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    fontSize: 12,
    color: tokens.faint,
  },
  noticeError: { color: tokens.red, fontFamily: tokens.code, fontSize: 11.5 },
  actions: { display: "flex", gap: 8 },
  action: { flex: "1", minWidth: 0, gap: 6, paddingInline: 10 },
  confirm: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    fontSize: 12.5,
    color: tokens.muted,
  },
  confirmText: { flexBasis: "100%" },
  backdrop: { zIndex: 110 },
  dialog: {
    position: "fixed",
    top: "24vh",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: "min(620px, 92vw)",
    boxSizing: "border-box",
    padding: 16,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    color: tokens.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    zIndex: 111,
    outline: "none",
    fontFamily: tokens.ui,
    animationName: { default: rise, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "180ms",
    animationTimingFunction: tokens.easeOut,
  },
  dialogTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    fontSize: 13.5,
    fontWeight: 550,
  },
  dialogBranch: { color: tokens.muted, fontWeight: 400 },
  message: {
    height: "auto",
    resize: "none",
    paddingBlock: 8,
    fontFamily: tokens.code,
    fontSize: 13,
    lineHeight: 1.5,
  },
  dialogError: {
    margin: 0,
    maxHeight: 200,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    color: tokens.red,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  dialogActions: { display: "flex", alignItems: "center", gap: 8 },
  count: { flex: "1", color: tokens.faint, fontFamily: tokens.code, fontSize: 11.5 },
  countLong: { color: tokens.warning },
  stream: { flex: "1", minHeight: 0, display: "flex", flexDirection: "column" },
  codeView: { flex: "1", minHeight: 0, height: "100%", overflow: "auto", scrollbarWidth: "thin" },
  diffHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
    paddingInlineStart: 10,
    paddingInlineEnd: 14,
    backgroundColor: headerBackground,
    boxShadow: `inset 0 -1px 0 ${tokens.line}, inset 0 1px 0 ${tokens.line}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
  },
  diffHeaderFocused: {
    boxShadow: `inset 2px 0 0 ${tokens.accent}, inset 0 -1px 0 ${tokens.line}, inset 0 1px 0 ${tokens.line}`,
  },
  headerMark: {
    width: 20,
    height: 20,
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.faint,
    fontSize: 12.5,
    cursor: "pointer",
  },
  headerPath: { flexGrow: 0, flexShrink: 1, flexBasis: "auto" },
  // As the file names in Changes: plain text that underlines on hover.
  fileLink: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: "inherit",
    textAlign: "left",
    cursor: "pointer",
    textDecoration: { default: "none", ":hover": "underline" },
    textDecorationColor: tokens.lineStrong,
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  fileName: { fontWeight: 550 },
  part: {
    flexShrink: 0,
    paddingInline: 6,
    borderRadius: `calc(4px * ${tokens.round})`,
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: "17px",
    color: tokens.muted,
    backgroundColor: tokens.fill,
  },
  stats: { display: "flex", gap: 6, flexShrink: 0, fontFamily: tokens.code, fontSize: 11.5 },
  clean: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: "1",
    color: tokens.faint,
    fontSize: 13,
  },
});
