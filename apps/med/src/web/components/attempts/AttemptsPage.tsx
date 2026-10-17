import { PatchDiff } from "@pierre/diffs/react";
import * as stylex from "@stylexjs/stylex";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  attemptLetter,
  type Attempt,
  type AttemptCheck,
  type AttemptCompare,
  type AttemptFile,
  type AttemptFileChange,
  type AttemptKept,
} from "../../../shared/attempts";
import type { Thread } from "../../../shared/threads";
import { attemptsVersion, keepAttempt, undoKeep, useAttemptCompare } from "../../data/attempts";
import { visibleElement } from "../../data/palette-focus";
import { useTitleBarOverlay } from "../../data/title-bar";
import { tokens, ui } from "../../theme.stylex";
import { useTheme } from "../../themes";
import { CardTab, tabbedCard } from "../CardTab";
import { diffSurfaceStyle } from "../diff-surface";
import { Icon, type IconName } from "../Icon";
import { ToolButton } from "../ToolButton";

/**
 * The Attempts page: one task that two or three agents did, side by side. A
 * column for each attempt: who did it, how long it took, its changes, the
 * checks its session ran, and its last message. Below, the changed files:
 * those that more attempts changed first, each attempt's diff in its column.
 * ← and → move between the attempts' Keep buttons; Escape goes back.
 */
export function AttemptsPage({
  group,
  threads,
  fetcher,
  notice,
  onBack,
  onOpen,
  onKept,
  onUndone,
}: {
  group: string;
  threads: readonly Thread[];
  fetcher?: typeof fetch;
  /** A problem from the start, such as an attempt that did not start. */
  notice?: string;
  onBack(): void;
  onOpen(attempt: Attempt): void;
  onKept(result: AttemptKept): void;
  /** Undo here brought back the other attempts. */
  onUndone?(): void;
}) {
  const tab = useTitleBarOverlay();
  const { data, error, retry } = useAttemptCompare(group, attemptsVersion(threads, group), fetcher);
  const title =
    data?.title ?? threads.find((thread) => thread.group?.id === group)?.title ?? "Attempts";
  const page = useRef<HTMLElement>(null);
  const keeps = useRef<(HTMLButtonElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const [keeping, setKeeping] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The page takes focus when it opens, such as from the sidebar, so its keys work at once.
  useEffect(() => page.current?.focus({ preventScroll: true }), []);
  // Escape goes back, also from the sidebar. ← and → move between the Keep
  // buttons, so Enter keeps the attempt that has focus. Arrow keys in the
  // sidebar, and keys in a field outside the page, stay theirs.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (visibleElement('[role="dialog"], [role="menu"]')) return;
      const target = event.target as HTMLElement;
      const inPage = target === document.body || !!page.current?.contains(target);
      const field = !!target.closest("input, textarea, select, [contenteditable]");
      if (event.key === "Escape") {
        if (field && !inPage) return;
        event.preventDefault();
        onBack();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (!inPage || field) return;
      const buttons = keeps.current.filter((button) => button?.isConnected && !button.disabled);
      if (!buttons.length) return;
      event.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        at < 0
          ? event.key === "ArrowLeft"
            ? buttons.length - 1
            : 0
          : Math.max(0, Math.min(buttons.length - 1, at + (event.key === "ArrowLeft" ? -1 : 1)));
      buttons[next]!.focus();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onBack]);

  const keep = (attempt: Attempt) => {
    setKeeping(attempt.threadId);
    setProblem(null);
    keepAttempt(group, attempt.threadId, fetcher).then(onKept, (reason: unknown) => {
      setKeeping(null);
      setProblem(reason instanceof Error ? reason.message : "Med could not keep this attempt.");
    });
  };
  const undo = () => {
    setProblem(null);
    undoKeep(group, fetcher).then(
      () => {
        onUndone?.();
        retry();
      },
      (reason: unknown) =>
        setProblem(reason instanceof Error ? reason.message : "Undo did not complete."),
    );
  };

  let body: ReactNode;
  if (!data && !error) body = <p {...stylex.props(styles.status)}>Reading the attempts…</p>;
  else if (!data && error)
    body = (
      <div role="alert" {...stylex.props(styles.empty)}>
        <p {...stylex.props(styles.emptyText)}>
          {error.missing
            ? "Med has no attempts in this group."
            : `Med could not read the attempts. ${error.message}`}
        </p>
        {!error.missing && (
          <button type="button" onClick={retry} {...stylex.props(ui.button, ui.outlined)}>
            Try again
          </button>
        )}
      </div>
    );
  else if (data && data.kept && data.attempts.length === 1)
    body = <Kept data={data} onOpen={() => onOpen(data.attempts[0]!)} onUndo={undo} />;
  else if (data && !data.attempts.length)
    body = (
      <div {...stylex.props(styles.empty)}>
        <p {...stylex.props(styles.emptyText)}>Every attempt in this group is archived.</p>
      </div>
    );
  else if (data)
    body = (
      <Comparison
        data={data}
        focused={focused}
        keeping={keeping}
        keepRef={(index, button) => {
          keeps.current[index] = button;
        }}
        onFocus={setFocused}
        onKeep={keep}
        onOpen={onOpen}
      />
    );

  const base = data?.base;
  return (
    <div {...stylex.props(styles.page, tab && styles.pageTab)}>
      <main
        ref={page}
        tabIndex={-1}
        aria-label="Attempts"
        {...stylex.props(styles.card, tab && tabbedCard.card)}
      >
        {tab && <CardTab />}
        <header {...stylex.props(styles.header)}>
          <ToolButton label="Back" shortcut="Esc" icon="arrowLeft" onClick={onBack} />
          <h1 {...stylex.props(styles.title)}>{title}</h1>
          {data && data.attempts.length > 1 && (
            <span {...stylex.props(styles.meta)}>
              {data.attempts.length} attempts
              {base && (
                <>
                  {" "}
                  from {base.branch ?? "commit"}{" "}
                  <code {...stylex.props(styles.sha)}>{base.sha.slice(0, 7)}</code>
                </>
              )}
            </span>
          )}
        </header>
        <div {...stylex.props(styles.scroller)}>
          {(problem || notice) && (
            <p role="alert" {...stylex.props(styles.problem)}>
              {problem ?? notice}
            </p>
          )}
          {error && data && (
            <p role="status" {...stylex.props(styles.stale)}>
              Med could not read the attempts again. {error.message}
            </p>
          )}
          {body}
        </div>
      </main>
    </div>
  );
}

// ------------------------------------------------------------ the columns

const COLUMNS = [undefined, "cols1", "cols2", "cols3"] as const;
const SPANS = [undefined, "span1", "span2", "span3"] as const;

function Comparison({
  data,
  focused,
  keeping,
  keepRef,
  onFocus,
  onKeep,
  onOpen,
}: {
  data: AttemptCompare;
  focused: number | null;
  keeping: string | null;
  keepRef(index: number, button: HTMLButtonElement | null): void;
  onFocus(index: number | null): void;
  onKeep(attempt: Attempt): void;
  onOpen(attempt: Attempt): void;
}) {
  const { attempts } = data;
  const count = Math.min(3, Math.max(1, attempts.length));
  const columns = styles[COLUMNS[count]!];
  const now = useNow(attempts.some((attempt) => attempt.state === "working"));
  const rows: { label: string; cell(attempt: Attempt): ReactNode }[] = [
    { label: "Status", cell: (attempt) => <Status attempt={attempt} now={now} /> },
    {
      label: "Branch",
      cell: (attempt) =>
        attempt.branch ? (
          <code {...stylex.props(styles.branch)}>{attempt.branch}</code>
        ) : (
          <span {...stylex.props(styles.faint)}>No branch</span>
        ),
    },
    {
      label: "Changes",
      cell: (attempt) =>
        attempt.problem ? (
          <span {...stylex.props(styles.warning)}>{attempt.problem}</span>
        ) : attempt.changes.files ? (
          <span {...stylex.props(styles.counts)}>
            {attempt.changes.files} {attempt.changes.files === 1 ? "file" : "files"}
            <span {...stylex.props(styles.added)}>+{attempt.changes.additions}</span>
            <span {...stylex.props(styles.removed)}>−{attempt.changes.deletions}</span>
          </span>
        ) : (
          <span {...stylex.props(styles.faint)}>No changes yet</span>
        ),
    },
    { label: "Checks", cell: (attempt) => <Checks checks={attempt.checks} /> },
    {
      label: "Last message",
      cell: (attempt) =>
        attempt.lastMessage ? (
          <Message text={attempt.lastMessage} />
        ) : (
          <span {...stylex.props(styles.faint)}>No message</span>
        ),
    },
  ];
  const sections = useMemo(() => fileSections(data.files, attempts.length), [data, attempts]);
  return (
    <div {...stylex.props(styles.sheet)}>
      {/* The attempts' names and Keep stay in view while the files scroll. */}
      <div {...stylex.props(styles.grid, columns, styles.names)}>
        <span aria-hidden="true" />
        {attempts.map((attempt, index) => {
          const letter = attemptLetter(attempt.attempt);
          return (
            <div
              key={attempt.threadId}
              data-attempt={letter}
              {...stylex.props(styles.name, focused === index && styles.nameFocused)}
            >
              <span {...stylex.props(styles.letter)}>{letter}</span>
              <span {...stylex.props(styles.agentMark)}>
                <Icon name={agentIcon(attempt.kind)} size={13} />
              </span>
              <span {...stylex.props(styles.agent)}>
                {attempt.agent ?? "No session"}
                {attempt.model && (
                  <span {...stylex.props(styles.model)}>
                    <span aria-hidden="true"> · </span>
                    {attempt.model}
                  </span>
                )}
              </span>
              <ToolButton
                label={`Open attempt ${letter}`}
                icon="external"
                onClick={() => onOpen(attempt)}
              />
              {attempts.length > 1 && (
                <button
                  type="button"
                  ref={(button) => keepRef(index, button)}
                  disabled={!!keeping}
                  onFocus={() => onFocus(index)}
                  onBlur={() => onFocus(null)}
                  onClick={() => onKeep(attempt)}
                  {...stylex.props(
                    ui.button,
                    ui.pressable,
                    focused === index ? ui.primary : ui.outlined,
                    styles.keep,
                  )}
                >
                  {keeping === attempt.threadId ? "Keeping…" : `Keep ${letter}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div role="table" aria-label="Attempts" {...stylex.props(styles.grid, columns, styles.facts)}>
        {rows.map((row) => (
          <div role="row" key={row.label} {...stylex.props(styles.row)}>
            <span role="rowheader" {...stylex.props(ui.label, styles.rowLabel)}>
              {row.label}
            </span>
            {attempts.map((attempt) => (
              <div role="cell" key={attempt.threadId} {...stylex.props(styles.fact)}>
                <span {...stylex.props(ui.label, styles.inlineLabel)}>{row.label}</span>
                {row.cell(attempt)}
              </div>
            ))}
          </div>
        ))}
      </div>
      {sections.length ? (
        <div {...stylex.props(styles.grid, columns, styles.files)}>
          {sections.map((section) =>
            section.files.map((file, index) => (
              <Fragment key={file.path}>
                <div {...stylex.props(styles.gutter)}>
                  {index === 0 && (
                    <span {...stylex.props(ui.label, styles.section)}>
                      {section.label}
                      <span {...stylex.props(styles.sectionCount)}>{section.files.length}</span>
                    </span>
                  )}
                </div>
                <h3
                  data-attempt-path={file.path}
                  {...stylex.props(styles.path, styles[SPANS[count]!])}
                >
                  {index === 0 && (
                    <span {...stylex.props(ui.label, styles.inlineSection)}>
                      {section.label} ·{" "}
                    </span>
                  )}
                  <span {...stylex.props(styles.folder)}>
                    {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
                  </span>
                  {file.path.slice(file.path.lastIndexOf("/") + 1)}
                </h3>
                <div aria-hidden="true" />
                {file.changes.map((change, column) => (
                  <FileCell
                    key={attempts[column]!.threadId}
                    path={file.path}
                    change={change}
                    letter={attemptLetter(attempts[column]!.attempt)}
                    focused={focused === column}
                  />
                ))}
              </Fragment>
            )),
          )}
        </div>
      ) : (
        <p {...stylex.props(styles.status)}>No changed files yet.</p>
      )}
      {data.moreFiles ? (
        <p {...stylex.props(styles.status)}>
          Med shows the first {data.files.length} files. Open an attempt to see the other{" "}
          {data.moreFiles}.
        </p>
      ) : null}
    </div>
  );
}

/** Files by which attempts changed them: "In both" first, then "Only in A". */
function fileSections(files: AttemptFile[], count: number) {
  const sections: { key: string; label: string; files: AttemptFile[] }[] = [];
  for (const file of files) {
    const key = file.changes.map((change) => (change ? "1" : "0")).join("");
    let section = sections.at(-1);
    if (section?.key !== key)
      sections.push((section = { key, label: sectionLabel(key, count), files: [] }));
    section.files.push(file);
  }
  return sections;
}

function sectionLabel(key: string, count: number) {
  const letters = [...key].flatMap((bit, index) => (bit === "1" ? [attemptLetter(index + 1)] : []));
  if (letters.length === 1) return `Only in ${letters[0]}`;
  if (letters.length === count) return count === 2 ? "In both" : "In all three";
  return `In ${letters.join(" and ")}`;
}

function agentIcon(kind: Attempt["kind"]): IconName {
  return kind === "claude" || kind === "codex" ? kind : "agent";
}

/** The time now, again each 30 seconds while an attempt works. */
function useNow(live: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

/** A duration as people say it: 40 s, 37 min, 1 h 5 min. */
export function duration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}

function Status({ attempt, now }: { attempt: Attempt; now: number }) {
  const started = attempt.startedAt;
  if (attempt.state === "working")
    return (
      <span {...stylex.props(styles.state)}>
        <span {...stylex.props(styles.working)} aria-hidden="true" />
        Working{started ? ` · ${duration(now - started)}` : ""}
      </span>
    );
  if (attempt.state === "waiting")
    return (
      <span {...stylex.props(styles.state, styles.needsYou)}>
        <span {...stylex.props(styles.waiting)} aria-hidden="true" />
        Needs you
      </span>
    );
  if (!attempt.state) return <span {...stylex.props(styles.faint)}>No session</span>;
  return (
    <span {...stylex.props(styles.state)}>
      Done
      {started && attempt.endedAt ? (
        <span {...stylex.props(styles.muted)}> · {duration(attempt.endedAt - started)}</span>
      ) : null}
    </span>
  );
}

const CHECK_MARKS: Record<AttemptCheck["status"], { icon?: IconName; label: string }> = {
  passed: { icon: "check", label: "Passed" },
  failed: { icon: "close", label: "Failed" },
  running: { label: "Running" },
  unknown: { label: "No result" },
};

function Checks({ checks }: { checks: AttemptCheck[] }) {
  if (!checks.length) return <span {...stylex.props(styles.faint)}>None in its session</span>;
  return (
    <ul {...stylex.props(styles.checks)}>
      {checks.map((check, index) => {
        const mark = CHECK_MARKS[check.status];
        return (
          <li key={`${check.at}-${index}`} {...stylex.props(styles.check)}>
            <span
              role="img"
              aria-label={mark.label}
              {...stylex.props(
                styles.checkMark,
                check.status === "passed" && styles.added,
                check.status === "failed" && styles.removed,
              )}
            >
              {mark.icon ? (
                <Icon name={mark.icon} size={12} />
              ) : check.status === "running" ? (
                <span {...stylex.props(styles.working)} />
              ) : (
                "–"
              )}
            </span>
            <code title={check.command} {...stylex.props(styles.command)}>
              {check.command.split("\n")[0]}
            </code>
            {check.summary && (
              <span {...stylex.props(styles.summary, check.status === "failed" && styles.removed)}>
                {check.summary}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** An agent's reply, with `code` set apart; four lines until Show more. */
function Message({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 260 || text.split("\n").length > 4;
  // Folded, paragraphs follow on the next line, so the four lines hold more of the reply.
  const parts = (long && !open ? text.replace(/\n{2,}/g, "\n") : text).split(/(`[^`\n]+`)/g);
  return (
    <div>
      <p {...stylex.props(styles.message, long && !open && styles.clamped)}>
        {parts.map((part, index) =>
          part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
            <code key={index} {...stylex.props(styles.inlineCode)}>
              {part.slice(1, -1)}
            </code>
          ) : (
            part
          ),
        )}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          {...stylex.props(ui.button, styles.more)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

const STATUS_WORDS: Record<AttemptFileChange["status"], string> = {
  added: "Added",
  modified: "Changed",
  deleted: "Deleted",
  renamed: "Renamed",
};

function FileCell({
  path,
  change,
  letter,
  focused,
}: {
  path: string;
  change: AttemptFileChange | null;
  letter: string;
  focused: boolean;
}) {
  if (!change)
    return (
      <div data-attempt-file={letter} data-attempt-path={path} {...stylex.props(styles.unchanged)}>
        <span {...stylex.props(styles.faint)}>Not changed in {letter}</span>
      </div>
    );
  return (
    <div
      data-attempt-file={letter}
      data-attempt-path={path}
      {...stylex.props(styles.cell, focused && styles.cellFocused)}
    >
      <div {...stylex.props(styles.cellHead)}>
        <span {...stylex.props(styles.cellLetter)}>{letter}</span>
        <span>
          {STATUS_WORDS[change.status]}
          {change.previousPath && (
            <span {...stylex.props(styles.muted)}> from {change.previousPath}</span>
          )}
        </span>
        <span {...stylex.props(styles.cellCounts)}>
          {change.additions > 0 && <span {...stylex.props(styles.added)}>+{change.additions}</span>}
          {change.deletions > 0 && (
            <span {...stylex.props(styles.removed)}>−{change.deletions}</span>
          )}
        </span>
      </div>
      {change.patch ? (
        <LazyDiff patch={change.patch} />
      ) : (
        <p {...stylex.props(styles.cellNote)}>
          {change.binary ? "A binary file." : "This diff is too large to show here."}
        </p>
      )}
    </div>
  );
}

/** A diff mounts when it comes near the screen; until then it keeps its height. */
function LazyDiff({ patch }: { patch: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = box.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setSeen(true);
        observer.disconnect();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  const lines = useMemo(() => patch.split("\n").length, [patch]);
  return (
    <div ref={box} style={seen ? undefined : { minHeight: Math.min(lines, 400) * 18 }}>
      {seen && <Diff patch={patch} />}
    </div>
  );
}

function Diff({ patch }: { patch: string }) {
  const { active } = useTheme();
  const options = useMemo(
    () => ({
      theme: active.pierreTheme,
      themeType: active.appearance,
      diffStyle: "unified" as const,
      overflow: "wrap" as const,
      diffIndicators: "bars" as const,
      lineDiffType: "word-alt" as const,
      hunkSeparators: "line-info" as const,
      disableFileHeader: true,
      unsafeCSS: `[data-separator-content] { font-size: 11px; }`,
    }),
    [active],
  );
  return (
    <PatchDiff
      patch={patch}
      options={options}
      style={
        {
          ...diffSurfaceStyle,
          "--diffs-font-size": "11.5px",
          "--diffs-line-height": "18px",
        } as never
      }
    />
  );
}

function Kept({ data, onOpen, onUndo }: { data: AttemptCompare; onOpen(): void; onUndo(): void }) {
  const attempt = data.attempts[0]!;
  return (
    <div {...stylex.props(styles.empty)}>
      <p {...stylex.props(styles.emptyText)}>
        You kept {attemptLetter(attempt.attempt)}
        {attempt.agent ? `, ${attempt.agent}${attempt.model ? ` · ${attempt.model}` : ""}` : ""}.
        The other attempts are archived. Their branches keep their work.
      </p>
      <div {...stylex.props(styles.emptyActions)}>
        <button type="button" onClick={onOpen} {...stylex.props(ui.button, ui.outlined)}>
          Open the thread
        </button>
        <button type="button" onClick={onUndo} {...stylex.props(ui.button)}>
          Undo
        </button>
      </div>
    </div>
  );
}

const turn = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const pulse = stylex.keyframes({
  "0%": { boxShadow: `0 0 0 0 color-mix(in srgb, ${tokens.accent} 45%, transparent)` },
  "70%": { boxShadow: `0 0 0 5px color-mix(in srgb, ${tokens.accent} 0%, transparent)` },
  "100%": { boxShadow: `0 0 0 0 color-mix(in srgb, ${tokens.accent} 0%, transparent)` },
});
const reduced = "@media (prefers-reduced-motion: reduce)";
// Without room for the row labels, each value names itself.
const narrow = "@container (max-width: 720px)";

const styles = stylex.create({
  // The review's frame, as the Sources page: a 6px gutter and one card.
  page: {
    position: "absolute",
    inset: 0,
    zIndex: 30,
    display: "flex",
    padding: 6,
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    WebkitFontSmoothing: "antialiased",
  },
  pageTab: { top: "calc(-1 * var(--med-titlebar-height))" },
  card: {
    position: "relative",
    flex: "1",
    minWidth: 0,
    outline: "none",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: tokens.frame,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: 38,
    paddingInline: 6,
    boxSizing: "border-box",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    minWidth: 0,
  },
  title: {
    margin: 0,
    marginInlineStart: 2,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.005em",
    whiteSpace: "nowrap",
  },
  meta: {
    flexShrink: 0,
    marginInlineStart: 8,
    color: tokens.faint,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  sha: { fontFamily: tokens.code, fontSize: 11 },
  scroller: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    containerType: "inline-size",
  },
  status: {
    marginBlock: 16,
    marginInline: 20,
    color: tokens.muted,
  },
  problem: {
    marginBlock: 0,
    marginTop: 12,
    marginInline: 20,
    paddingBlock: 7,
    paddingInline: 10,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.red} 10%, transparent)`,
    color: tokens.text,
    lineHeight: 1.5,
  },
  stale: { marginBlock: 0, marginTop: 10, marginInline: 20, color: tokens.faint },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 12,
    maxWidth: 560,
    paddingBlock: 28,
    paddingInline: 20,
  },
  emptyText: { margin: 0, color: tokens.muted, fontSize: 13, lineHeight: 1.6 },
  emptyActions: { display: "flex", gap: 6 },
  sheet: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 1680,
    marginInline: "auto",
    paddingInline: { default: 20, [narrow]: 10 },
    paddingBottom: 48,
  },
  // A label column, then one column for each attempt.
  grid: { display: "grid", columnGap: { default: 14, [narrow]: 10 } },
  cols1: { gridTemplateColumns: { default: "96px minmax(0, 1fr)", [narrow]: "0 minmax(0, 1fr)" } },
  cols2: {
    gridTemplateColumns: {
      default: "96px repeat(2, minmax(0, 1fr))",
      [narrow]: "0 repeat(2, minmax(0, 1fr))",
    },
  },
  cols3: {
    gridTemplateColumns: {
      default: "96px repeat(3, minmax(0, 1fr))",
      [narrow]: "0 repeat(3, minmax(0, 1fr))",
    },
  },
  span1: { gridColumnStart: 2, gridColumnEnd: "span 1" },
  span2: { gridColumnStart: 2, gridColumnEnd: "span 2" },
  span3: { gridColumnStart: 2, gridColumnEnd: "span 3" },
  names: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: tokens.canvas,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  name: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    paddingBlock: 3,
    paddingInlineStart: 4,
    paddingInlineEnd: 3,
    borderRadius: `calc(8px * ${tokens.round})`,
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  },
  nameFocused: { backgroundColor: tokens.fill },
  letter: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 20,
    height: 20,
    borderRadius: `calc(5px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}`,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 11,
    fontWeight: 500,
  },
  agentMark: { display: "inline-flex", flexShrink: 0, color: tokens.muted },
  agent: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 500,
  },
  model: { color: tokens.muted, fontWeight: 400 },
  keep: { flexShrink: 0, paddingInline: 10 },
  facts: { paddingBottom: 6 },
  row: { display: "contents" },
  // Narrow, the label keeps its empty column, so each value stays under its attempt.
  rowLabel: {
    display: "block",
    overflow: { default: "visible", [narrow]: "hidden" },
    whiteSpace: { default: "normal", [narrow]: "nowrap" },
    paddingTop: { default: 9, [narrow]: 0 },
    lineHeight: "18px",
    borderTopWidth: { default: 1, [narrow]: 0 },
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  fact: {
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 4,
    lineHeight: "18px",
    color: tokens.text,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  inlineLabel: {
    display: { default: "none", [narrow]: "block" },
    marginBottom: 2,
    fontSize: 11,
  },
  state: { display: "inline-flex", alignItems: "center", gap: 6 },
  needsYou: { color: tokens.accent, fontWeight: 500 },
  muted: { color: tokens.muted },
  faint: { color: tokens.faint },
  warning: { color: tokens.warning },
  branch: { fontFamily: tokens.code, fontSize: 11.5, color: tokens.muted, wordBreak: "break-all" },
  counts: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 8,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: tokens.green, fontFamily: tokens.code, fontSize: 11.5 },
  removed: { color: tokens.red, fontFamily: tokens.code, fontSize: 11.5 },
  checks: { listStyle: "none", margin: 0, padding: 0, display: "grid", rowGap: 3 },
  check: {
    display: "grid",
    gridTemplateColumns: "14px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 7,
  },
  checkMark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.faint,
  },
  command: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  summary: {
    color: tokens.muted,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  message: {
    margin: 0,
    color: tokens.muted,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    lineHeight: 1.55,
  },
  clamped: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 4,
    overflow: "hidden",
  },
  inlineCode: {
    fontFamily: tokens.code,
    fontSize: 11,
    color: tokens.text,
  },
  more: { minHeight: 22, marginTop: 2, marginInlineStart: -8, color: tokens.accent },
  files: {
    rowGap: 0,
    paddingTop: 10,
  },
  gutter: { minWidth: 0, paddingTop: 22 },
  section: {
    display: { default: "flex", [narrow]: "none" },
    alignItems: "baseline",
    gap: 6,
  },
  sectionCount: { color: tokens.faint, fontVariantNumeric: "tabular-nums" },
  inlineSection: { display: { default: "none", [narrow]: "inline" } },
  path: {
    margin: 0,
    marginTop: 18,
    marginBottom: 6,
    paddingInline: 4,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12.5,
    fontWeight: 500,
    // Below the attempts' sticky names when a file scrolls into view.
    scrollMarginTop: 72,
  },
  folder: { color: tokens.muted, fontWeight: 400 },
  cell: {
    alignSelf: "start",
    minWidth: 0,
    overflow: "hidden",
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    transitionProperty: "box-shadow",
    transitionDuration: "120ms",
  },
  cellFocused: { boxShadow: `0 0 0 1px ${tokens.lineStrong}` },
  cellHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    paddingBlock: 5,
    paddingInline: 8,
    color: tokens.muted,
    fontSize: 11.5,
    backgroundColor: tokens.fill,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  cellLetter: { fontFamily: tokens.code, fontSize: 11, color: tokens.text, fontWeight: 500 },
  cellCounts: {
    display: "inline-flex",
    gap: 6,
    marginInlineStart: "auto",
    fontVariantNumeric: "tabular-nums",
  },
  cellNote: { margin: 0, paddingBlock: 10, paddingInline: 10, color: tokens.faint },
  unchanged: {
    alignSelf: "start",
    minWidth: 0,
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    fontSize: 11.5,
  },
  waiting: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
    animationName: { default: pulse, [reduced]: "none" },
    animationDuration: "2s",
    animationIterationCount: "infinite",
  },
  working: {
    display: "inline-block",
    boxSizing: "border-box",
    width: 11,
    height: 11,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderTopColor: tokens.text,
    animationName: { default: turn, [reduced]: "none" },
    animationDuration: "900ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});
