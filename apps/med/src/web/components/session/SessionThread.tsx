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
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { AgentMessage } from "../../../shared/agent-inbox";
import type { PlanEntry } from "../../../shared/agent-session";
import type { SessionItem, SessionSnapshot } from "../../data/session-store";
import { renderBrief } from "../../markdown/brief-render";
import { tokens } from "../../theme.stylex";
import { useTheme } from "../../themes";
import { Icon } from "../Icon";
import { motion, rowStyles } from "./session-styles";
import { BackgroundDock } from "./BackgroundDock";
import { SessionMarkdown } from "./SessionMarkdown";
import { formatSeconds, RowOpen, ToolCall, useRowOpen } from "./ToolCall";
import { finalReplies, lastTurn, units, type ToolItem, type Unit } from "./thread-model";
import {
  estimateUnit,
  readMetrics,
  resetHeights,
  roughUnit,
  type ThreadMetrics,
} from "./thread-heights";
import "./SessionThread.css";

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

/** A subagent's own steps, inside the call that started it. */
function Thread({
  items,
  live,
  onOpenLink,
}: {
  items: SessionItem[];
  live: boolean;
  onOpenLink?(href: string): void;
}) {
  const list = units(items);
  const renderThread = useCallback(
    (nested: SessionItem[]) => <Thread items={nested} live={live} onOpenLink={onOpenLink} />,
    [live, onOpenLink],
  );
  return (
    <>
      {list.map((unit, index) => (
        <div key={unit.key} {...stylex.props(styles.nestedUnit, motion.enter)}>
          <UnitBody
            unit={unit}
            last={live && index === list.length - 1}
            final={false}
            renderThread={renderThread}
            onOpenLink={onOpenLink}
          />
        </div>
      ))}
    </>
  );
}

function UnitBody({
  unit,
  last,
  final,
  renderThread,
  onOpenLink,
}: {
  unit: Unit;
  last: boolean;
  final: boolean;
  renderThread(items: SessionItem[]): ReactNode;
  onOpenLink?(href: string): void;
}) {
  return "explore" in unit ? (
    <Explore groupKey={unit.key} items={unit.explore} renderThread={renderThread} />
  ) : (
    <Item
      item={unit.item}
      last={last}
      final={final}
      renderThread={renderThread}
      onOpenLink={onOpenLink}
    />
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
      return <Compaction id={item.id} summary={item.summary} failed={item.failed} />;
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
  const [open, setOpen] = useRowOpen(item.id, false);
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
  groupKey,
  items,
  renderThread,
}: {
  groupKey: string;
  items: ToolItem[];
  renderThread(items: SessionItem[]): ReactNode;
}) {
  const [open, setOpen] = useRowOpen(groupKey, false);
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

function Compaction({ id, summary, failed }: { id: string; summary?: string; failed?: boolean }) {
  const [open, setOpen] = useRowOpen(id, false);
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

/** Space that renders above and below the view, and the least that must stay
 * rendered past each edge before the rendered range moves. */
const OVERSCAN = 1200;
const MARGIN = 400;
/** The newest units render before the thread has a size, as in a hidden pane. */
const UNSIZED = 24;
/** The newest units measure their text at once; the others in idle time. */
const EXACT = 150;
/** Replies past each end of the rendered range render their Markdown ahead. */
const AHEAD = 8;
/** The view loads the page before the first update within this many screens of it. */
const EARLIER_SCREENS = 2;

/** The unit at height `y` of the list: the last one that starts at or above it. */
function indexAt(offsets: Float64Array, y: number) {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= y) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

/** The item that a measured height belongs to: a group grows with its last call. */
const sourceOf = (unit: Unit): object => ("item" in unit ? unit.item : unit.explore.at(-1)!);

interface Range {
  start: number;
  end: number;
  /** The first unit when the range was set, so that an earlier page moves it. */
  first?: string;
  /** The range ends with the newest unit, and takes new ones. */
  tail: boolean;
}

/**
 * A session as a thread: the user's messages, the agent's replies and
 * thoughts, and its tool calls. The view stays at the newest item while the
 * reader is at the bottom; scrolling up stops it, and "Latest" returns.
 *
 * Only the units near the view render. Each other unit takes its height from
 * when it last rendered, or from an estimate (thread-heights.ts), and spacers
 * above and below hold that space. The first unit in view keeps its place
 * when heights above it change.
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
  const probe = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const { active: theme } = useTheme();
  const [rows] = useState(() => new Map<string, boolean>());

  const all = useMemo(() => units(snapshot.items), [snapshot.items]);
  const finals = useMemo(() => finalReplies(all, snapshot.running), [all, snapshot.running]);

  // Heights: a unit's own from when it last rendered, else an estimate.
  const [metrics, setMetrics] = useState<ThreadMetrics | null>(null);
  const [version, setVersion] = useState(0);
  const [heights] = useState(() => ({
    /** Heights of units as they last rendered. */
    measured: new Map<string, { source: object; height: number }>(),
    /** Units on screen. */
    elements: new Map<string, HTMLElement>(),
    estimates: new WeakMap<
      object,
      { metrics: ThreadMetrics; open?: boolean; final: boolean; height: number }
    >(),
  }));
  const model = useMemo(() => {
    const offsets = new Float64Array(all.length + 1);
    const index = new Map<string, number>();
    // Units with a quick height, which wait for idle time to measure their text.
    let rough = 0;
    const heightOf = (unit: Unit, m: ThreadMetrics, at: number) => {
      const source = sourceOf(unit);
      const seen = heights.measured.get(unit.key);
      // A rendered unit's height is the one on screen, even before it
      // measures again after a change.
      if (seen && (seen.source === source || heights.elements.has(unit.key))) return seen.height;
      const open = "item" in unit ? rows.get(unit.item.id) : undefined;
      const final = "item" in unit && finals.has(unit.item.id);
      const known = heights.estimates.get(source);
      if (known && known.metrics === m && known.open === open && known.final === final)
        return known.height;
      if (at < all.length - EXACT) {
        rough++;
        return roughUnit(unit, m, { open, final });
      }
      const height = estimateUnit(unit, m, { open, final });
      heights.estimates.set(source, { metrics: m, open, final, height });
      return height;
    };
    for (let at = 0; at < all.length; at++) {
      const unit = all[at]!;
      index.set(unit.key, at);
      offsets[at + 1] = offsets[at]! + (metrics ? heightOf(unit, metrics, at) : 0);
    }
    return { all, offsets, index, rough, version };
  }, [all, finals, metrics, rows, version, heights]);

  // In idle time, units with a quick height measure their text, the newest
  // first; the view keeps its place as their heights change.
  useEffect(() => {
    if (!metrics || !model.rough) return;
    const run = (deadline?: IdleDeadline) => {
      const until = performance.now() + Math.min(8, deadline?.timeRemaining() ?? 8);
      let done = 0;
      for (let at = all.length - 1; at >= 0 && performance.now() < until; at--) {
        const unit = all[at]!;
        const source = sourceOf(unit);
        const open = "item" in unit ? rows.get(unit.item.id) : undefined;
        const final = "item" in unit && finals.has(unit.item.id);
        const known = heights.estimates.get(source);
        if (known && known.metrics === metrics && known.open === open && known.final === final)
          continue;
        const height = estimateUnit(unit, metrics, { open, final });
        heights.estimates.set(source, { metrics, open, final, height });
        done++;
      }
      if (done) setVersion((value) => value + 1);
    };
    if (!("requestIdleCallback" in globalThis)) {
      const timer = setTimeout(run, 50);
      return () => clearTimeout(timer);
    }
    const id = requestIdleCallback(run, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }, [model, metrics, all, finals, rows, heights]);

  // The rendered range. Before the thread has a size, the newest units.
  const [range, setRange] = useState<Range | null>(null);
  const count = all.length;
  let start = Math.max(0, count - UNSIZED);
  let end = count;
  if (metrics && range) {
    const shift = range.first ? (model.index.get(range.first) ?? 0) : 0;
    start = Math.min(count, range.start + shift);
    end = range.tail ? count : Math.min(count, range.end + shift);
  }

  // Units that come at the end of the thread rise in once. Units that were
  // there when it opened, earlier pages, and units that scroll back in do not.
  const [previous, setPrevious] = useState(all);
  const [appended, setAppended] = useState<ReadonlySet<string>>(() => new Set());
  if (previous !== all) {
    setPrevious(all);
    const known = new Set(previous.map((unit) => unit.key));
    const next = new Set<string>();
    if (previous.length)
      for (let at = all.length - 1; at >= 0 && !known.has(all[at]!.key); at--)
        next.add(all[at]!.key);
    setAppended(next);
  }

  // The latest values for the scroll and resize handlers.
  const latest = useRef({ model, metrics, range: { start, end }, earlier });
  useLayoutEffect(() => {
    latest.current = { model, metrics, range: { start, end }, earlier };
  });

  // The first unit that starts in view, and how far the view is below its
  // top: negative when the view starts above it.
  const anchor = useRef<{ key: string; delta: number } | null>(null);
  const list = useRef<{
    record(): void;
    restore(): void;
    place(sync: boolean): void;
    loadEarlier(): void;
  } | null>(null);
  // Units on screen report later changes, as when their Markdown arrives.
  const observer = useRef<ResizeObserver | null>(null);
  const onResize = useCallback(
    (entries: ResizeObserverEntry[]) => {
      if (!scroller.current?.clientHeight) return;
      const { all, offsets, index } = latest.current.model;
      let changed = false;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const at = index.get(element.dataset.unit!);
        const height = entry.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
        if (at === undefined || !height) continue;
        heights.measured.set(all[at]!.key, { source: sourceOf(all[at]!), height });
        if (Math.abs(height - (offsets[at + 1]! - offsets[at]!)) > 0.01) changed = true;
      }
      if (changed) flushSync(() => setVersion((value) => value + 1));
    },
    [heights],
  );
  const rise = useMemo(
    () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== true,
    [],
  );
  const unitRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const key = element.dataset.unit!;
      heights.elements.set(key, element);
      observer.current ??= new ResizeObserver(onResize);
      observer.current.observe(element);
      if (element.dataset.rise !== undefined && rise)
        element.animate(
          [
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
        );
      return () => {
        observer.current?.unobserve(element);
        if (heights.elements.get(key) === element) heights.elements.delete(key);
      };
    },
    [onResize, heights, rise],
  );
  useEffect(() => {
    for (const element of heights.elements.values()) observer.current?.observe(element);
    return () => observer.current?.disconnect();
  }, [heights]);

  // The thread's sizes come from a hidden sample of its parts. They change
  // with the width, the theme, and fonts that finish loading.
  const readProbe = useCallback(
    (force = false) => {
      const element = probe.current;
      if (!element?.clientWidth) return;
      const next = readMetrics(element);
      const current = latest.current.metrics;
      if (!force && current && JSON.stringify(current) === JSON.stringify(next)) return;
      // Heights of units out of view were for the old width or fonts.
      for (const key of heights.measured.keys())
        if (!heights.elements.has(key)) heights.measured.delete(key);
      setMetrics(next);
    },
    [heights],
  );
  useLayoutEffect(() => readProbe(), [theme, readProbe]);
  useEffect(() => {
    const element = probe.current;
    if (!element) return;
    const resize = new ResizeObserver(() => readProbe());
    resize.observe(element);
    const fonts = element.ownerDocument.fonts;
    const loaded = () => {
      resetHeights();
      readProbe(true);
    };
    fonts.addEventListener("loadingdone", loaded);
    return () => {
      resize.disconnect();
      fonts.removeEventListener("loadingdone", loaded);
    };
  }, [readProbe]);

  useLayoutEffect(() => {
    const node = scroller.current;
    const inner = content.current;
    if (!node || !inner) return;
    // The view follows new items while the reader stays at the bottom. Only
    // the reader's move up stops it. The view also moves up when the thread
    // gets shorter, even for a moment within one frame: rows fold into a
    // group, rows take their real height, a part loads.
    let top = node.scrollTop;
    // When the reader last scrolled, and whether a pointer is down in the thread.
    let input = Number.NEGATIVE_INFINITY;
    let pressed = false;
    const atEnd = () => node.scrollHeight - node.scrollTop - node.clientHeight < 32;
    const listTop = () => head.current?.offsetTop ?? 0;
    const check = () => {
      if (atEnd()) stuck.current = true;
      else if (node.scrollTop + 1 < top && (pressed || performance.now() - input < 500))
        stuck.current = false;
      top = node.scrollTop;
    };
    // Where the view was when its anchor was recorded or kept.
    let recorded = node.scrollTop;
    const record = () => {
      recorded = node.scrollTop;
      const { all, offsets } = latest.current.model;
      if (!all.length || !latest.current.metrics) return;
      const y = node.scrollTop - listTop();
      let at = indexAt(offsets, y);
      // As in the browser's own anchoring, the first unit that starts in
      // view: a unit cut at the top can still change, as when its Markdown
      // arrives, and the reader's place would move with its end.
      if (offsets[at]! < y && at + 1 < all.length && offsets[at + 1]! < y + node.clientHeight) at++;
      anchor.current = { key: all[at]!.key, delta: y - offsets[at]! };
    };
    // Browser scroll anchoring is off: it would count the spacers. The view
    // keeps its first unit in place itself, or the end while it follows.
    const restore = () => {
      if (!node.clientHeight) return;
      // The view moved since its anchor: a reader's scroll whose event has
      // not come yet, or the browser's clamp. The new place is the anchor.
      if (Math.abs(node.scrollTop - recorded) > 1) {
        check();
        if (!stuck.current) {
          record();
          return;
        }
      }
      if (stuck.current) {
        node.scrollTop = node.scrollHeight;
        recorded = node.scrollTop;
        return;
      }
      const saved = anchor.current;
      if (!saved) return;
      const { offsets, index } = latest.current.model;
      const at = index.get(saved.key) ?? index.get(`explore-${saved.key}`);
      if (at === undefined) return;
      const target = listTop() + offsets[at]! + saved.delta;
      if (Math.abs(node.scrollTop - target) > 1) node.scrollTop = target;
      recorded = node.scrollTop;
    };
    const place = (sync: boolean) => {
      const { model, metrics, range } = latest.current;
      if (!metrics || !node.clientHeight) return;
      const { offsets, all } = model;
      const total = all.length;
      const y = node.scrollTop - listTop();
      const height = node.clientHeight;
      // The range covers the view with a margin on each side, and not much
      // more: units that come at the end join it, and it must not grow.
      const covered =
        range.end <= total &&
        range.start < range.end &&
        (range.start === 0 || offsets[range.start]! <= y - MARGIN) &&
        (range.end === total || offsets[range.end]! >= y + height + MARGIN) &&
        offsets[range.start]! >= y - 2 * OVERSCAN &&
        offsets[range.end]! <= y + height + 2 * OVERSCAN;
      if (covered || !total) return;
      const next: Range = {
        start: indexAt(offsets, y - OVERSCAN),
        end: Math.min(total, indexAt(offsets, y + height + OVERSCAN) + 1),
        first: all[0]?.key,
        tail: false,
      };
      next.tail = next.end === total;
      if (sync) flushSync(() => setRange(next));
      else setRange(next);
    };
    // One request for each state of the earlier work: the new state comes
    // after a render, and scroll events come before it.
    let requested: unknown;
    const loadEarlier = () => {
      const more = latest.current.earlier;
      if (!more || more.loading || more.failed || more === requested || !node.clientHeight) return;
      // A thread that follows the latest opens at the top of its content and
      // then moves to the end. Until it is there, the top is no reason to
      // load earlier work: the view would stay with it, mid-session.
      if (stuck.current && !atEnd()) return;
      if (node.scrollTop - listTop() > node.clientHeight * EARLIER_SCREENS) return;
      requested = more;
      record();
      void more.load();
    };
    list.current = { record, restore, place, loadEarlier };
    const follow = () => {
      check();
      if (stuck.current) node.scrollTop = node.scrollHeight;
      top = node.scrollTop;
      if (stuck.current) recorded = top;
      setAtBottom(stuck.current);
    };
    const onScroll = () => {
      check();
      setAtBottom(stuck.current);
      record();
      place(true);
      loadEarlier();
    };
    const onInput = () => {
      input = performance.now();
    };
    const onPress = () => {
      pressed = true;
    };
    const onRelease = () => {
      pressed = false;
      onInput();
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (
        ["ArrowUp", "PageUp", "Home", "Tab"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      )
        onInput();
    };
    const doc = node.ownerDocument;
    const resize = new ResizeObserver(follow);
    resize.observe(inner);
    resize.observe(node);
    node.addEventListener("scroll", onScroll, { passive: true });
    node.addEventListener("wheel", onInput, { passive: true });
    node.addEventListener("touchmove", onInput, { passive: true });
    node.addEventListener("pointerdown", onPress);
    doc.addEventListener("pointerup", onRelease);
    doc.addEventListener("pointercancel", onRelease);
    doc.addEventListener("keydown", onKey);
    follow();
    return () => {
      list.current = null;
      resize.disconnect();
      node.removeEventListener("scroll", onScroll);
      node.removeEventListener("wheel", onInput);
      node.removeEventListener("touchmove", onInput);
      node.removeEventListener("pointerdown", onPress);
      doc.removeEventListener("pointerup", onRelease);
      doc.removeEventListener("pointercancel", onRelease);
      doc.removeEventListener("keydown", onKey);
    };
  }, []);

  // A turn from the index: its unit goes to the top of the view.
  const [handled, setHandled] = useState<{ nonce: number; key: string } | undefined>(undefined);
  if (reveal && reveal.nonce !== handled?.nonce && metrics) {
    const key = all.find((unit) =>
      "item" in unit
        ? unit.item.id === reveal.id
        : unit.explore.some((item) => item.id === reveal.id),
    )?.key;
    if (key !== undefined) setHandled({ nonce: reveal.nonce, key });
  }
  const revealed = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!handled || revealed.current === handled.nonce) return;
    revealed.current = handled.nonce;
    stuck.current = false;
    anchor.current = { key: handled.key, delta: 0 };
  }, [handled]);

  // After a render: units that rendered take their own heights; then the
  // view keeps its place, the range follows the view, and the view loads
  // earlier work near the top.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node?.clientHeight || !metrics) return;
    const { offsets, index } = model;
    let changed = false;
    for (const [key, element] of heights.elements) {
      const at = index.get(key);
      const height = element.getBoundingClientRect().height;
      if (at === undefined || !height) continue;
      heights.measured.set(key, { source: sourceOf(all[at]!), height });
      if (Math.abs(height - (offsets[at + 1]! - offsets[at]!)) > 0.01) changed = true;
    }
    if (changed) {
      // Heights exist only after layout, so they are read after commit.
      // oxlint-disable-next-line react/set-state-in-effect
      setVersion((value) => value + 1);
      return;
    }
    list.current?.restore();
    list.current?.place(false);
    list.current?.loadEarlier();
  }, [model, all, start, end, metrics, heights, handled, earlier]);

  // The Markdown of replies just past the rendered range renders ahead in
  // the worker, so they show formatted when they scroll in.
  useEffect(() => {
    if (!metrics) return;
    for (const unit of [
      ...all.slice(Math.max(0, start - AHEAD), start),
      ...all.slice(end, end + AHEAD),
    ])
      if ("item" in unit && unit.item.kind === "agent")
        void renderBrief(theme.pierreTheme, unit.item.text, false, { cache: "session" }).catch(
          () => {},
        );
  }, [all, start, end, metrics, theme.pierreTheme]);

  const renderThread = useCallback(
    (nested: SessionItem[]) => (
      <Thread items={nested} live={snapshot.running} onOpenLink={onOpenLink} />
    ),
    [snapshot.running, onOpenLink],
  );

  const last = snapshot.items.at(-1);
  const thinking = snapshot.running && last?.kind === "thought" && last.durationMs === undefined;
  const turn = useMemo(
    () => lastTurn(snapshot.items, snapshot.startedAt),
    [snapshot.items, snapshot.startedAt],
  );
  const elapsed =
    turn.startedAt !== undefined ? (now ?? snapshot.updatedAt ?? 0) - turn.startedAt : 0;
  const offsets = model.offsets;
  const above = metrics ? offsets[start]! : 0;
  const below = metrics ? offsets[count]! - offsets[end]! : 0;

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
            <ThreadProbe probe={probe} />
            {earlier ? (
              <div {...stylex.props(styles.edge)}>
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
              </div>
            ) : (
              before
            )}
            <div ref={head} {...stylex.props(styles.space(above))} />
            <RowOpen value={rows}>
              {all.slice(start, end).map((unit, offset) => {
                const at = start + offset;
                return (
                  <div
                    key={unit.key}
                    ref={unitRef}
                    data-unit={unit.key}
                    data-rise={appended.has(unit.key) ? "" : undefined}
                    {...stylex.props(styles.unit)}
                  >
                    <UnitBody
                      unit={unit}
                      last={snapshot.running && at === count - 1}
                      final={"item" in unit && finals.has(unit.item.id)}
                      renderThread={renderThread}
                      onOpenLink={onOpenLink}
                    />
                  </div>
                );
              })}
            </RowOpen>
            <div {...stylex.props(styles.space(below))} />
            {snapshot.running ? (
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
                  {turn.toolCalls > 0 &&
                    ` · ${turn.toolCalls} tool ${turn.toolCalls === 1 ? "call" : "calls"}`}
                  <span {...stylex.props(styles.rule)} />
                </div>
              )
            )}
          </div>
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={() => {
              const node = scroller.current;
              if (!node) return;
              stuck.current = true;
              setAtBottom(true);
              node.scrollTop = node.scrollHeight;
              list.current?.record();
              list.current?.place(true);
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

/** A long line for the widest prompt bubble. */
const PROBE_LINE = "Probe ".repeat(80);

/** Hidden samples of the thread's parts, from which the height estimates
 * read the current theme's fonts, line heights, and margins. */
function ThreadProbe({ probe }: { probe: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={probe} aria-hidden="true" {...stylex.props(styles.probe)}>
      <div data-probe="unit" {...stylex.props(styles.unit)} />
      <div data-probe="reply" className="med-md-prose med-session-prose">
        <div className="med-md-block">
          <p data-probe="p">
            Probe <strong data-probe="strong">probe</strong> <em data-probe="em">probe</em>{" "}
            <code data-probe="code">probe</code>
          </p>
        </div>
        <div className="med-md-block">
          <p data-probe="pcode">
            <code>Probe</code>
          </p>
        </div>
        <div className="med-md-block">
          <h2 data-probe="h">Probe</h2>
        </div>
        <div className="med-md-block">
          <h4 data-probe="h4">Probe</h4>
        </div>
        <div className="med-md-block">
          <ul data-probe="ul">
            <li data-probe="li">Probe</li>
          </ul>
        </div>
        <div className="med-md-block">
          <ul>
            <li>
              <p data-probe="lip">Probe</p>
            </li>
          </ul>
        </div>
        <div className="med-md-block">
          <pre data-probe="pre1">
            <code>Probe</code>
          </pre>
        </div>
        <div className="med-md-block">
          <pre data-probe="pre3">
            <code>{"Probe\nProbe\nProbe"}</code>
          </pre>
        </div>
        <div className="med-md-block">
          <blockquote data-probe="quote">
            <p>Probe</p>
          </blockquote>
        </div>
        <div className="med-md-block">
          <hr data-probe="hr" />
        </div>
        <div className="med-md-block">
          <table data-probe="table">
            <thead>
              <tr>
                <th data-probe="th">Probe</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td data-probe="td">Probe</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* The last block loses its bottom margin; the samples above keep theirs. */}
        <div className="med-md-block">
          <p>Probe</p>
        </div>
      </div>
      <div data-probe="bar" {...stylex.props(styles.replyBar)}>
        <span {...stylex.props(styles.replyAction)}>Probe</span>
      </div>
      <div data-probe="user" {...stylex.props(styles.userRow)}>
        <div data-probe="bubble" {...stylex.props(styles.user)}>
          <p data-probe="userText" {...stylex.props(styles.userText)}>
            {PROBE_LINE}
          </p>
        </div>
      </div>
      <button type="button" tabIndex={-1} data-probe="row" {...stylex.props(rowStyles.row)}>
        Probe
      </button>
      <button
        type="button"
        tabIndex={-1}
        data-probe="compaction"
        {...stylex.props(styles.compaction)}
      >
        Probe
      </button>
      <div data-probe="diff" {...stylex.props(styles.probeCode)}>
        Probe
      </div>
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
    // The thread keeps its own anchor; see SessionThread.
    overflowAnchor: "none",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
  },
  content: {
    position: "relative",
    paddingBlock: 20,
    paddingInline: 18,
  },
  edge: { display: "flex", justifyContent: "center", paddingBottom: 6 },
  space: (height: number) => ({ height }),
  probe: {
    position: "absolute",
    top: 0,
    insetInline: 18,
    height: 0,
    overflow: "hidden",
    visibility: "hidden",
    pointerEvents: "none",
  },
  probeCode: { fontFamily: tokens.code, fontSize: 11.5, lineHeight: "18px" },
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
  // A unit holds its children's margins, so its height is all of its space.
  unit: { display: "flow-root", minWidth: 0, paddingBottom: 6 },
  nestedUnit: { minWidth: 0 },
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
