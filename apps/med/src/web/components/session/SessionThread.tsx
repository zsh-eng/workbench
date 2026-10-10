import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentMessage } from "../../../shared/agent-inbox";
import type { PlanEntry } from "../../../shared/agent-session";
import type { SessionItem, SessionSnapshot } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { motion, rowStyles } from "./session-styles";
import { BackgroundDock } from "./BackgroundDock";
import { SessionMarkdown } from "./SessionMarkdown";
import { formatSeconds, ThreadScroller, ToolCall } from "./ToolCall";
import "./SessionThread.css";

type ToolItem = Extract<SessionItem, { kind: "tool" }>;
type AgentItem = Extract<SessionItem, { kind: "agent" }>;

/** What a reader can do with an agent's reply, from the panel that shows the session. */
export interface ReplyActions {
  /** The pin of this reply, when it is pinned to the review. */
  pinned(itemId: string): string | undefined;
  pin(item: AgentItem): Promise<void>;
  /** Show the pinned reply in the review's Notes. */
  showPin(pinId: string): void;
}
export const ReplyActionsContext = createContext<ReplyActions | null>(null);
type Unit = { key: string; item: SessionItem } | { key: string; explore: ToolItem[] };

/** Units in the render window at first, added per step, and at most. */
const WINDOW = 300;
const STEP = 100;
const MAX_UNITS = 600;

/** A thought shows when it has text or took a while; short silent thoughts only show while they run. */
const LONG_THOUGHT = 2000;
const visible = (item: SessionItem) =>
  item.kind !== "thought" || item.text.trim() !== "" || (item.durationMs ?? 0) >= LONG_THOUGHT;
const exploring = (item: SessionItem): item is ToolItem =>
  item.kind === "tool" &&
  (item.call.kind === "read" || item.call.kind === "search") &&
  item.items.length === 0;

/** Reads and searches in a row become one "Explored" group, as in Codex. */
function units(items: SessionItem[]): Unit[] {
  const result: Unit[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (run.length > 1) result.push({ key: `explore-${run[0]!.id}`, explore: run });
    else if (run.length === 1) result.push({ key: run[0]!.id, item: run[0]! });
    run = [];
  };
  for (const item of items) {
    if (!visible(item)) continue;
    if (exploring(item)) {
      run.push(item);
      continue;
    }
    flush();
    result.push({ key: item.id, item });
  }
  flush();
  return result;
}

/** The reply that ends each turn: the last agent text before the user's next
 * message, or at the end of a finished thread. */
function finalReplies(list: Unit[], live: boolean) {
  const result = new Set<string>();
  let open = !live;
  for (let index = list.length - 1; index >= 0; index--) {
    const unit = list[index]!;
    if ("explore" in unit) continue;
    if (unit.item.kind === "user") open = true;
    else if (unit.item.kind === "agent" && open) {
      result.add(unit.item.id);
      open = false;
    }
  }
  return result;
}

function Thread({
  items,
  live,
  root = false,
  window,
  onOpenLink,
}: {
  items: SessionItem[];
  live: boolean;
  /** The session's own thread, not a subagent's. */
  root?: boolean;
  /** The root thread's units in view, and the turn-ending replies of all units. */
  window?: { list: Unit[]; finals: Set<string>; latest: boolean };
  onOpenLink?(href: string): void;
}) {
  const list = window?.list ?? units(items);
  const finals = window?.finals ?? (root ? finalReplies(list, live) : undefined);
  const renderThread = useCallback(
    (nested: SessionItem[]) => <Thread items={nested} live={live} onOpenLink={onOpenLink} />,
    [live, onOpenLink],
  );
  return (
    <>
      {list.map((unit, index) => {
        const last = live && index === list.length - 1 && (window?.latest ?? true);
        return (
          <div key={unit.key} data-unit={unit.key} {...stylex.props(styles.unit, motion.enter)}>
            {"explore" in unit ? (
              <Explore items={unit.explore} renderThread={renderThread} />
            ) : (
              <Item
                item={unit.item}
                last={last}
                final={finals?.has(unit.item.id) ?? false}
                renderThread={renderThread}
                onOpenLink={onOpenLink}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

const Item = memo(function Item({
  item,
  last,
  final,
  renderThread,
  onOpenLink,
}: {
  item: SessionItem;
  last: boolean;
  /** The reply that ends a turn, which has Copy and Pin to review. */
  final: boolean;
  renderThread(items: SessionItem[]): ReactNode;
  onOpenLink?(href: string): void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <div {...stylex.props(styles.userRow)}>
          {item.queued && <span {...stylex.props(styles.queued)}>Queued</span>}
          <div {...stylex.props(styles.user)}>
            {item.content.map((block, index) =>
              block.type === "text" ? (
                <p key={index} {...stylex.props(styles.userText)}>
                  {block.text}
                </p>
              ) : block.type === "image" ? (
                <img
                  key={index}
                  alt=""
                  src={`data:${block.mimeType};base64,${block.data}`}
                  {...stylex.props(styles.image)}
                />
              ) : null,
            )}
          </div>
          {item.sent && <Delivery message={item.sent} />}
        </div>
      );
    case "agent":
      return (
        <>
          <SessionMarkdown text={item.text} streaming={last} onOpenLink={onOpenLink} />
          <ReplyBar item={item} final={final && !last} />
        </>
      );
    case "thought":
      return <Thought item={item} />;
    case "tool":
      return <ToolCall item={item} renderThread={renderThread} />;
    case "notice":
      return (
        <div
          role={item.severity === "error" ? "alert" : undefined}
          {...stylex.props(styles.notice, item.severity === "error" && styles.noticeError)}
        >
          <Icon name="alert" size={13} />
          <span>{item.title}</span>
          {item.description && (
            <span {...stylex.props(styles.noticeDetail)}>{item.description}</span>
          )}
        </div>
      );
    case "compaction":
      return <Compaction summary={item.summary} failed={item.failed} />;
  }
});

/**
 * Copy and Pin to review under the reply that ends a turn. A pinned reply
 * keeps a Pinned mark wherever it is, which shows it in the Notes.
 */
function ReplyBar({ item, final }: { item: AgentItem; final: boolean }) {
  const actions = useContext(ReplyActionsContext);
  const [copied, setCopied] = useState(false);
  const [pinning, setPinning] = useState(false);
  const pinId = actions?.pinned(item.id);
  if (!final && pinId === undefined) return null;
  const copy = () =>
    navigator.clipboard.writeText(item.text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  return (
    <div {...stylex.props(styles.replyBar)}>
      {final && (
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy reply"}
          title="Copy reply"
          onClick={() => void copy()}
          {...stylex.props(styles.replyAction)}
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>
      )}
      {actions &&
        (pinId !== undefined ? (
          <button
            type="button"
            title="Show in Notes"
            onClick={() => actions.showPin(pinId)}
            {...stylex.props(styles.replyAction, styles.replyPinned)}
          >
            <Icon name="pin" size={13} />
            Pinned
          </button>
        ) : (
          <button
            type="button"
            disabled={pinning}
            title="Keep this reply in the review's Notes"
            onClick={() => {
              setPinning(true);
              actions.pin(item).finally(() => setPinning(false));
            }}
            {...stylex.props(styles.replyAction)}
          >
            <Icon name="pin" size={13} />
            Pin to review
          </button>
        ))}
    </div>
  );
}

const AGENT_NAMES = { claude: "Claude", codex: "Codex", acp: "the agent" } as const;

/** Where a message sent from Med is: waiting for the agent, taken, or queued. */
function Delivery({ message }: { message: AgentMessage }) {
  const agent = AGENT_NAMES[message.agent];
  const comments = message.noteIds.length;
  const extra = message.attachmentCount;
  const parts = [
    "Sent from Med",
    ...(comments && message.text ? [`${comments} ${comments === 1 ? "comment" : "comments"}`] : []),
    ...(extra ? [`${extra} ${extra === 1 ? "attachment" : "attachments"}`] : []),
    message.delivery === "pending"
      ? `Waiting for ${agent} to take it`
      : message.delivery === "delivered"
        ? `${agent} took it`
        : message.delivery === "queued"
          ? `Queued for ${agent}`
          : `Not sent: ${message.error ?? "an error occurred"}`,
  ];
  return (
    <span
      role={message.delivery === "failed" ? "alert" : undefined}
      {...stylex.props(styles.delivery, message.delivery === "failed" && styles.deliveryFailed)}
    >
      {message.delivery === "pending" && <span {...stylex.props(styles.pendingDot)} />}
      {parts.join(" · ")}
    </span>
  );
}

function Thought({ item }: { item: Extract<SessionItem, { kind: "thought" }> }) {
  const [open, setOpen] = useState(false);
  const text = item.text.trim();
  const seconds = Math.max(1, Math.round((item.durationMs ?? 0) / 1000));
  return (
    <div>
      <button
        type="button"
        disabled={!text}
        aria-expanded={text ? open : undefined}
        onClick={() => setOpen(!open)}
        {...stylex.props(rowStyles.row, styles.thought)}
      >
        <span {...stylex.props(rowStyles.icon)}>
          <Icon name="brief" size={14} />
        </span>
        {item.durationMs !== undefined ? `Thought for ${seconds}s` : "Thought"}
        {text && (
          <span {...stylex.props(styles.chevron, open && styles.chevronOpen)}>
            <Icon name="chevron" size={12} />
          </span>
        )}
      </button>
      {open && <p {...stylex.props(styles.thoughtText)}>{text}</p>}
    </div>
  );
}

function Explore({
  items,
  renderThread,
}: {
  items: ToolItem[];
  renderThread(items: SessionItem[]): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const running = items.some(
    (item) => item.call.status === "pending" || item.call.status === "in_progress",
  );
  const failed = items.filter((item) => item.call.status === "failed").length;
  const reads = items.filter((item) => item.call.kind === "read").length;
  const searches = items.length - reads;
  const parts = [
    reads && `${reads} ${reads === 1 ? "file" : "files"}`,
    searches && `${searches} ${searches === 1 ? "search" : "searches"}`,
  ].filter(Boolean);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...stylex.props(rowStyles.row, styles.groupHead)}
      >
        <span {...stylex.props(rowStyles.icon)}>
          <Icon name="search" size={14} />
        </span>
        <span {...stylex.props(running && motion.shimmer)}>
          <span {...stylex.props(styles.verb)}>{running ? "Exploring" : "Explored"} </span>
          {parts.join(", ")}
        </span>
        {failed > 0 && <span {...stylex.props(styles.groupFailed)}>{failed} failed</span>}
        <span {...stylex.props(styles.chevron, open && styles.chevronOpen)}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <div {...stylex.props(styles.group)}>
          {items.map((item) => (
            <ToolCall key={item.id} item={item} renderThread={renderThread} />
          ))}
        </div>
      )}
    </div>
  );
}

function Compaction({ summary, failed }: { summary?: string; failed?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        disabled={!summary}
        aria-expanded={summary ? open : undefined}
        onClick={() => setOpen(!open)}
        {...stylex.props(styles.compaction)}
      >
        <span {...stylex.props(styles.rule)} />
        {failed ? "Compaction failed" : "Context compacted"}
        <span {...stylex.props(styles.rule)} />
      </button>
      {open && summary && <p {...stylex.props(styles.thoughtText)}>{summary}</p>}
    </div>
  );
}

const PLAN_MARKS: Record<PlanEntry["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

/** The agent's task list, docked under the thread as in Claude Desktop. */
export function PlanDock({ entries }: { entries: PlanEntry[] }) {
  const [open, setOpen] = useState(true);
  const done = entries.filter((entry) => entry.status === "completed").length;
  const current = entries.find((entry) => entry.status === "in_progress");
  return (
    <section aria-label="Tasks" {...stylex.props(styles.plan)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...stylex.props(rowStyles.row, styles.planHead)}
      >
        <span {...stylex.props(rowStyles.icon)}>
          <Icon name="tasks" size={14} />
        </span>
        <span {...stylex.props(styles.verb)}>Tasks</span>
        <span {...stylex.props(styles.planCount)}>
          {done} of {entries.length}
        </span>
        {!open && current && <span {...stylex.props(styles.planCurrent)}>{current.content}</span>}
        <span {...stylex.props(styles.grow)} />
        <span {...stylex.props(styles.chevron, open ? styles.chevronOpen : styles.chevronUp)}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <ol {...stylex.props(styles.planList)}>
          {entries.map((entry, index) => (
            <li
              key={index}
              data-status={entry.status}
              {...stylex.props(
                styles.planEntry,
                entry.status === "completed" && styles.planDone,
                entry.status === "in_progress" && styles.planActive,
              )}
            >
              <span aria-hidden="true" {...stylex.props(styles.planMark)}>
                {PLAN_MARKS[entry.status]}
              </span>
              <span {...stylex.props(entry.status === "in_progress" && motion.shimmer)}>
                {entry.content}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * A session as a thread: the user's messages, the agent's replies and
 * thoughts, and its tool calls. The view stays at the newest item while the
 * reader is at the bottom; scrolling up stops it, and "Latest" returns.
 */
export function SessionThread({
  snapshot,
  now,
  before,
  earlier,
  reveal,
  onOpenLink,
}: {
  snapshot: SessionSnapshot;
  /** Shown above the first item, such as a note that earlier work is left out. */
  before?: ReactNode;
  /** Loads the page before the first update, while the host has earlier work. */
  earlier?: { load(): Promise<void>; loading: boolean; failed?: boolean };
  /** Scrolls to this item once for each nonce, such as a turn from the index. */
  reveal?: { id: string; nonce: number };
  /** The clock for the elapsed time of a running session. */
  now?: number;
  onOpenLink?(href: string): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // The render window: the last `size` units before the `skipEnd` newest
  // ones. Counted from the end, it stays put when an earlier page arrives.
  const all = useMemo(() => units(snapshot.items), [snapshot.items]);
  const finals = useMemo(() => finalReplies(all, snapshot.running), [all, snapshot.running]);
  const [view, setView] = useState({ size: WINDOW, skipEnd: 0 });
  const skipEnd = Math.min(view.skipEnd, Math.max(0, all.length - 1));
  const end = all.length - skipEnd;
  const begin = Math.max(0, end - view.size);
  const window = useMemo(
    () => ({ list: all.slice(begin, end), finals, latest: skipEnd === 0 }),
    [all, begin, end, finals, skipEnd],
  );
  const latest = useRef(true);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const moving = useRef(false);
  useLayoutEffect(() => {
    latest.current = skipEnd === 0;
    moving.current = false;
  });
  // The first unit in view keeps its place when the window changes above it.
  // Browser scroll anchoring does not apply at the top of the scroller.
  const anchor = useRef<{ key: string; top: number } | null>(null);
  const keepAnchor = useCallback(() => {
    const node = scroller.current;
    if (!node || !content.current) return;
    const frame = node.getBoundingClientRect().top;
    const first = [...content.current.children].find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.dataset.unit !== undefined &&
        element.getBoundingClientRect().bottom > frame,
    );
    anchor.current = first
      ? { key: first.dataset.unit!, top: first.getBoundingClientRect().top - frame }
      : null;
  }, []);
  useLayoutEffect(() => {
    const saved = anchor.current;
    const node = scroller.current;
    if (!saved || !node || !content.current) return;
    anchor.current = null;
    const element = [...content.current.children].find(
      (child) => child instanceof HTMLElement && child.dataset.unit === saved.key,
    );
    if (element)
      node.scrollTop +=
        element.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.top;
  }, [begin, skipEnd]);

  // Near the top, the window takes more units, then the earlier page. Near
  // the bottom of a window that left newer units out, it moves down.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const near = (element: HTMLElement | null, side: "top" | "bottom") => {
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const frame = node.getBoundingClientRect();
      const margin = frame.height * 2;
      return side === "top" ? box.bottom >= frame.top - margin : box.top <= frame.bottom + margin;
    };
    const check = () => {
      if (moving.current) return;
      if (near(top.current, "top")) {
        if (begin > 0) {
          moving.current = true;
          keepAnchor();
          setView((current) => {
            const size = current.size + STEP;
            return size > MAX_UNITS
              ? { size: MAX_UNITS, skipEnd: current.skipEnd + size - MAX_UNITS }
              : { size, skipEnd: current.skipEnd };
          });
        } else if (earlier && !earlier.loading && !earlier.failed) {
          keepAnchor();
          void earlier.load();
        }
      } else if (skipEnd > 0 && near(bottom.current, "bottom")) {
        moving.current = true;
        keepAnchor();
        setView((current) => ({ ...current, skipEnd: Math.max(0, current.skipEnd - STEP) }));
      }
    };
    check();
    node.addEventListener("scroll", check, { passive: true });
    return () => node.removeEventListener("scroll", check);
  }, [begin, skipEnd, earlier, keepAnchor]);

  // A turn from the index: bring its unit into the window, then into view.
  const [handled, setHandled] = useState<number | undefined>(undefined);
  const target =
    reveal && reveal.nonce !== handled
      ? all.findIndex((unit) =>
          "item" in unit
            ? unit.item.id === reveal.id
            : unit.explore.some((item) => item.id === reveal.id),
        )
      : -1;
  if (reveal && target >= 0) {
    setHandled(reveal.nonce);
    if (target < begin || target >= end)
      setView({ size: WINDOW, skipEnd: Math.max(0, all.length - target - WINDOW / 2) });
  }
  const scrolled = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!reveal || handled !== reveal.nonce || scrolled.current === reveal.nonce) return;
    const element = scroller.current?.querySelector(
      `[data-unit="${CSS.escape(reveal.id)}"], [data-unit="${CSS.escape(`explore-${reveal.id}`)}"]`,
    );
    if (!element) return;
    scrolled.current = reveal.nonce;
    stuck.current = false;
    element.scrollIntoView({ block: "start" });
  }, [reveal, handled, begin, end]);

  useLayoutEffect(() => {
    const node = scroller.current;
    const inner = content.current;
    if (!node || !inner) return;
    // The view follows new items while the reader stays at the bottom. Only
    // a move up stops it: a scroll event can arrive after the thread grew and
    // before the view followed, and rows that fold into a group make the
    // thread shorter, which moves the view up but leaves it at the end.
    let top = node.scrollTop;
    // The end of a window that leaves newer units out is not the latest.
    const atEnd = () =>
      latest.current && node.scrollHeight - node.scrollTop - node.clientHeight < 32;
    const check = () => {
      if (atEnd()) stuck.current = true;
      else if (node.scrollTop + 1 < top) stuck.current = false;
      top = node.scrollTop;
    };
    const follow = () => {
      check();
      if (stuck.current) node.scrollTop = node.scrollHeight;
      top = node.scrollTop;
      setAtBottom(stuck.current);
    };
    const onScroll = () => {
      check();
      setAtBottom(stuck.current);
    };
    const observer = new ResizeObserver(follow);
    observer.observe(inner);
    node.addEventListener("scroll", onScroll, { passive: true });
    follow();
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", onScroll);
    };
  }, []);

  const last = snapshot.items.at(-1);
  const thinking = snapshot.running && last?.kind === "thought" && last.durationMs === undefined;
  const elapsed =
    snapshot.startedAt !== undefined ? (now ?? snapshot.updatedAt ?? 0) - snapshot.startedAt : 0;

  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.viewport)}>
        <div ref={scroller} {...stylex.props(styles.scroller)}>
          <div
            ref={content}
            {...stylex.props(styles.content)}
            role="log"
            aria-label="Session"
            aria-live="polite"
            aria-busy={snapshot.running}
          >
            {begin > 0 || earlier ? (
              <div ref={top} {...stylex.props(styles.edge)}>
                {begin === 0 && earlier && (
                  <button
                    type="button"
                    disabled={earlier.loading}
                    onClick={() => void earlier.load()}
                    {...stylex.props(styles.earlier)}
                  >
                    {earlier.loading
                      ? "Loading earlier work…"
                      : earlier.failed
                        ? "Earlier work did not load. Try again"
                        : "Load earlier work"}
                  </button>
                )}
              </div>
            ) : (
              before
            )}
            <ThreadScroller value={scroller}>
              <Thread
                items={snapshot.items}
                live={snapshot.running}
                root
                window={window}
                onOpenLink={onOpenLink}
              />
            </ThreadScroller>
            {skipEnd > 0 && <div ref={bottom} {...stylex.props(styles.edge)} />}
            {skipEnd > 0 ? null : snapshot.running ? (
              <div {...stylex.props(rowStyles.row, styles.status)}>
                <span {...stylex.props(rowStyles.icon)}>
                  <span {...stylex.props(motion.spinner)} />
                </span>
                <span {...stylex.props(motion.shimmer)}>{thinking ? "Thinking" : "Working"}</span>
                <span {...stylex.props(styles.elapsed)}>{formatSeconds(Math.max(0, elapsed))}</span>
              </div>
            ) : (
              snapshot.items.length > 0 && (
                <div {...stylex.props(styles.done)}>
                  <span {...stylex.props(styles.rule)} />
                  Worked for {formatSeconds(elapsed)}
                  {snapshot.toolCalls > 0 &&
                    ` · ${snapshot.toolCalls} tool ${snapshot.toolCalls === 1 ? "call" : "calls"}`}
                  <span {...stylex.props(styles.rule)} />
                </div>
              )
            )}
          </div>
        </div>
        {(!atBottom || skipEnd > 0) && (
          <button
            type="button"
            onClick={() => {
              const node = scroller.current;
              if (!node) return;
              setView({ size: WINDOW, skipEnd: 0 });
              latest.current = true;
              stuck.current = true;
              node.scrollTop = node.scrollHeight;
            }}
            {...stylex.props(styles.latest)}
          >
            <Icon name="arrowDown" size={12} />
            Latest
          </button>
        )}
      </div>
      <BackgroundDock items={snapshot.items} now={now ?? snapshot.updatedAt} />
      {snapshot.plan.length > 0 && <PlanDock entries={snapshot.plan} />}
    </div>
  );
}

const styles = stylex.create({
  frame: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
  },
  viewport: {
    position: "relative",
    flex: "1",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  scroller: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    // Rows above the view take their real height when they first render;
    // anchoring keeps the rows in view still.
    overflowAnchor: "auto",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingBlock: 20,
    paddingInline: 18,
  },
  // Window edges are never the scroll anchor, so the rows in view stay put.
  edge: { minHeight: 1, overflowAnchor: "none", display: "flex", justifyContent: "center" },
  earlier: {
    marginBlock: 4,
    paddingBlock: 4,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: { default: tokens.fill, ":hover": tokens.lineStrong },
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: { default: "pointer", ":disabled": "default" },
  },
  // Rows out of view skip layout and paint; a long thread scrolls at frame rate.
  unit: { minWidth: 0, contentVisibility: "auto", containIntrinsicSize: "auto 60px" },
  replyBar: { display: "flex", alignItems: "center", gap: 2, marginTop: 4, marginInline: -6 },
  replyAction: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 24,
    minWidth: 24,
    justifyContent: "center",
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text, ":disabled": tokens.faint },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: { default: "pointer", ":disabled": "default" },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    transitionProperty: "background-color, color",
    transitionDuration: "120ms",
  },
  replyPinned: { color: { default: tokens.accent, ":hover": tokens.accent } },
  userRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
    marginBlock: 10,
  },
  user: {
    maxWidth: "86%",
    paddingBlock: 9,
    paddingInline: 13,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.text,
  },
  userText: {
    margin: 0,
    fontFamily: "var(--med-font-prose)",
    fontSize: 13.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  image: { display: "block", maxWidth: "100%", borderRadius: `calc(6px * ${tokens.round})` },
  queued: { color: tokens.faint, fontSize: 11 },
  delivery: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    maxWidth: "86%",
    color: tokens.faint,
    fontSize: 11,
    textAlign: "right",
  },
  deliveryFailed: { color: tokens.red },
  pendingDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
  },
  verb: { color: tokens.text, fontWeight: 500 },
  thought: { color: tokens.faint, cursor: { default: "pointer", ":disabled": "default" } },
  thoughtText: {
    margin: 0,
    marginInlineStart: 24,
    marginBlock: 4,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  groupHead: { cursor: "pointer" },
  groupFailed: { color: tokens.red, fontSize: 11.5 },
  group: { display: "flex", flexDirection: "column", paddingInlineStart: 12 },
  chevron: {
    display: "flex",
    color: tokens.faint,
    transform: "rotate(-90deg)",
    transitionProperty: "transform",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
  },
  chevronOpen: { transform: "rotate(0deg)" },
  chevronUp: { transform: "rotate(180deg)" },
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 28,
    color: tokens.warning,
    fontSize: 12.5,
  },
  noticeError: { color: tokens.red },
  noticeDetail: { color: tokens.faint },
  compaction: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    marginBlock: 8,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: { default: "pointer", ":disabled": "default" },
  },
  rule: { flex: "1", height: 1, backgroundColor: tokens.line },
  status: { color: tokens.muted, marginTop: 4 },
  elapsed: { color: tokens.faint, fontVariantNumeric: "tabular-nums" },
  done: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  latest: {
    position: "absolute",
    insetInline: 0,
    bottom: 12,
    marginInline: "auto",
    width: "fit-content",
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    paddingInline: 11,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.raised,
    boxShadow: `${tokens.shadow}, inset 0 0 0 1px ${tokens.line}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    zIndex: 1,
  },
  plan: {
    flexShrink: 0,
    marginInline: 12,
    marginBottom: 10,
    paddingInline: 10,
    paddingBlock: 2,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  planHead: { cursor: "pointer", gap: 8 },
  planCount: { color: tokens.faint, fontVariantNumeric: "tabular-nums" },
  planCurrent: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
  },
  grow: { flex: "1" },
  planList: {
    listStyle: "none",
    margin: 0,
    paddingTop: 0,
    paddingBottom: 8,
    paddingInline: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  planEntry: { display: "flex", gap: 8, color: tokens.muted },
  planDone: {
    color: tokens.faint,
    textDecoration: "line-through",
    textDecorationColor: tokens.lineStrong,
  },
  planActive: { color: tokens.text },
  planMark: { width: 16, flexShrink: 0, textAlign: "center", color: tokens.accent, fontSize: 11 },
});
