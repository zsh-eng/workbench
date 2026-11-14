import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
  SelectionSide,
} from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReviewFile } from "../../shared/protocol";
import { normalizeDiffMetadataPaths } from "../../shared/hunk/diffPaths";
import { hunkBody, splitPatch, wholeFilePatch, type PatchHunk } from "../../shared/patch-hunks";
import { emptyMetadata, parseReviewPatch, reviewFileMatchesFilter } from "../../shared/review";
import {
  predictStage,
  rowPaths,
  stagedPaths,
  stageState,
  type CommitApi,
  type FileChanges,
  type ShownFile,
  type StageChange,
  type WorkingDiff,
  type WorkingFile,
  type WorkingStatus,
} from "../data/commit";
import { visibleElement } from "../data/palette-focus";
import { useTheme } from "../themes";
import { picked, tokens, ui } from "../theme.stylex";
import { createPatchParser } from "../workers/client";
import { ColumnHandle, useColumnWidth } from "./ColumnResize";
import { diffSurfaceStyle } from "./diff-surface";
import { Icon } from "./Icon";
import { PathLabel } from "./PathLabel";
import { ShortcutKeys } from "./ShortcutKeys";
import { clippedTooltip, ToolButton, tooltip } from "./ToolButton";
import { useWorkspaceShown } from "./Workspaces";
import { HIGHLIGHTER } from "../pierre-theme";

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

/** Each file's change from HEAD to the working files, by path. `object` is
 * the working file's blob as the last read named it: kept metadata can hold
 * an older index line with the same lines. */
interface ParsedDiff {
  id: string;
  files: Map<string, { info: ReviewFile; metadata: FileDiffMetadata | null; object?: string }>;
}
type Part = "staged" | "unstaged";
/** A partly staged file shows its staged and unstaged halves. The file in
 * hunk mode reads them too, for the text of its hunks. */
interface Split {
  key: string;
  staged: FileDiffMetadata | null;
  unstaged: FileDiffMetadata | null;
  /** The two patches as Git wrote them. */
  patches: Pick<FileChanges, Part>;
  /** Names the two patches, for a discard of the whole file. */
  stamp: string;
  /** The staged blob, as the last read named it. */
  stagedObject?: string;
  note: string | null;
}
/** Hunk mode: the file whose hunks the keys move through, and the hunk in
 * focus, by its half and its place there. */
interface HunkFocus {
  path: string;
  part: Part;
  index: number;
}
/** One hunk of the file in hunk mode, and where the stream shows it. */
interface HunkTarget {
  part: Part;
  index: number;
  hunk: PatchHunk;
  /** A new or deleted file: its one hunk is the whole file. */
  whole: boolean;
  entryId: string;
  range: SelectedLineRange;
}
/** A discard that waits for the user's answer: a hunk, or a whole file
 * with the stamp of the changes that the confirmation names. */
type PendingDiscard =
  | { file: WorkingFile; target: HunkTarget }
  | { file: WorkingFile; stamp: string };
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
      object: parsed?.newObjectId,
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

/** How long, in milliseconds, the confirmation's answer keys wait after it
 * opens. */
const ANSWER_DELAY = 400;

const conflicted = (file: WorkingFile) =>
  file.staged === "conflicted" || file.unstaged === "conflicted";

/** A hunk's rows in the unified stream, from its first line to its last. */
function hunkRange(hunk: PatchHunk): SelectedLineRange {
  const kinds = hunkBody(hunk.text)
    .split("\n")
    .map((line) => line[0])
    .filter((kind) => kind === " " || kind === "+" || kind === "-");
  const first: SelectionSide = kinds[0] === "-" ? "deletions" : "additions";
  const last: SelectionSide = kinds.at(-1) === "-" ? "deletions" : "additions";
  return {
    start: first === "deletions" ? hunk.oldStart : hunk.newStart,
    side: first,
    end:
      last === "deletions"
        ? hunk.oldStart + Math.max(0, hunk.oldCount - 1)
        : hunk.newStart + Math.max(0, hunk.newCount - 1),
    endSide: last,
  };
}

// The item with the hunk's keys redraws when they move to another line: one
// version for each metadata and each line.
const barVersions = new WeakMap<FileDiffMetadata, Map<string, number>>();
function versionWithBar(metadata: FileDiffMetadata, line: string) {
  let byLine = barVersions.get(metadata);
  if (!byLine) barVersions.set(metadata, (byLine = new Map()));
  let version = byLine.get(line);
  if (version === undefined) byLine.set(line, (version = ++nextVersion));
  return version;
}

interface DiscardChoice {
  label: string;
  /** The key that answers with this choice in the confirmation. */
  key: string;
  /** Staged changes go too. */
  staged: boolean;
}
/** What a discard takes, in words, and its answers. */
function describeDiscard(pending: PendingDiscard): {
  title: string;
  text: string[];
  choices: DiscardChoice[];
} {
  const { file } = pending;
  if ("target" in pending) {
    const { hunk, part } = pending.target;
    const at = `${file.path}, the hunk at line ${hunk.newCount ? hunk.newStart : hunk.oldStart} (+${hunk.added} −${hunk.removed})`;
    return part === "staged"
      ? {
          title: "Discard this staged hunk?",
          text: [
            `${at}: its lines leave the staged changes and the working file, and go back to the last commit.`,
          ],
          choices: [{ label: "Discard hunk", key: "d", staged: true }],
        }
      : {
          title: "Discard this hunk?",
          text: [
            `${at}: its lines go back to ${file.staged ? "their staged version" : "the last commit"}.`,
          ],
          choices: [{ label: "Discard hunk", key: "d", staged: false }],
        };
  }
  const { path, previousPath, staged, unstaged } = file;
  if (!staged)
    return unstaged === "untracked" || unstaged === "added"
      ? {
          title: `Delete ${path}?`,
          text: [
            unstaged === "added"
              ? "Git has only its name (git add -N), so Med deletes the file."
              : "Git does not track this file, so Med deletes it.",
          ],
          choices: [{ label: "Delete file", key: "d", staged: false }],
        }
      : {
          title: `Discard changes to ${path}?`,
          text: [
            unstaged === "deleted"
              ? "The file comes back as it is in the last commit."
              : "Its changes go, and the file goes back to the last commit.",
          ],
          choices: [{ label: "Discard", key: "d", staged: false }],
        };
  const back =
    staged === "added"
      ? "Med deletes the new file."
      : staged === "renamed" && previousPath
        ? `the rename is undone: ${previousPath} comes back, and ${path} goes.`
        : staged === "deleted"
          ? "the file comes back as it is in the last commit."
          : "the staged changes go too, and the file goes back to the last commit.";
  if (!unstaged)
    return {
      title: `Discard staged changes to ${path}?`,
      text: [`${back[0]!.toUpperCase()}${back.slice(1)}`],
      choices: [{ label: "Discard", key: "d", staged: true }],
    };
  return {
    title: `Discard changes to ${path}?`,
    text: [
      "It has staged and unstaged changes.",
      `Unstaged only: ${unstaged === "untracked" ? "Med deletes the file on disk, and the staged deletion stays." : "the file goes back to its staged version."}`,
      `Discard all: ${back}`,
    ],
    choices: [
      { label: "Unstaged only", key: "u", staged: false },
      { label: "Discard all", key: "d", staged: true },
    ],
  };
}

/**
 * The files that a commit takes, with what the tab shows of each: the blob
 * on its diff's index line, or, for a new file that Git does not track, the
 * SHA-256 of its text. A file that the tab does not show yet, or cannot show,
 * such as a binary one, goes without.
 */
async function shownToCommit(
  rows: readonly WorkingFile[],
  all: boolean,
  diff: ParsedDiff | null,
  splits: ReadonlyMap<string, Split>,
): Promise<ShownFile[]> {
  const hash = async (text: string) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  return (
    await Promise.all(
      rows.map(async (file): Promise<ShownFile[]> => {
        const entry = diff?.files.get(file.path);
        let shown: Omit<ShownFile, "path"> = {};
        // A partly staged file shows its staged half, once it loads.
        if (!all && stageState(file) === "partial") {
          const object = splits.get(file.path)?.stagedObject;
          if (object) shown = { object };
        } else if (entry?.info.untracked) {
          if (all && entry.metadata && crypto.subtle)
            shown = { text: await hash(entry.metadata.additionLines.join("")) };
        } else if (entry?.object) shown = { object: entry.object };
        return [
          { path: file.path, ...shown },
          ...(file.previousPath ? [{ path: file.previousPath }] : []),
        ];
      }),
    )
  ).flat();
}

/**
 * Stage files or hunks, commit them, and push the branch: the part of
 * lazygit that a review needs. The changed files and their diffs are one
 * stream in the same order, so moving through files scrolls. Keys: j/k move,
 * Space stages a file, Enter goes into its hunks (Space stages a hunk, Esc
 * goes back), d discards after a confirmation, a stages all, / filters, c
 * writes the message, Mod+Enter commits, P pushes. A file's stage shows at
 * once; Git's answer follows.
 */
export default function CommitView({
  api,
  revision,
  active,
  draftKey,
  keys = "window",
  onOpenFile,
  stageIn,
}: {
  /** A place in the review's row: Stage all goes there,
   * and the view has no header, as the title band names the branch. Null
   * while the row does not show. */
  stageIn?: HTMLElement | null;
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
  const workspaceShown = useWorkspaceShown();
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
  const [hunkFocus, setHunkFocus] = useState<HunkFocus | null>(null);
  // A hunk's stage or discard that Git has not answered yet.
  const [hunkWrite, setHunkWrite] = useState(false);
  // The discard that the confirmation names; it stays while the dialog closes.
  const [asking, setAsking] = useState<PendingDiscard | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [text, setText] = useState(() => (draftKey ? readDraft(draftKey) : ""));
  const [busy, setBusy] = useState<"commit" | "push" | "discard" | null>(null);
  const [notice, setNotice] = useState<{ tone: "done" | "error"; text: string } | null>(null);
  const [confirmTrack, setConfirmTrack] = useState(false);
  // The message appears only while the user writes it.
  const [composing, setComposing] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelDiscard = useRef<HTMLButtonElement>(null);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const queue = useRef(Promise.resolve());
  // Writes in the queue that Git has not answered.
  const inFlight = useRef(0);
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
  // A file that leaves the list, as after a discard, leaves the focus at its
  // place, as in lazygit.
  const [place, setPlace] = useState(0);
  const found = shown.findIndex((file) => file.path === focused);
  const focusedFile =
    found >= 0 ? shown[found]! : (shown[Math.min(place, shown.length - 1)] ?? null);
  if (found >= 0 && found !== place) setPlace(found);
  // Hunk mode lasts while its file shows.
  const hunkFile = hunkFocus ? (shown.find((file) => file.path === hunkFocus.path) ?? null) : null;
  if (hunkFocus && status && !hunkFile) setHunkFocus(null);
  // The file list's width, as the reader set it with its edge.
  const { measure, width, pane } = useColumnWidth("commit", (pane) => Math.max(240, pane * 0.28));
  const stacked = !!pane && pane <= 720;
  const stagedCount = files.filter((file) => file.staged && file.staged !== "conflicted").length;
  // With nothing staged, a commit takes every change, as `git commit -a`
  // would, unless a conflict needs a choice first.
  const commitAll = !stagedCount && files.length > 0 && !files.some(conflicted);
  const commitCount = stagedCount || (commitAll ? files.length : 0);

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
        ? (parser.current ??= createPatchParser({ shown: true })).parse(patch)
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

  // A partly staged file reads its two halves, and so does the file in hunk
  // mode, for its hunks' text. Other files use the stream's diff.
  const splitKey = `${server?.indexKey}\0${diff?.id}`;
  const halved = useMemo(
    () => files.filter((file) => stageState(file) === "partial" || file.path === hunkFocus?.path),
    [files, hunkFocus?.path],
  );
  useEffect(() => {
    const missing = halved.filter((file) => splits.get(file.path)?.key !== splitKey);
    if (!active || !server || !missing.length) return;
    const abort = new AbortController();
    Promise.all(
      missing.map(async (file): Promise<[string, Split]> => {
        const halves = await api.changes(file, abort.signal);
        const before = splits.get(file.path);
        // An unchanged half keeps its metadata, so the stream does not redraw it.
        const parse = (patch: string) => (patch ? (parseReviewPatch(patch)[0] ?? null) : null);
        const half = (
          metadata: FileDiffMetadata | null,
          previous: FileDiffMetadata | null | undefined,
        ) =>
          metadata && previous && fingerprint(previous) === fingerprint(metadata)
            ? previous
            : metadata;
        const staged = parse(halves.staged);
        return [
          file.path,
          {
            key: splitKey,
            staged: half(staged, before?.staged),
            stagedObject: staged?.newObjectId,
            unstaged: half(parse(halves.unstaged), before?.unstaged),
            patches: { staged: halves.staged, unstaged: halves.unstaged },
            stamp: halves.stamp,
            note: halves.binary ? "Binary file" : halves.tooLarge ? "Too large to show" : null,
          },
        ];
      }),
    ).then(
      (loaded) => {
        if (!abort.signal.aborted) setSplits((current) => new Map([...current, ...loaded]));
      },
      (error) => {
        // The stream keeps the file's whole change until the halves load.
        if (
          !abort.signal.aborted &&
          !aborted(error) &&
          missing.some((file) => file.path === hunkFocus?.path)
        )
          setNotice({ tone: "error", text: message(error) });
      },
    );
    return () => abort.abort();
  }, [active, api, halved, hunkFocus?.path, server, splitKey, splits]);

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
    (kind: "commit" | "push" | "discard" | null, work: () => Promise<string | void>) => {
      inFlight.current += 1;
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
          inFlight.current -= 1;
        }
      });
      return queue.current;
    },
    [readStatus],
  );
  /** A write whose answer is the new status. Status reads that overlap it
   * do not replace that answer. `settle` runs with the answer, in the same
   * render, so the view never shows the status from before the write. */
  const write = useCallback(
    (
      kind: "discard" | null,
      work: () => Promise<WorkingStatus>,
      settle?: () => void,
      after?: () => Promise<string>,
    ) => {
      writes.current += 1;
      return run(kind, async () => {
        try {
          accept(await work());
        } finally {
          settle?.();
          writes.current += 1;
        }
        return after?.();
      });
    },
    [accept, run],
  );
  const stage = useCallback(
    (paths: string[] | null, value: boolean) => {
      const change: StageChange = { paths: paths && new Set(paths), stage: value };
      setPending((current) => [...current, change]);
      return write(
        null,
        () => api.stage(paths, value),
        () => setPending((current) => current.filter((entry) => entry !== change)),
      );
    },
    [api, write],
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
    if (!commitCount) return;
    setCommitError(null);
    setComposing(true);
  }, [commitCount]);
  const { summary, body } = splitMessage(text);
  const commit = useCallback(() => {
    if (!status || !splitMessage(text).summary.trim() || !commitCount) return;
    const written = text;
    const all = commitAll;
    // The files that the dialog counts. The commit holds these, or it stops.
    const counted = (all ? files.flatMap(rowPaths) : stagedPaths(status)).toSorted();
    setCommitError(null);
    // What the tab shows of each counted file, as it shows it now.
    const shownFiles = shownToCommit(
      all ? files : files.filter((file) => file.staged && file.staged !== "conflicted"),
      all,
      diff,
      splits,
    );
    return run("commit", async () => {
      try {
        // Queued stages have finished. A stage that failed, or a change that
        // Git reported since, stops the commit. Commit all stages on the
        // host, in a copy of the index.
        if (!all && stagedPaths(latest.current!).join("\0") !== counted.join("\0"))
          throw new Error(
            "The staged files changed since you pressed Commit. Check them, then commit again.",
          );
        const result = await api.commit({
          message: written,
          indexKey: latest.current!.indexKey,
          files: await shownFiles,
          ...(all ? { all } : {}),
        });
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
  }, [api, commitAll, commitCount, diff, files, readDiff, readStatus, run, splits, status, text]);
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
        // Halves read for an older index stay until the new ones load, but
        // not halves read before the file was partly staged.
        const split = stageState(file) === "partial" ? splits.get(file.path) : undefined;
        if (split && (split.key === splitKey || (split.staged && split.unstaged)))
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
    [diff, shown, splitKey, splits],
  );

  // Hunk mode: the hunks of its file, in stream order, from the patches Git
  // wrote, so that a stage or discard names one by its text.
  const hunkTargets = useMemo<HunkTarget[]>(() => {
    const split = hunkFile && splits.get(hunkFile.path);
    if (!hunkFile || !split) return [];
    const halves = entries.some((entry) => entry.id === `s:${hunkFile.path}`);
    return (["staged", "unstaged"] as const).flatMap((part) => {
      const { header, hunks } = splitPatch(split.patches[part]);
      return hunks.map((hunk, index) => ({
        part,
        index,
        hunk,
        whole: wholeFilePatch(header),
        entryId: halves
          ? `${part === "staged" ? "s" : "u"}:${hunkFile.path}`
          : `f:${hunkFile.path}`,
        range: hunkRange(hunk),
      }));
    });
  }, [entries, hunkFile, splits]);
  // A hunk that left its half takes the focus to the next one there, or to
  // the nearest in the other half.
  const focusedHunk = useMemo(() => {
    if (!hunkFocus || !hunkTargets.length) return null;
    const same = hunkTargets.filter((target) => target.part === hunkFocus.part);
    if (same.length) return same[Math.min(hunkFocus.index, same.length - 1)]!;
    return hunkFocus.part === "unstaged" ? hunkTargets.at(-1)! : hunkTargets[0]!;
  }, [hunkFocus, hunkTargets]);
  // Keys act on hunks as Git has them now, not before the last write.
  const hunksReady = !!hunkFile && !hunkWrite && splits.get(hunkFile.path)?.key === splitKey;
  const moveHunk = useCallback(
    (step: number) => {
      if (!hunkFile || !hunkTargets.length) return;
      const at = focusedHunk ? hunkTargets.indexOf(focusedHunk) : -1;
      const next = hunkTargets[Math.max(0, Math.min(hunkTargets.length - 1, at + step))]!;
      setHunkFocus({ path: hunkFile.path, part: next.part, index: next.index });
    },
    [focusedHunk, hunkFile, hunkTargets],
  );
  const enterHunks = useCallback(
    (file: WorkingFile) => {
      const entry = diff?.files.get(file.path);
      const flat = conflicted(file)
        ? "A file with a conflict has no hunks to stage. Resolve it, then stage it whole."
        : entry?.info.binary || entry?.info.tooLarge || splits.get(file.path)?.note
          ? `${file.path} has no text hunks. Space stages it whole.`
          : null;
      if (flat) {
        setNotice({ tone: "done", text: flat });
        return;
      }
      setNotice(null);
      setHunkFocus({ path: file.path, part: file.unstaged ? "unstaged" : "staged", index: 0 });
    },
    [diff, splits],
  );
  /** Stage or unstage a hunk. The next key waits for Git's answer and the
   * hunks it leaves. */
  const toggleHunk = useCallback(
    (file: WorkingFile, target: HunkTarget) => {
      setHunkWrite(true);
      return write(
        null,
        // A new or deleted file stages whole, by its paths: its one hunk can
        // be larger than a hunk request takes.
        () =>
          target.whole
            ? api.stage(rowPaths(file), target.part === "unstaged")
            : api.stageHunk(file, target.hunk.text, target.part === "unstaged"),
        () => setHunkWrite(false),
      );
    },
    [api, write],
  );
  // When the confirmation opened: its answer keys wait a moment, so that a
  // quick "dd" does not answer it unread.
  const askedAt = useRef(0);
  const openAsk = useCallback((pending: PendingDiscard) => {
    askedAt.current = performance.now();
    setAsking(pending);
    setAskOpen(true);
  }, []);
  /** d: ask before a discard, with what the tab shows of the hunk or file. */
  const askDiscard = useCallback(async () => {
    if (hunkFile && !hunksReady) return;
    if (hunkFile && focusedHunk && !focusedHunk.whole) {
      openAsk({ file: hunkFile, target: focusedHunk });
      return;
    }
    let file: WorkingFile | null | undefined = hunkFile ?? focusedFile;
    if (!file) return;
    const split = splits.get(file.path);
    let fresh = split?.key === splitKey;
    // A stage that Git has not answered changes what a discard takes: ask
    // about the file as Git has it after the stage.
    if (inFlight.current) {
      await queue.current;
      const { path } = file;
      file = latest.current?.files.find((entry) => entry.path === path);
      if (!file) return;
      fresh = false;
    }
    if (conflicted(file)) {
      setNotice({ tone: "error", text: "Resolve the conflict in this file first." });
      return;
    }
    try {
      openAsk({ file, stamp: fresh && split ? split.stamp : (await api.changes(file)).stamp });
    } catch (error) {
      setNotice({ tone: "error", text: message(error) });
    }
  }, [api, focusedFile, focusedHunk, hunkFile, hunksReady, openAsk, splitKey, splits]);
  const discard = useCallback(
    (asked: PendingDiscard, staged: boolean) => {
      setAskOpen(false);
      const hunk = "target" in asked;
      // The hunk keys wait for the new diff too: the working file changed.
      if (hunk) setHunkWrite(true);
      return write(
        "discard",
        () =>
          api.discard(
            asked.file,
            hunk ? { staged, hunk: asked.target.hunk.text } : { staged, stamp: asked.stamp },
          ),
        undefined,
        async () => {
          await readDiff();
          return hunk ? `Discarded a hunk of ${asked.file.path}` : `Discarded ${asked.file.path}`;
        },
      ).finally(() => hunk && setHunkWrite(false));
    },
    [api, readDiff, write],
  );

  const items = useMemo<CodeViewItem<undefined>[]>(
    () =>
      entries.map((entry) => {
        const fileDiff = entry.metadata ?? placeholder(diff ?? loading, entry.file);
        // The focused hunk's keys follow its last line.
        const bar: DiffLineAnnotation | null =
          focusedHunk?.entryId === entry.id && entry.metadata
            ? { side: focusedHunk.range.endSide!, lineNumber: focusedHunk.range.end }
            : null;
        return {
          id: entry.id,
          type: "diff" as const,
          fileDiff,
          version: bar
            ? versionWithBar(fileDiff, `${bar.side}:${bar.lineNumber}`)
            : versionOf(fileDiff),
          collapsed: !entry.metadata?.hunks.length,
          ...(bar ? { annotations: [bar] } : {}),
        };
      }),
    [diff, entries, focusedHunk],
  );
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  // The focused hunk is selected and sits in the middle of the stream.
  const selectedLines = useMemo(
    () => (focusedHunk ? { id: focusedHunk.entryId, range: focusedHunk.range } : null),
    [focusedHunk],
  );
  // Only a new hunk scrolls: a status read leaves the stream where it is.
  const scrolledTo = useRef("");
  useEffect(() => {
    const key = selectedLines ? JSON.stringify(selectedLines) : "";
    if (key === scrolledTo.current) return;
    scrolledTo.current = key;
    if (!selectedLines) return;
    following.current = true;
    viewer.current?.scrollTo({ type: "range", ...selectedLines, align: "center" });
  }, [selectedLines]);

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
  const open = useCallback(
    (file: WorkingFile | null) => file && onDisk(file) && onOpenFile?.(file.path, false),
    [onOpenFile],
  );

  // The lazygit keys, while this view is on screen and no field has focus.
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !workspaceShown()) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (keys === "view" && !root.current?.contains(target)) return;
      const typing =
        !!target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      // A key from a dialog, such as the Esc that closes it, stays there.
      if (typing || visibleElement('[role="dialog"]') || target?.closest('[role="dialog"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        compose();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Escape leaves the hunks; outside them, as in a search, it clears the
      // filter.
      if (event.key === "Escape") {
        if (hunkFile || filter) {
          event.preventDefault();
          if (hunkFile) setHunkFocus(null);
          else setFilter("");
        }
        return;
      }
      const both: Record<string, () => void> = {
        a: () => void toggleShown(),
        "/": () => search.current?.focus(),
        c: compose,
        d: () => void askDiscard(),
        o: () => open(hunkFile ?? focusedFile),
        P: () => void push(),
      };
      const bindings: Record<string, () => void> = hunkFile
        ? {
            ...both,
            j: () => moveHunk(1),
            ArrowDown: () => moveHunk(1),
            k: () => moveHunk(-1),
            ArrowUp: () => moveHunk(-1),
            " ": () => hunksReady && focusedHunk && void toggleHunk(hunkFile, focusedHunk),
          }
        : {
            ...both,
            j: () => move(1),
            ArrowDown: () => move(1),
            k: () => move(-1),
            ArrowUp: () => move(-1),
            " ": () => focusedFile && void toggle(focusedFile),
            Enter: () => focusedFile && enterHunks(focusedFile),
          };
      // Shift with a letter is its capital, whatever the key event reports.
      const name = event.shiftKey && event.key.length === 1 ? event.key.toUpperCase() : event.key;
      const action = bindings[name];
      if (!action) return;
      // Enter or Space on a focused button or link presses it.
      if (
        (name === "Enter" || name === " ") &&
        target?.closest("button, a, [role='button'], [role='link']")
      )
        return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    active,
    askDiscard,
    compose,
    enterHunks,
    filter,
    focusedFile,
    focusedHunk,
    hunkFile,
    hunksReady,
    keys,
    move,
    moveHunk,
    open,
    push,
    toggle,
    toggleHunk,
    toggleShown,
    workspaceShown,
  ]);

  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(
    () => ({
      theme: theme.pierreTheme,
      preferredHighlighter: HIGHLIGHTER,
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
  const ahead = status?.ahead ?? 0;
  const canPush =
    busy === null && !!status?.head && !!status.branch && (!status.upstream || ahead > 0);
  const pushTip = !pushLabel
    ? "No remote to push to"
    : !status?.upstream
      ? `Push to ${pushLabel} and track it`
      : ahead
        ? `Push ${ahead} ${ahead === 1 ? "commit" : "commits"} to ${pushLabel}`
        : `Nothing to push: ${pushLabel} has every commit`;
  const commitTip = commitAll
    ? `Commit all ${commitCount} ${commitCount === 1 ? "file" : "files"}`
    : commitCount
      ? `Commit ${commitCount} staged ${commitCount === 1 ? "file" : "files"}`
      : "Nothing to commit";
  const bodyRows = Math.min(14, Math.max(4, body.split("\n").length + 1));
  const summaryLength = summary.trim().length;
  const inRow = stageIn !== undefined;
  const asked = asking && describeDiscard(asking);
  const hunkPlace = focusedHunk ? hunkTargets.indexOf(focusedHunk) + 1 : 0;
  const stageButton = (
    <button
      type="button"
      disabled={!shown.length}
      onClick={() => void toggleShown()}
      title="Stage or unstage every file shown (a)"
      {...stylex.props(ui.button, inRow ? ui.pressable : styles.small)}
    >
      {`${stageShown ? "Stage" : "Unstage"} ${filter ? `${shown.length} shown` : "all"}`}
    </button>
  );
  return (
    <div ref={root} {...stylex.props(styles.root)}>
      {stageIn && createPortal(stageButton, stageIn)}
      <div {...stylex.props(styles.layout, styles.listWidth(width))}>
        <div ref={measure} {...stylex.props(styles.side)}>
          {!inRow && (
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
              {stageButton}
            </header>
          )}
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
              const kind = change(file);
              const current = file === focusedFile;
              return (
                // The listbox takes the keys and names the focused row.
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  key={file.path}
                  id={rowId(file.path)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={current}
                  aria-label={`${file.path}, ${marks[state].label}${kind ? `, ${kind}` : ""}`}
                  {...clippedTooltip(
                    file.previousPath ? `${file.previousPath} → ${file.path}` : file.path,
                  )}
                  onClick={() => {
                    setHunkFocus(null);
                    select(file.path, true);
                    list.current?.focus({ preventScroll: true });
                  }}
                  onDoubleClick={() => void toggle(file)}
                  {...stylex.props(
                    styles.row,
                    current && (hunkFile ? styles.rowInHunks : [styles.rowFocused, picked]),
                  )}
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
                    <PathLabel path={file.path} />
                  </span>
                  {current && hunkFile && hunkPlace > 0 && (
                    <span {...stylex.props(styles.hunkCount)}>
                      {hunkPlace}/{hunkTargets.length}
                    </span>
                  )}
                  {kind && <ChangeLetter kind={kind} />}
                </div>
              );
            })}
          </div>
          <footer {...stylex.props(styles.footer)}>
            {notice && (
              <p
                role={notice.tone === "error" ? "alert" : "status"}
                {...stylex.props(styles.notice, notice.tone === "error" && styles.noticeError)}
              >
                {notice.text}
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
              // One quiet row: where the keys are, then commit and push as
              // icons whose tooltips name their keys.
              <div {...stylex.props(styles.actions)}>
                <span {...stylex.props(styles.state)}>
                  {hunkFile
                    ? !hunksReady
                      ? "Reading hunks…"
                      : focusedHunk
                        ? `Hunk ${hunkPlace} of ${hunkTargets.length}, ${focusedHunk.part === "staged" ? "staged" : "not staged"}`
                        : "No hunks to stage"
                    : stagedCount
                      ? `${stagedCount} of ${files.length} staged`
                      : "Nothing staged"}
                </span>
                <ToolButton
                  icon="commit"
                  label={commitTip}
                  shortcut="c"
                  busy={busy === "commit"}
                  disabled={busy !== null || !commitCount}
                  onClick={compose}
                />
                <button
                  type="button"
                  aria-label={pushTip}
                  disabled={!canPush}
                  onClick={() => void push()}
                  {...tooltip(pushTip, "Shift+P")}
                  {...stylex.props(ui.button, ui.pressable, styles.push)}
                >
                  <span {...stylex.props(busy === "push" && styles.spinning)}>
                    <Icon name="push" size={15} />
                  </span>
                  {ahead > 0 && <span {...stylex.props(styles.ahead)}>{ahead}</span>}
                  {/* Without the header, the arrow also says how far the upstream is ahead. */}
                  {inRow && !!status?.behind && (
                    <span {...stylex.props(ui.faint)}>↓{status.behind}</span>
                  )}
                </button>
              </div>
            )}
          </footer>
          {/* A narrow view stacks the list above the diff. */}
          {!stacked && (
            <ColumnHandle kind="commit" width={width} pane={pane} label="the file list" />
          )}
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
                selectedLines={selectedLines}
                className={stylex.props(styles.codeView).className}
                style={diffSurfaceStyle}
                // The file at the top of the stream is the file in focus,
                // except in hunk mode, where the hunk leads.
                onScroll={(top, view) => {
                  if (following.current || hunkFile) return;
                  let current: string | null = null;
                  for (const entry of entries) {
                    const itemTop = view.getTopForItem(entry.id);
                    if (itemTop === undefined) continue;
                    if (itemTop > top + 4) break;
                    current = entry.file.path;
                  }
                  if (current && current !== focusedFile?.path) setFocused(current);
                }}
                renderAnnotation={() =>
                  hunkFile && focusedHunk ? (
                    // A click keeps the focus in the list, where the keys are.
                    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus
                    <div
                      role="toolbar"
                      aria-label="Hunk"
                      onMouseDown={(event) => event.preventDefault()}
                      {...stylex.props(styles.hunkBar)}
                    >
                      <button
                        type="button"
                        disabled={!hunksReady}
                        onClick={() => void toggleHunk(hunkFile, focusedHunk)}
                        {...stylex.props(styles.hunkKey)}
                      >
                        <ShortcutKeys value="Space" />
                        {focusedHunk.part === "staged" ? "unstage" : "stage"}
                      </button>
                      <button
                        type="button"
                        disabled={!hunksReady}
                        onClick={() => void askDiscard()}
                        {...stylex.props(styles.hunkKey)}
                      >
                        <ShortcutKeys value="d" />
                        discard
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setHunkFocus(null);
                          list.current?.focus({ preventScroll: true });
                        }}
                        {...stylex.props(styles.hunkKey)}
                      >
                        <ShortcutKeys value="Esc" />
                        files
                      </button>
                    </div>
                  ) : null
                }
                renderCustomHeader={(item) => {
                  const entry = entryById.get(item.id);
                  if (!entry) return null;
                  const state = stageState(entry.file);
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
                          {/* A long name gives way, its folders first, in a narrow pane. */}
                          <PathLabel path={entry.file.path} strong />
                        </button>
                      ) : (
                        <span {...stylex.props(styles.path, styles.headerPath)}>
                          <PathLabel path={entry.file.path} strong />
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
          <Dialog.Popup
            initialFocus={field}
            finalFocus={list}
            {...stylex.props(styles.dialog, styles.commitDialog)}
          >
            <header {...stylex.props(styles.dialogHead)}>
              <Dialog.Title {...stylex.props(styles.dialogTitle)}>
                {commitAll ? "Commit all" : "Commit"} {commitCount}{" "}
                {commitCount === 1 ? "file" : "files"}
              </Dialog.Title>
              {status?.branch && (
                <span {...stylex.props(styles.dialogBranch)}>
                  <Icon name="branch" size={13} />
                  {status.branch}
                </span>
              )}
            </header>
            {commitAll && (
              <p {...stylex.props(styles.dialogNote)}>
                Nothing is staged, so the commit takes every change.
              </p>
            )}
            <div {...stylex.props(styles.composer)}>
              <div {...stylex.props(styles.summaryRow)}>
                <input
                  ref={field}
                  aria-label="Commit summary"
                  placeholder="Summary"
                  value={summary}
                  spellCheck
                  autoComplete="off"
                  onChange={(event) => setText(joinMessage(event.target.value, body))}
                  onPaste={(event) => {
                    // A whole message pasted into an empty summary fills both fields.
                    const pasted = event.clipboardData.getData("text/plain");
                    if (!pasted.includes("\n") || summary || body) return;
                    event.preventDefault();
                    setText(joinMessage(splitMessage(pasted).summary, splitMessage(pasted).body));
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void commit();
                    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      bodyField.current?.focus();
                    }
                  }}
                  {...stylex.props(styles.summary)}
                />
                {summaryLength > 50 && (
                  <span
                    title="Characters in the summary. Git tools cut summaries after 72."
                    {...stylex.props(styles.count, summaryLength > 72 && styles.countLong)}
                  >
                    {summaryLength}
                  </span>
                )}
              </div>
              <textarea
                ref={bodyField}
                aria-label="Commit description"
                placeholder="Description"
                value={body}
                rows={bodyRows}
                spellCheck
                onChange={(event) => setText(joinMessage(summary, event.target.value))}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void commit();
                  } else if (
                    event.key === "Backspace" &&
                    !body &&
                    event.currentTarget.selectionStart === 0
                  ) {
                    event.preventDefault();
                    field.current?.focus();
                  }
                }}
                {...stylex.props(styles.body)}
              />
              {/* As in the session's message box: the keys, then one round
                  button that sends. */}
              <div {...stylex.props(styles.composerFoot)}>
                <span {...stylex.props(styles.composerHint)}>
                  <ShortcutKeys value="Esc" /> keeps a draft
                </span>
                <span {...stylex.props(ui.grow)} />
                <ShortcutKeys value="Mod+Enter" />
                <button
                  type="button"
                  aria-label={busy === "commit" ? "Committing" : "Commit"}
                  disabled={busy !== null || !commitCount || !summary.trim()}
                  onClick={() => void commit()}
                  {...tooltip(commitTip, "Mod+Enter")}
                  {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.send)}
                >
                  <span {...stylex.props(busy === "commit" && styles.spinning)}>
                    <Icon name="commit" size={14} />
                  </span>
                </button>
              </div>
            </div>
            {commitError && (
              <p role="alert" {...stylex.props(styles.dialogError)}>
                {commitError}
              </p>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={askOpen} onOpenChange={setAskOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop)} />
          <Dialog.Popup
            initialFocus={cancelDiscard}
            finalFocus={list}
            onKeyDown={(event) => {
              // A choice's key answers with it; Enter presses the focused
              // button, which is Cancel at first.
              const choice =
                askOpen &&
                performance.now() - askedAt.current >= ANSWER_DELAY &&
                !event.repeat &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                asked?.choices.find((entry) => entry.key === event.key);
              if (!choice || !asking) return;
              event.preventDefault();
              void discard(asking, choice.staged);
            }}
            {...stylex.props(styles.dialog, styles.confirmDialog)}
          >
            {asked && (
              <>
                <Dialog.Title {...stylex.props(styles.confirmTitle)}>
                  <Icon name="trash" size={14} />
                  {asked.title}
                </Dialog.Title>
                <Dialog.Description render={<div />} {...stylex.props(styles.confirmBody)}>
                  {asked.text.map((line) => (
                    <p key={line} {...stylex.props(styles.confirmLine)}>
                      {line}
                    </p>
                  ))}
                  <p {...stylex.props(styles.confirmLine, styles.confirmWarning)}>
                    You cannot undo this.
                  </p>
                </Dialog.Description>
                <div {...stylex.props(styles.dialogActions)}>
                  <Dialog.Close ref={cancelDiscard} {...stylex.props(ui.button, styles.answer)}>
                    Cancel
                    <ShortcutKeys value="Esc" />
                  </Dialog.Close>
                  {asked.choices.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      onClick={() => asking && void discard(asking, choice.staged)}
                      {...stylex.props(ui.button, styles.answer, styles.danger)}
                    >
                      {choice.label}
                      <ShortcutKeys value={choice.key} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

const rowId = (path: string) => `commit-row-${encodeURIComponent(path)}`;

/** A commit message as its two fields: the summary line, and the description
 * after the blank line. */
function splitMessage(text: string) {
  const cut = text.indexOf("\n");
  return cut < 0
    ? { summary: text, body: "" }
    : { summary: text.slice(0, cut), body: text.slice(cut + 1).replace(/^\n/, "") };
}
const joinMessage = (summary: string, body: string) => (body ? `${summary}\n\n${body}` : summary);

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
const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
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
      default: "var(--med-commit-list) minmax(0, 1fr)",
      [narrow]: "minmax(0, 1fr)",
    },
    gridTemplateRows: { default: "minmax(0, 1fr)", [narrow]: "minmax(0, 34%) minmax(0, 1fr)" },
    height: "100%",
    minHeight: 0,
  },
  listWidth: (width: number) => ({ "--med-commit-list": `${width}px` }),
  side: {
    position: "relative",
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
  // In hunk mode the keys are in the diff; the row keeps a quieter mark.
  rowInHunks: {
    color: tokens.text,
    backgroundColor: tokens.fill,
    boxShadow: `inset 2px 0 0 ${tokens.accent}`,
  },
  hunkCount: {
    flexShrink: 0,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  mark: {
    width: 14,
    flexShrink: 0,
    textAlign: "center",
    color: tokens.faint,
    cursor: "pointer",
  },
  markOn: { color: tokens.accent },
  path: { display: "flex", flex: "1", minWidth: 0 },
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
    gap: 6,
    flexShrink: 0,
    paddingBlock: 6,
    paddingInlineStart: 12,
    paddingInlineEnd: 6,
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
  actions: { display: "flex", alignItems: "center", gap: 2, minHeight: 28 },
  state: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 12,
  },
  // The push arrow, and how many commits it would push.
  push: {
    gap: 4,
    height: 28,
    minWidth: 28,
    paddingInline: 6,
    color: tokens.muted,
    fontSize: 12,
  },
  ahead: { fontFamily: tokens.code, fontSize: 11.5, fontVariantNumeric: "tabular-nums" },
  spinning: {
    display: "inline-flex",
    animationName: { default: spin, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "800ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
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
    top: "22vh",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column",
    width: "min(560px, 92vw)",
    boxSizing: "border-box",
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.menu,
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
  dialogHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingTop: 16,
    paddingBottom: 12,
    paddingInline: 18,
  },
  dialogTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
  dialogBranch: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
    color: tokens.muted,
    fontSize: 12.5,
  },
  dialogNote: {
    marginTop: -4,
    marginBottom: 12,
    marginInline: 18,
    color: tokens.muted,
    fontSize: 12,
  },
  // One surface for the summary and the description, as one message.
  composer: {
    marginInline: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.line, ":focus-within": tokens.accentLine },
    borderRadius: `calc(9px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: { default: "none", ":focus-within": `0 0 0 3px ${tokens.accentSoft}` },
    overflow: "hidden",
  },
  summaryRow: {
    display: "flex",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  summary: {
    flex: "1",
    minWidth: 0,
    height: 42,
    paddingInline: 12,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 14,
    fontWeight: 500,
    "::placeholder": { color: tokens.faint, fontWeight: 400 },
  },
  body: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    paddingTop: 10,
    paddingBottom: 12,
    paddingInline: 12,
    borderWidth: 0,
    outline: "none",
    resize: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    lineHeight: 1.55,
    "::placeholder": { color: tokens.faint },
  },
  dialogError: {
    marginTop: 10,
    marginBottom: 0,
    marginInline: 14,
    maxHeight: 200,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    color: tokens.red,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  // Under the description, inside the message's surface.
  composerFoot: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBottom: 8,
    paddingInline: 10,
    color: tokens.faint,
  },
  composerHint: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5 },
  // As the session's Send: a round button in the primary colour.
  send: {
    width: 26,
    minWidth: 26,
    minHeight: 26,
    borderRadius: 999,
    color: { default: tokens.primaryText, ":hover:not(:disabled)": tokens.primaryText },
    backgroundColor: {
      default: tokens.primary,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.primary} 86%, ${tokens.canvas})`,
    },
  },
  dialogActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    padding: 14,
  },
  commitDialog: { paddingBottom: 14 },
  confirmDialog: { width: "min(460px, 92vw)" },
  confirmTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    paddingTop: 16,
    paddingInline: 18,
    fontSize: 14,
    fontWeight: 600,
    overflowWrap: "anywhere",
  },
  confirmBody: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingTop: 10,
    paddingInline: 18,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  confirmLine: { margin: 0, overflowWrap: "anywhere" },
  confirmWarning: { color: tokens.text, fontWeight: 500 },
  answer: { gap: 8, paddingInline: 12 },
  danger: {
    color: { default: tokens.red, ":hover:not(:disabled)": tokens.red },
    borderColor: `color-mix(in srgb, ${tokens.red} 40%, transparent)`,
  },
  count: {
    flexShrink: 0,
    paddingInlineEnd: 12,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
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
  // The focused hunk's keys, under its last line: each one also a button.
  hunkBar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    paddingBlock: 4,
    paddingInline: 10,
    backgroundColor: headerBackground,
    boxShadow: `inset 2px 0 0 ${tokens.accent}`,
    fontFamily: tokens.ui,
    fontSize: 11.5,
  },
  hunkKey: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 22,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": tokens.fill },
    color: { default: tokens.muted, ":disabled": tokens.faint },
    fontFamily: tokens.ui,
    fontSize: "inherit",
    cursor: { default: "pointer", ":disabled": "default" },
  },
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
