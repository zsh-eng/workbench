import * as stylex from "@stylexjs/stylex";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Thread } from "../../shared/threads";
import { useDocumentTitle } from "../data/document-title";
import { readHistory } from "../data/tabs";
import { matches, threadFields } from "../data/threads";
import { picked, tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { tooltip } from "./ToolButton";

// History as a page: every thread that is not a tab, closed threads and found
// sessions, newest first, by day. It reads what the switcher's history lists
// (GET /api/threads/history), searches it as the switcher does, and opens a
// row as a tab the same way. Laid out as the Pull requests page is: one
// column, the day's heading and the rows' text on one left edge, the cards 20
// pixels past it.

/** The page's address. */
export const HISTORY_PATH = "/history";

/** Opens the page. */
export function openHistoryPage() {
  if (location.pathname !== HISTORY_PATH) history.pushState(null, "", HISTORY_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** A thread's last activity, as the host orders history: its last change, or
 * its close when that came later. */
const lastActive = (thread: Thread) => Math.max(thread.closedAt ?? 0, thread.updatedAt);

const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0);
/** Today, Yesterday, the weekday within a week, then the date. */
function dayLabel(day: number, now: number) {
  const days = Math.round((midnight(now) - day) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(day);
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== new Date(now).getFullYear() && { year: "numeric" }),
  });
}
const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const agentIcon = (agent: Thread["agent"]): IconName =>
  agent === "claude" || agent === "codex" ? agent : "agent";
const agentName = (agent: Thread["agent"]) =>
  agent === "claude" ? "Claude" : agent === "codex" ? "Codex" : agent ? "Agent" : undefined;
const place = (thread: Thread) => {
  const repository = thread.repository?.name ?? thread.checkout?.split("/").at(-1);
  return [repository, thread.branch].filter(Boolean).join(" · ");
};

interface Group {
  day: number;
  rows: { thread: Thread; index: number }[];
}

export function HistoryPage({
  tabs,
  fetcher,
  onOpen,
  onDelete,
}: {
  /** The tabs: history lists the other threads, and is read again as they change. */
  tabs: readonly Thread[];
  fetcher: typeof fetch;
  /** Opens a thread from history as a tab, as the switcher does. */
  onOpen(thread: Thread): void;
  /** Deletes a thread for good: its saved review, comments, and history entry. */
  onDelete(thread: Thread): Promise<void>;
}) {
  useDocumentTitle("History", 3);
  const id = useId();
  const [past, setPast] = useState<readonly Thread[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  // Typing stays quick in a long history: the list follows a moment later.
  const searched = useDeferredValue(query);
  const [active, setActive] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // A tab that closes goes to history, and one that opens leaves it: read it
  // again when the tabs change.
  const open = useMemo(() => new Set(tabs.map((thread) => thread.id)), [tabs]);
  const tabKey = [...open].sort().join(" ");
  useEffect(() => {
    let current = true;
    readHistory(fetcher).then(
      (threads) => {
        if (!current) return;
        setPast(threads);
        setError("");
        setNow(Date.now());
      },
      (cause: unknown) => {
        if (current)
          setError(cause instanceof Error ? cause.message : "Med could not read history.");
      },
    );
    return () => {
      current = false;
    };
  }, [fetcher, tabKey]);
  // Today and Yesterday move on at midnight while the page shows.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5 * 60_000);
    return () => clearInterval(timer);
  }, []);

  const words = useMemo(() => searched.toLowerCase().split(/\s+/).filter(Boolean), [searched]);
  const rows = useMemo(
    () =>
      (past ?? []).filter((thread) => !open.has(thread.id) && matches(words, threadFields(thread))),
    [open, past, words],
  );
  const groups = useMemo(() => {
    const result: Group[] = [];
    rows.forEach((thread, index) => {
      const day = midnight(lastActive(thread));
      const last = result.at(-1);
      if (last?.day === day) last.rows.push({ thread, index });
      else result.push({ day, rows: [{ thread, index }] });
    });
    return result;
  }, [rows]);
  // A new search starts at its first row.
  const [searchedFor, setSearchedFor] = useState(searched);
  if (searchedFor !== searched) {
    setSearchedFor(searched);
    setActive(0);
    setConfirming(null);
  }
  const selected = Math.max(0, Math.min(active, rows.length - 1));
  const current = rows[selected];
  const optionId = useCallback((thread: Thread) => `${id}-${thread.id}`, [id]);

  // The props may change at each render; the rows' handlers do not.
  const latest = useRef({ onOpen, onDelete });
  useLayoutEffect(() => {
    latest.current = { onOpen, onDelete };
  });
  const openThread = useCallback((thread: Thread) => latest.current.onOpen(thread), []);
  const remove = useCallback((thread: Thread) => {
    setConfirming(null);
    latest.current.onDelete(thread).then(
      () => setPast((value) => value?.filter((entry) => entry.id !== thread.id) ?? null),
      (cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Med could not delete this thread."),
    );
  }, []);
  const keep = useCallback(() => setConfirming(null), []);

  useLayoutEffect(() => {
    if (!current) return;
    document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  }, [current, optionId]);
  useEffect(() => list.current?.focus({ preventScroll: true }), []);

  const step = (by: number) =>
    rows.length && setActive(Math.max(0, Math.min(rows.length - 1, selected + by)));
  /** The keys of the list, and of the search field where they do not edit it. */
  const listKey = (event: KeyboardEvent<HTMLElement>, inField: boolean) => {
    const asking = !!current && confirming === current.id;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const take = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowDown" || (!inField && plain && event.key === "j")) {
      take();
      step(1);
    } else if (event.key === "ArrowUp" || (!inField && plain && event.key === "k")) {
      take();
      step(-1);
    } else if (!inField && (event.key === "Home" || event.key === "End")) {
      take();
      setActive(event.key === "Home" ? 0 : rows.length - 1);
    } else if (event.key === "Enter" || (!inField && event.key === " ")) {
      take();
      if (current) (asking ? remove : openThread)(current);
    } else if (event.key === "Escape" && asking) {
      take();
      setConfirming(null);
    } else if (
      event.key === "Backspace" &&
      (event.metaKey || event.ctrlKey) &&
      current &&
      (!inField || !query)
    ) {
      // ⌘⌫ deletes the thread, after a second Return, as in the switcher.
      take();
      setConfirming(current.id);
    } else if (!inField && plain && event.key.length === 1 && event.key !== " ") {
      // A letter searches; / only moves to the field.
      if (event.key === "/") event.preventDefault();
      event.stopPropagation();
      search.current?.focus();
    }
  };

  return (
    // The workspace under the page gets none of the plain keys, and ⌘F finds
    // in history; ⌘K and the window's other shortcuts still work.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
          event.preventDefault();
          event.stopPropagation();
          search.current?.focus();
          search.current?.select();
        } else if (!event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation();
      }}
      {...stylex.props(styles.page)}
    >
      <div {...stylex.props(styles.scroller)}>
        <div {...stylex.props(styles.column)}>
          <div {...stylex.props(styles.heading)}>
            <h1 {...stylex.props(styles.pageTitle)}>History</h1>
            <span role="status" {...stylex.props(styles.count)}>
              {past === null
                ? ""
                : words.length
                  ? `${rows.length} of ${past.filter((thread) => !open.has(thread.id)).length}`
                  : `${rows.length} ${rows.length === 1 ? "thread" : "threads"}`}
            </span>
          </div>
          <div {...stylex.props(styles.searchRow)}>
            <span aria-hidden="true" {...stylex.props(styles.searchIcon)}>
              <Icon name="search" size={14} />
            </span>
            <input
              ref={search}
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={current ? optionId(current) : undefined}
              aria-label="Search history"
              placeholder="Search by title, branch, repository, or first prompt"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !(current && confirming === current.id)) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (query) setQuery("");
                  else list.current?.focus({ preventScroll: true });
                  return;
                }
                listKey(event, true);
              }}
              {...stylex.props(styles.search)}
            />
          </div>
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="History"
            aria-busy={past === null}
            tabIndex={0}
            aria-activedescendant={current ? optionId(current) : undefined}
            onKeyDown={(event) => listKey(event, false)}
            {...stylex.props(styles.list)}
          >
            {error && (
              <p role="alert" {...stylex.props(styles.notice, styles.bad)}>
                {error}
              </p>
            )}
            {groups.map((group) => {
              const label = dayLabel(group.day, now);
              return (
                <section
                  key={group.day}
                  role="group"
                  aria-label={label}
                  {...stylex.props(styles.section)}
                >
                  <h2 aria-hidden="true" {...stylex.props(styles.day)}>
                    {label}
                  </h2>
                  <div {...stylex.props(styles.card)}>
                    {group.rows.map(({ thread, index }, at) => (
                      <HistoryRow
                        key={thread.id}
                        thread={thread}
                        index={index}
                        first={at === 0}
                        id={optionId(thread)}
                        selected={index === selected}
                        asking={confirming === thread.id}
                        onPoint={setActive}
                        onOpen={openThread}
                        onAsk={setConfirming}
                        onDelete={remove}
                        onKeep={keep}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            {!rows.length && !error && (
              <p {...stylex.props(styles.notice)}>
                {past === null
                  ? "Reading history…"
                  : words.length
                    ? `Nothing matches “${searched}”.`
                    : "History is empty. Threads that you archive show here."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A thread in history: its agent's mark, its title, where it worked, its
 * agent, and when. A row renders again only for its own changes, so a long
 * history moves its selection at once. */
const HistoryRow = memo(function HistoryRow({
  thread,
  index,
  first,
  id,
  selected,
  asking,
  onPoint,
  onOpen,
  onAsk,
  onDelete,
  onKeep,
}: {
  thread: Thread;
  index: number;
  first: boolean;
  id: string;
  selected: boolean;
  asking: boolean;
  onPoint(index: number): void;
  onOpen(thread: Thread): void;
  onAsk(id: string): void;
  onDelete(thread: Thread): void;
  onKeep(): void;
}) {
  const at = lastActive(thread);
  const where = place(thread);
  const agent = agentName(thread.agent);
  return (
    // The listbox takes the keys for its options (aria-activedescendant).
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-label={[thread.title, where, agent].filter(Boolean).join(", ")}
      onPointerMove={() => {
        if (!selected) onPoint(index);
      }}
      onClick={() => (asking ? undefined : onOpen(thread))}
      {...stylex.props(styles.row, first && styles.firstRow, selected && [styles.selected, picked])}
    >
      <span aria-hidden="true" {...stylex.props(styles.mark)}>
        <Icon name={agentIcon(thread.agent)} size={15} />
      </span>
      <span {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.title)}>
          {asking ? `Delete “${thread.title}” for good?` : thread.title}
        </span>
        {!asking && (where || agent) && (
          <span {...stylex.props(styles.facts)}>
            {where && <span {...stylex.props(styles.fact)}>{where}</span>}
            {agent && <span {...stylex.props(styles.fact)}>{agent}</span>}
          </span>
        )}
      </span>
      {asking ? (
        <span {...stylex.props(styles.end)}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(thread);
            }}
            {...stylex.props(ui.button, styles.danger)}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onKeep();
            }}
            {...stylex.props(ui.button)}
          >
            Keep
          </button>
        </span>
      ) : (
        <span {...stylex.props(styles.end)}>
          {/* Stubs of deleted reviews and found sessions delete too. */}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Delete ${thread.title}`}
            {...tooltip("Delete", "⌘⌫")}
            onClick={(event) => {
              event.stopPropagation();
              onAsk(thread.id);
            }}
            {...stylex.props(ui.button, ui.iconButton, styles.remove, selected && styles.shown)}
          >
            <Icon name="trash" size={13} />
          </button>
          <time
            dateTime={new Date(at).toISOString()}
            {...tooltip(new Date(at).toLocaleString())}
            {...stylex.props(styles.time)}
          >
            {clock(at)}
          </time>
        </span>
      )}
    </div>
  );
});

const styles = stylex.create({
  // Over the workspaces, under Show sidebar in its corner.
  page: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    display: "flex",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    WebkitFontSmoothing: "antialiased",
  },
  scroller: { flex: "1", minWidth: 0, overflowY: "auto" },
  // The Pull requests page's column.
  column: {
    boxSizing: "content-box",
    maxWidth: 720,
    marginInline: "auto",
    paddingInline: 44,
    paddingTop: 56,
    paddingBottom: "max(72px, 33vh)",
  },
  heading: { display: "flex", alignItems: "baseline", gap: 10, minHeight: 32 },
  pageTitle: {
    margin: 0,
    fontSize: 26,
    lineHeight: 1.2,
    fontWeight: 550,
    letterSpacing: "-0.022em",
  },
  count: { color: tokens.faint, fontSize: 13, fontVariantNumeric: "tabular-nums" },
  // The field stays in view over a long history, as wide as the cards.
  searchRow: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    marginInline: -20,
    paddingTop: 20,
    paddingBottom: 4,
    backgroundColor: tokens.canvas,
  },
  searchIcon: {
    position: "absolute",
    left: 12,
    bottom: 14,
    display: "inline-flex",
    color: tokens.faint,
    pointerEvents: "none",
  },
  search: {
    boxSizing: "border-box",
    width: "100%",
    height: 34,
    paddingInlineStart: 34,
    paddingInlineEnd: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.line, ":hover": tokens.lineStrong, ":focus": tokens.accentLine },
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    outline: "none",
    boxShadow: { default: "none", ":focus": `0 0 0 3px ${tokens.accentSoft}` },
    "::placeholder": { color: tokens.faint },
  },
  list: { outline: "none" },
  section: { marginTop: 28 },
  day: {
    margin: 0,
    marginBottom: 10,
    fontSize: 13,
    fontWeight: 550,
    color: tokens.muted,
  },
  // The Pull requests page's card: 20 pixels past the column on each side.
  card: {
    marginInline: -20,
    overflow: "hidden",
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 3.5%, transparent)`,
  },
  // The rule between rows keeps to the text's edges. A row off screen costs
  // no layout or paint, so hundreds of them scroll as a few do.
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxSizing: "border-box",
    height: 56,
    paddingInline: 20,
    cursor: "pointer",
    contentVisibility: "auto",
    containIntrinsicSize: "auto 56px",
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    "::before": {
      content: '""',
      position: "absolute",
      top: 0,
      left: 20,
      right: 20,
      height: 1,
      backgroundColor: tokens.line,
    },
  },
  firstRow: { "::before": { content: "none" } },
  selected: { backgroundColor: { default: tokens.pick, ":hover": tokens.pick } },
  mark: { display: "inline-flex", flexShrink: 0, color: tokens.muted },
  text: { display: "flex", flexDirection: "column", gap: 3, flex: "1", minWidth: 0 },
  title: {
    fontSize: 14,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  facts: {
    display: "flex",
    columnGap: 12,
    overflow: "hidden",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 12.5,
  },
  fact: { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
  end: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  time: {
    minWidth: 40,
    textAlign: "end",
    color: tokens.faint,
    fontSize: 12.5,
    fontVariantNumeric: "tabular-nums",
  },
  remove: {
    color: tokens.muted,
    opacity: { default: 0, ":focus-visible": 1 },
  },
  // The selected row shows its trash button; the pointer selects the row.
  shown: { opacity: 1 },
  danger: { color: tokens.red },
  notice: { marginBlock: 28, color: tokens.muted },
  bad: { color: tokens.red },
});
