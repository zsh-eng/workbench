import * as stylex from "@stylexjs/stylex";
import { memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AgentMessage } from "../../../shared/agent-inbox";
import type { PlanEntry } from "../../../shared/agent-session";
import type { SessionItem, SessionSnapshot } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { motion, rowStyles } from "./session-styles";
import { BackgroundDock } from "./BackgroundDock";
import { SessionMarkdown } from "./SessionMarkdown";
import { formatSeconds, ToolCall } from "./ToolCall";
import "./SessionThread.css";

type ToolItem = Extract<SessionItem, { kind: "tool" }>;
type Unit = { key: string; item: SessionItem } | { key: string; explore: ToolItem[] };

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
      {list.map((unit, index) => {
        const last = live && index === list.length - 1;
        return (
          <div key={unit.key} {...stylex.props(styles.unit, motion.enter)}>
            {"explore" in unit ? (
              <Explore items={unit.explore} renderThread={renderThread} />
            ) : (
              <Item
                item={unit.item}
                last={last}
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
  renderThread,
  onOpenLink,
}: {
  item: SessionItem;
  last: boolean;
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
      return <SessionMarkdown text={item.text} streaming={last} onOpenLink={onOpenLink} />;
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

const AGENT_NAMES = { claude: "Claude", codex: "Codex" } as const;

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
  onOpenLink,
}: {
  snapshot: SessionSnapshot;
  /** Shown above the first item, such as a note that earlier work is left out. */
  before?: ReactNode;
  /** The clock for the elapsed time of a running session. */
  now?: number;
  onOpenLink?(href: string): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  useLayoutEffect(() => {
    const node = scroller.current;
    const inner = content.current;
    if (!node || !inner) return;
    // The view follows new items while the reader stays at the bottom. Only
    // a move up stops it: a scroll event can arrive after the thread grew and
    // before the view followed, and rows that fold into a group make the
    // thread shorter, which moves the view up but leaves it at the end.
    let top = node.scrollTop;
    const atEnd = () => node.scrollHeight - node.scrollTop - node.clientHeight < 32;
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
            {before}
            <Thread items={snapshot.items} live={snapshot.running} onOpenLink={onOpenLink} />
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
                  {snapshot.toolCalls > 0 &&
                    ` · ${snapshot.toolCalls} tool ${snapshot.toolCalls === 1 ? "call" : "calls"}`}
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
  // Rows out of view skip layout and paint; a long thread scrolls at frame rate.
  unit: { minWidth: 0, contentVisibility: "auto", containIntrinsicSize: "auto 60px" },
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
