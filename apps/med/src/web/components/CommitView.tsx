import * as stylex from "@stylexjs/stylex";
import { FileDiff, type FileDiffOptions } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseReviewPatch } from "../../shared/review";
import {
  rowPaths,
  stageState,
  type CommitApi,
  type FileChanges,
  type WorkingFile,
  type WorkingStatus,
} from "../data/commit";
import { visibleElement } from "../data/palette-focus";
import { useTheme } from "../themes";
import { tokens, ui } from "../theme.stylex";
import { diffSurfaceStyle } from "./diff-surface";
import { Icon } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";

const letters: Record<NonNullable<WorkingFile["staged"]>, string> = {
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
const short = (id: string) => id.slice(0, 7);

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

/**
 * Stage files, commit them, and push the branch: the part of lazygit that a
 * review needs. Keys: j/k move, Space stages a file, a stages all, c writes
 * the message, Mod+Enter commits, P pushes.
 */
export default function CommitView({
  api,
  revision,
  active,
  draftKey,
  keys = "window",
}: {
  api: CommitApi;
  /** Changes when the checkout changes; the view reads its status again. */
  revision: number;
  active: boolean;
  /** Keeps an unsent message across reloads. */
  draftKey?: string;
  /** "view" takes keys only while focus is inside, as on the elements page. */
  keys?: "window" | "view";
}) {
  const { active: theme } = useTheme();
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [text, setText] = useState(() => (draftKey ? readDraft(draftKey) : ""));
  const [busy, setBusy] = useState<"stage" | "commit" | "push" | null>(null);
  const [notice, setNotice] = useState<{ tone: "done" | "error"; text: string } | null>(null);
  const [confirmTrack, setConfirmTrack] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const queue = useRef(Promise.resolve());

  const files = useMemo(() => status?.files ?? [], [status]);
  const focusedFile = files.find((file) => file.path === focused) ?? files[0] ?? null;
  const stagedCount = files.filter((file) => file.staged && file.staged !== "conflicted").length;

  // The checkout's state, read again when it changes. The last state stays on
  // screen while the next one loads.
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await api.status(signal);
        setStatus(next);
        setLoadError(null);
      } catch (error) {
        if (!signal?.aborted) setLoadError(message(error));
      }
    },
    [api],
  );
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    api.status(abort.signal).then(
      (next) => {
        setStatus(next);
        setLoadError(null);
      },
      (error) => {
        if (!abort.signal.aborted) setLoadError(message(error));
      },
    );
    return () => abort.abort();
  }, [active, revision, api]);
  useEffect(() => {
    if (draftKey) writeDraft(draftKey, text);
  }, [draftKey, text]);
  useEffect(() => {
    if (active && keys === "window") list.current?.focus({ preventScroll: true });
  }, [active, keys]);
  useEffect(() => {
    if (confirmTrack) confirmButton.current?.focus();
  }, [confirmTrack]);

  /** Runs writes one at a time, so quick keys stage in order. */
  const run = useCallback(
    (kind: "stage" | "commit" | "push", work: () => Promise<string | void>) => {
      queue.current = queue.current.then(async () => {
        setBusy(kind);
        try {
          const done = await work();
          setNotice(done ? { tone: "done", text: done } : null);
        } catch (error) {
          setNotice({ tone: "error", text: message(error) });
          await load();
        } finally {
          setBusy(null);
        }
      });
      return queue.current;
    },
    [load],
  );
  const toggle = useCallback(
    (file: WorkingFile) =>
      run("stage", async () => {
        setStatus(await api.stage(rowPaths(file), stageState(file) !== "staged"));
      }),
    [api, run],
  );
  const toggleAll = useCallback(() => {
    const stage = files.some((file) => file.unstaged);
    return run("stage", async () => {
      setStatus(await api.stage(null, stage));
    });
  }, [api, files, run]);
  const commit = useCallback(() => {
    if (!status || !text.trim() || !stagedCount) return;
    const key = status.indexKey;
    return run("commit", async () => {
      const result = await api.commit(text, key);
      setText("");
      await load();
      list.current?.focus({ preventScroll: true });
      return `Committed ${short(result.head)} ${result.summary}`;
    });
  }, [api, load, run, stagedCount, status, text]);
  const push = useCallback(
    (track = false) => {
      if (!status?.head || !status.branch) return;
      if (!status.upstream && !track) {
        if (status.pushRemote) setConfirmTrack(true);
        else setNotice({ tone: "error", text: "Add a remote to push this branch." });
        return;
      }
      setConfirmTrack(false);
      const head = status.head;
      return run("push", async () => {
        const result = await api.push(head, track);
        await load();
        return `Pushed ${short(result.head)} to ${result.remote}/${result.branch}`;
      });
    },
    [api, load, run, status],
  );

  const move = useCallback(
    (step: number) => {
      if (!files.length) return;
      const index = Math.max(
        0,
        files.findIndex((file) => file.path === focusedFile?.path),
      );
      const next = files[Math.min(files.length - 1, Math.max(0, index + step))]!;
      setFocused(next.path);
      document
        .getElementById(rowId(next.path))
        ?.scrollIntoView({ block: "nearest", behavior: "instant" });
    },
    [files, focusedFile],
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
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        if (typing && target !== field.current) return;
        event.preventDefault();
        void commit();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (visibleElement('[role="dialog"]')) return;
      const bindings: Record<string, () => void> = {
        j: () => move(1),
        ArrowDown: () => move(1),
        k: () => move(-1),
        ArrowUp: () => move(-1),
        " ": () => focusedFile && void toggle(focusedFile),
        a: () => void toggleAll(),
        c: () => field.current?.focus(),
        P: () => void push(),
      };
      // Shift with a letter is its capital, whatever the key event reports.
      const name = event.shiftKey && event.key.length === 1 ? event.key.toUpperCase() : event.key;
      const action = bindings[name];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, commit, focusedFile, keys, move, push, toggle, toggleAll]);

  const pushLabel = status?.upstream
    ? `${status.upstream.remote}/${status.upstream.branch}`
    : status?.pushRemote && status.branch
      ? `${status.pushRemote}/${status.branch}`
      : null;
  return (
    <div ref={root} {...stylex.props(styles.root)}>
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
            disabled={!files.length || busy !== null}
            onClick={() => void toggleAll()}
            title="Stage or unstage every change (a)"
            {...stylex.props(ui.button, styles.small)}
          >
            {files.some((file) => file.unstaged) ? "Stage all" : "Unstage all"}
          </button>
        </header>
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
          {status && !files.length && <p {...stylex.props(styles.empty)}>No changes to commit.</p>}
          {files.map((file) => {
            const state = stageState(file);
            const slash = file.path.lastIndexOf("/") + 1;
            const change = file.unstaged ?? file.staged;
            return (
              // The listbox takes the keys and names the focused row.
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={file.path}
                id={rowId(file.path)}
                role="option"
                tabIndex={-1}
                aria-selected={file === focusedFile}
                aria-label={`${file.path}, ${marks[state].label}${change ? `, ${change}` : ""}`}
                title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                onClick={() => {
                  setFocused(file.path);
                  list.current?.focus({ preventScroll: true });
                }}
                onDoubleClick={() => void toggle(file)}
                {...stylex.props(styles.row, file === focusedFile && styles.rowFocused)}
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
                {change && (
                  <span
                    {...stylex.props(
                      styles.letter,
                      (change === "added" || change === "untracked") && ui.added,
                      change === "deleted" && ui.removed,
                      change === "conflicted" && styles.conflict,
                    )}
                  >
                    {letters[change]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div {...stylex.props(styles.composer)}>
          <textarea
            ref={field}
            aria-label="Commit message"
            placeholder={`Message (c) · ${stagedCount} staged`}
            value={text}
            rows={3}
            spellCheck
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                list.current?.focus({ preventScroll: true });
              }
            }}
            {...stylex.props(ui.input, styles.message)}
          />
          {confirmTrack && pushLabel ? (
            <div role="group" aria-label="Track a new upstream" {...stylex.props(styles.confirm)}>
              <span {...stylex.props(ui.grow)}>
                Push to <strong>{pushLabel}</strong> and track it?
              </span>
              <button
                ref={confirmButton}
                type="button"
                onClick={() => void push(true)}
                {...stylex.props(ui.button, ui.primary, styles.small)}
              >
                Push and track
              </button>
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
            </div>
          ) : (
            <div {...stylex.props(styles.actions)}>
              <button
                type="button"
                disabled={busy !== null || !stagedCount || !text.trim()}
                onClick={() => void commit()}
                {...stylex.props(ui.button, ui.primary, styles.action)}
              >
                <Icon name="commit" size={14} />
                {busy === "commit" ? "Committing…" : "Commit"}
                <ShortcutKeys value="Mod+Enter" />
              </button>
              <button
                type="button"
                disabled={
                  busy !== null ||
                  !status?.head ||
                  !status.branch ||
                  (!!status.upstream && status.ahead === 0)
                }
                title={pushLabel ? `Push to ${pushLabel}` : "No remote to push to"}
                onClick={() => void push()}
                {...stylex.props(ui.button, styles.action)}
              >
                <Icon name="push" size={14} />
                {busy === "push" ? "Pushing…" : "Push"}
                {!!status?.ahead && <span {...stylex.props(ui.faint)}>↑{status.ahead}</span>}
                <ShortcutKeys value="Shift+P" />
              </button>
            </div>
          )}
          {notice && (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              {...stylex.props(styles.notice, notice.tone === "error" && styles.noticeError)}
            >
              {notice.text}
            </p>
          )}
        </div>
      </div>
      <FileChangesPane
        api={api}
        file={focusedFile}
        version={`${status?.indexKey}\0${revision}`}
        theme={theme}
      />
    </div>
  );
}

const rowId = (path: string) => `commit-row-${encodeURIComponent(path)}`;

/** The focused file's staged and unstaged changes. The last file stays on
 * screen until the next one loads, so holding j does not flash. */
function FileChangesPane({
  api,
  file,
  version,
  theme,
}: {
  api: CommitApi;
  file: WorkingFile | null;
  version: string;
  theme: { pierreTheme: string; appearance: "light" | "dark" };
}) {
  const [shown, setShown] = useState<FileChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api.changes(file, abort.signal).then(
        (changes) => {
          setShown(changes);
          setError(null);
        },
        (reason) => {
          if (!abort.signal.aborted) setError(message(reason));
        },
      );
    }, 40);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [api, file, version]);
  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      theme: theme.pierreTheme,
      themeType: theme.appearance,
      diffStyle: "unified",
      overflow: "wrap",
      diffIndicators: "bars",
      lineDiffType: "word-alt",
      disableFileHeader: true,
      hunkSeparators: "line-info",
    }),
    [theme.pierreTheme, theme.appearance],
  );
  const parts = useMemo(
    () =>
      shown
        ? (
            [
              ["Staged", shown.staged],
              ["Not staged", shown.unstaged],
            ] as const
          ).flatMap(([title, patch]) => {
            const metadata = patch ? parseReviewPatch(patch)[0] : undefined;
            return metadata ? [{ title, metadata }] : [];
          })
        : [],
    [shown],
  );
  if (!file) return <section aria-label="File changes" {...stylex.props(styles.pane)} />;
  return (
    <section aria-label={`Changes in ${shown?.path ?? file.path}`} {...stylex.props(styles.pane)}>
      <header {...stylex.props(styles.paneHeader)}>
        <span {...stylex.props(styles.path)}>{shown?.path ?? file.path}</span>
      </header>
      {error && (
        <p role="alert" {...stylex.props(styles.empty)}>
          {error}
        </p>
      )}
      {shown?.binary && <p {...stylex.props(styles.empty)}>Binary file.</p>}
      {shown?.tooLarge && <p {...stylex.props(styles.empty)}>This change is too large to show.</p>}
      {parts.map((part) => (
        <section key={part.title} aria-label={part.title} {...stylex.props(styles.part)}>
          <h3 {...stylex.props(styles.partTitle)}>{part.title}</h3>
          <FileDiff fileDiff={part.metadata} options={options} style={diffSurfaceStyle} />
        </section>
      ))}
      {shown && !parts.length && !shown.binary && !shown.tooLarge && (
        <p {...stylex.props(styles.empty)}>No text changes, such as a mode change only.</p>
      )}
    </section>
  );
}

const styles = stylex.create({
  root: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 34%) minmax(0, 1fr)",
    height: "100%",
    minHeight: 0,
    backgroundColor: tokens.canvas,
  },
  side: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: tokens.line,
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
  branch: { color: tokens.text, fontWeight: 500 },
  small: { height: 24, paddingInline: 8, fontSize: 12 },
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
    color: tokens.text,
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
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
  composer: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
    padding: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  message: {
    width: "100%",
    minHeight: 64,
    resize: "vertical",
    boxSizing: "border-box",
    paddingBlock: 8,
    fontFamily: tokens.code,
    fontSize: 12.5,
    lineHeight: 1.45,
  },
  actions: { display: "flex", gap: 8 },
  action: { flex: "1", gap: 6, justifyContent: "center" },
  confirm: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: tokens.muted },
  notice: {
    margin: 0,
    maxHeight: 160,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    fontSize: 12,
    color: tokens.muted,
  },
  noticeError: { color: tokens.red, fontFamily: tokens.code, fontSize: 11.5 },
  pane: { minWidth: 0, minHeight: 0, overflowY: "auto" },
  paneHeader: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    height: 40,
    paddingInline: 16,
    fontSize: 12.5,
    color: tokens.text,
    backgroundColor: tokens.canvas,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  part: { paddingBottom: 12 },
  partTitle: {
    margin: 0,
    paddingBlock: 10,
    paddingInline: 16,
    fontSize: 11.5,
    fontWeight: 500,
    color: tokens.muted,
  },
});
