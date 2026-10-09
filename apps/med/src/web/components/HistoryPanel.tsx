import { Tooltip } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import { memo, useMemo, useState, useRef, useEffect, useLayoutEffect, useId } from "react";
import type { Commit, CommitDetails } from "../../shared/protocol";
import { layoutHistory, type GraphRow } from "./history-layout";
import { picked, tokens, ui } from "../theme.stylex";
import { relativeTime } from "../data/relative-time";
import { CommitCard } from "./CommitCard";
import { Icon } from "./Icon";

const rowHeight = 48;
// Lane colors blend the theme accent with fixed hues, so every theme gets a
// related set and lane 0 (the checked-out line) is the accent itself.
const colors = [
  tokens.accent,
  `color-mix(in oklch, ${tokens.accent} 45%, #43c6b4)`,
  `color-mix(in oklch, ${tokens.accent} 45%, #f0a35a)`,
  `color-mix(in oklch, ${tokens.accent} 45%, #e874a8)`,
  `color-mix(in oklch, ${tokens.accent} 45%, #9fd36a)`,
  `color-mix(in oklch, ${tokens.accent} 45%, #c79bff)`,
];
const graphX = (lane: number) => 10 + lane * 12;

function Graph({ row, working }: { row: GraphRow; working?: boolean }) {
  const x = graphX;
  return (
    <svg
      width={Math.max(28, row.width * 12 + 9)}
      height={rowHeight}
      aria-hidden="true"
      {...stylex.props(styles.graph)}
    >
      {row.edges.map((edge, index) => (
        <path
          key={index}
          d={
            edge.incoming
              ? `M${x(edge.from)} 0 L${x(edge.from)} 20 C${x(edge.from)} 36 ${x(edge.to)} 32 ${x(edge.to)} 48`
              : `M${x(edge.from)} 20 C${x(edge.from)} 36 ${x(edge.to)} 32 ${x(edge.to)} 48`
          }
          style={{ stroke: colors[edge.color % colors.length] }}
          fill="none"
          strokeWidth="1.5"
          opacity=".75"
        />
      ))}
      {row.incoming && (
        <path
          d={`M${x(row.lane)} 0V20`}
          style={{ stroke: colors[row.lane % colors.length] }}
          strokeWidth="1.5"
        />
      )}
      {working && !row.incoming && (
        <path
          d={`M${x(row.lane)} 0V16`}
          style={{ stroke: colors[row.lane % colors.length] }}
          strokeWidth="1.5"
          strokeDasharray="2 2.5"
          opacity=".75"
        />
      )}
      <circle cx={x(row.lane)} cy="20" r="3.5" style={{ fill: colors[row.lane % colors.length] }} />
      {row.commit.parents.length > 1 && (
        <circle cx={x(row.lane)} cy="20" r="1.5" style={{ fill: tokens.panel }} />
      )}
    </svg>
  );
}

/** Memoized: the review renders again for unrelated state, such as a palette. */
export const HistoryPanel = memo(function HistoryPanel({
  commits,
  selected,
  selectedRange,
  loading,
  hasMore,
  error,
  onSelect,
  onSelectRange,
  onLoadMore,
  onWorking,
  working,
  workingAvailable = true,
  collapsed = false,
  onCollapsedChange,
  loadDetails,
}: {
  commits: Commit[];
  selected?: string;
  selectedRange?: { base: string; head: string };
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  onSelect(commit: string): void;
  onSelectRange?(oldest: string, newest: string): void;
  onLoadMore(): void;
  onWorking(): void;
  working: boolean;
  workingAvailable?: boolean;
  /** A collapsed panel keeps only its heading, which names the selection. */
  collapsed?: boolean;
  onCollapsedChange?(collapsed: boolean): void;
  /** The body and size of a commit, for its card. */
  loadDetails?(id: string, signal: AbortSignal): Promise<CommitDetails>;
}) {
  const bodyId = useId();
  const tooltip = useMemo(() => Tooltip.createHandle<{ commit: Commit; color: string }>(), []);
  // Details load when the pointer reaches a row, so most are ready when its
  // card opens. A failed load shows the card without them.
  const [details, setDetails] = useState(() => new Map<string, CommitDetails | null>());
  const requested = useRef(new Set<string>());
  const loaders = useRef(new AbortController());
  useEffect(() => {
    const abort = loaders.current;
    return () => abort.abort();
  }, []);
  const prefetch = (id: string) => {
    if (!loadDetails || requested.current.has(id)) return;
    requested.current.add(id);
    const settle = (value: CommitDetails | null) =>
      setDetails((current) => new Map(current).set(id, value));
    loadDetails(id, loaders.current.signal).then(settle, () => {
      if (!loaders.current.signal.aborted) settle(null);
    });
  };
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const pendingSelection = useRef(selected);
  const anchor = useRef(selected);
  const rangeStart = commits.findIndex((commit) => commit.id === selectedRange?.head);
  const rangeEnd = commits.findIndex((commit) => commit.id === selectedRange?.base);
  const isSelected = (id: string, index: number) =>
    selectedRange ? rangeStart >= 0 && index >= rangeStart && index <= rangeEnd : selected === id;
  useLayoutEffect(() => {
    if (!selectedRange) {
      pendingSelection.current = selected;
      anchor.current = selected;
    }
  }, [selected, selectedRange]);
  const selectCommit = (id: string, extend = false) => {
    pendingSelection.current = id;
    const from = commits.findIndex((commit) => commit.id === anchor.current);
    const to = commits.findIndex((commit) => commit.id === id);
    if (extend && onSelectRange && from >= 0 && to >= 0) {
      onSelectRange(commits[Math.max(from, to)]!.id, commits[Math.min(from, to)]!.id);
      return;
    }
    anchor.current = id;
    onSelect(id);
  };
  const rows = useMemo(() => layoutHistory(commits), [commits]);
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 320 });
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setViewport((value) => ({ ...value, height: node.clientHeight })),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - 6);
  const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + 6);
  const selectRelative = (delta: number, extend: boolean) => {
    const index = commits.findIndex((commit) => commit.id === pendingSelection.current);
    const nextIndex = Math.max(0, Math.min(commits.length - 1, index + delta));
    const next = commits[nextIndex];
    if (next) {
      selectCommit(next.id, extend);
      container.current?.scrollTo({
        top: Math.max(0, nextIndex * rowHeight - viewport.height / 2),
      });
    }
  };
  const selectedCommit = selected ? commits.find((commit) => commit.id === selected) : undefined;
  const summary = working ? (
    <span {...stylex.props(styles.summaryText)}>Working changes</span>
  ) : selectedRange ? (
    <span {...stylex.props(styles.commitHash)}>
      {selectedRange.base.slice(0, 7)}…{selectedRange.head.slice(0, 7)}
    </span>
  ) : selected ? (
    <>
      {selectedCommit && (
        <span {...stylex.props(styles.summaryText)}>
          {selectedCommit.subject || "(no commit message)"}
        </span>
      )}
      <span {...stylex.props(styles.commitHash)}>{selected.slice(0, 7)}</span>
    </>
  ) : null;
  const count = (
    <span {...stylex.props(styles.count)}>
      {commits.length}
      {hasMore ? "+" : ""}
    </span>
  );
  return (
    <Tooltip.Provider delay={450} closeDelay={60} timeout={800}>
      <section
        {...stylex.props(styles.panel, collapsed && styles.collapsed)}
        aria-label="Commit history"
      >
        {onCollapsedChange ? (
          <button
            {...stylex.props(styles.heading, styles.toggle, stylex.defaultMarker())}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <span {...stylex.props(ui.label, styles.label)}>
              History
              <span {...stylex.props(styles.chevron, collapsed && styles.chevronClosed)}>
                <Icon name="chevron" size={12} />
              </span>
            </span>
            {collapsed ? (
              <span key="summary" {...stylex.props(styles.summary)}>
                {summary ?? count}
              </span>
            ) : (
              count
            )}
          </button>
        ) : (
          <div {...stylex.props(styles.heading)}>
            <span {...stylex.props(ui.label)}>History</span>
            {count}
          </div>
        )}
        <div
          id={bodyId}
          inert={collapsed}
          {...stylex.props(styles.body, collapsed && styles.bodyHidden)}
        >
          {workingAvailable && (
            <button
              {...stylex.props(styles.working, working && [styles.selected, picked])}
              onClick={() => {
                pendingSelection.current = undefined;
                anchor.current = undefined;
                onWorking();
              }}
              aria-pressed={working}
            >
              {/* Uncommitted work sits above HEAD as a dashed node on lane 0. */}
              <svg width="28" height="32" aria-hidden="true" {...stylex.props(styles.graph)}>
                <circle
                  cx={graphX(0)}
                  cy="16"
                  r="3.75"
                  fill="none"
                  strokeWidth="1.5"
                  strokeDasharray="2.2 1.9"
                  style={{ stroke: colors[0] }}
                />
                {commits.length > 0 && (
                  <path
                    d={`M${graphX(0)} 20.5V32`}
                    strokeWidth="1.5"
                    strokeDasharray="2 2.5"
                    opacity=".75"
                    style={{ stroke: colors[0] }}
                  />
                )}
              </svg>
              <span {...stylex.props(styles.workingLabel)}>Working changes</span>
            </button>
          )}
          <div
            ref={container}
            {...stylex.props(styles.scroll)}
            tabIndex={0}
            role="listbox"
            aria-label="Commits"
            aria-multiselectable={!!onSelectRange}
            aria-activedescendant={
              rows.slice(start, end).some((row) => row.commit.id === selected)
                ? `commit-${selected}`
                : undefined
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                selectRelative(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
              }
            }}
            onScroll={(event) => {
              const node = event.currentTarget;
              setViewport({ top: node.scrollTop, height: node.clientHeight });
              if (
                node.scrollHeight - node.scrollTop - node.clientHeight < 180 &&
                hasMore &&
                !loading
              )
                onLoadMore();
            }}
          >
            <div style={{ height: rows.length * rowHeight, position: "relative" }}>
              {rows.slice(start, end).map((row, offset) => {
                const index = start + offset;
                const chosen = isSelected(row.commit.id, index);
                // A range reads as one band: rows inside it join without
                // corners, and a hairline under the text separates them.
                const joinsAbove =
                  chosen && index > 0 && isSelected(rows[index - 1]!.commit.id, index - 1);
                const joinsBelow =
                  chosen &&
                  index + 1 < rows.length &&
                  isSelected(rows[index + 1]!.commit.id, index + 1);
                return (
                  <Tooltip.Trigger
                    handle={tooltip}
                    payload={{ commit: row.commit, color: colors[row.lane % colors.length]! }}
                    onPointerEnter={() => prefetch(row.commit.id)}
                    onFocus={() => prefetch(row.commit.id)}
                    id={`commit-${row.commit.id}`}
                    key={row.commit.id}
                    role="option"
                    aria-selected={chosen}
                    tabIndex={-1}
                    onClick={(event) => selectCommit(row.commit.id, event.shiftKey)}
                    className={
                      stylex.props(
                        styles.commit,
                        chosen && [styles.selected, picked],
                        joinsAbove && styles.joinsAbove,
                        joinsBelow && styles.joinsBelow,
                      ).className
                    }
                    style={{ top: index * rowHeight }}
                  >
                    <Graph row={row} working={workingAvailable && index === 0} />
                    <span {...stylex.props(styles.commitText, joinsAbove && styles.divided)}>
                      <span {...stylex.props(styles.subjectLine)}>
                        <span {...stylex.props(styles.subject)}>
                          {row.commit.subject || "(no commit message)"}
                        </span>
                        <span {...stylex.props(styles.commitHash)}>
                          {row.commit.id.slice(0, 7)}
                        </span>
                      </span>
                      <span {...stylex.props(styles.metadata)}>
                        {row.commit.refs.length > 0 && (
                          <span {...stylex.props(styles.refs)} title={row.commit.refs.join(" · ")}>
                            {row.commit.refs.join(" · ")}
                          </span>
                        )}
                        <span {...stylex.props(ui.truncate)}>{row.commit.author}</span>
                        <time
                          {...stylex.props(styles.time)}
                          dateTime={new Date(row.commit.timestamp).toISOString()}
                        >
                          {relativeTime(row.commit.timestamp, now)}
                        </time>
                      </span>
                    </span>
                  </Tooltip.Trigger>
                );
              })}
            </div>
            {commits.length === 0 && !loading && !error && (
              <div {...stylex.props(styles.empty)}>No commits yet</div>
            )}
            {error && (
              <div role="alert" {...stylex.props(styles.empty)}>
                {error}
              </div>
            )}
            {(hasMore || loading) && (
              <button
                {...stylex.props(ui.button, styles.loadMore)}
                onClick={onLoadMore}
                disabled={loading}
              >
                {loading ? "Loading history…" : "Load earlier commits"}
              </button>
            )}
          </div>
        </div>
      </section>
      <Tooltip.Root handle={tooltip} disabled={!commits.length}>
        {({ payload }) => (
          <Tooltip.Portal>
            <Tooltip.Positioner
              side="right"
              align="start"
              sideOffset={10}
              {...stylex.props(styles.tooltipPositioner)}
            >
              <Tooltip.Popup role="tooltip" {...stylex.props(styles.tooltip, ui.pop)}>
                {payload && (
                  <CommitCard
                    commit={payload.commit}
                    color={payload.color}
                    details={loadDetails ? details.get(payload.commit.id) : null}
                    now={now}
                  />
                )}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
    </Tooltip.Provider>
  );
});

const styles = stylex.create({
  time: { flexShrink: 0, whiteSpace: "nowrap" },
  tooltipPositioner: { zIndex: 100 },
  tooltip: {
    backgroundColor: tokens.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: tokens.shadow,
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minHeight: 140,
    height: "43%",
  },
  collapsed: { height: 36, minHeight: 36 },
  body: {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minHeight: 0,
    overflow: "hidden",
  },
  // Folding is immediate, like the sidebars.
  bodyHidden: { opacity: 0 },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 14,
    height: 36,
    minHeight: 36,
    fontSize: 11.5,
    fontWeight: 500,
    color: tokens.muted,
  },
  // The heading is the toggle; it keeps the plain heading's look and alignment.
  toggle: {
    gap: 12,
    flexShrink: 0,
    width: "100%",
    boxSizing: "border-box",
    padding: 0,
    paddingInline: 14,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
    borderRadius: `calc(7px * ${tokens.round})`,
    transitionProperty: "color",
    transitionDuration: "120ms",
  },
  label: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 },
  // The chevron shows on hover, and always while the panel is collapsed.
  chevron: {
    display: "flex",
    color: tokens.faint,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-visible")]: 1,
    },
    transform: "none",
    transitionProperty: "opacity",
    transitionDuration: { default: "120ms", "@media (prefers-reduced-motion: reduce)": "0s" },
  },
  chevronClosed: {
    opacity: {
      default: 1,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-visible")]: 1,
    },
    transform: "rotate(-90deg)",
  },
  summary: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "flex-end",
    gap: 8,
    minWidth: 0,
  },
  summaryText: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 400,
  },
  count: {
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  working: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginInline: 6,
    height: 32,
    minHeight: 32,
    paddingInlineStart: 0,
    paddingInlineEnd: 10,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  workingLabel: { flex: "1", minWidth: 0 },
  scroll: {
    flex: "1",
    overflowY: "auto",
    overflowX: "hidden",
    minHeight: 0,
    scrollbarWidth: "thin",
    outline: { default: "none", ":focus-visible": `1px solid ${tokens.accentLine}` },
    outlineOffset: -1,
  },
  commit: {
    position: "absolute",
    insetInline: 6,
    display: "flex",
    alignItems: "center",
    height: rowHeight,
    padding: 0,
    paddingRight: 10,
    boxSizing: "border-box",
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
  },
  selected: {
    backgroundColor: { default: tokens.selected, ":hover": tokens.selected },
    color: tokens.selectedText,
  },
  joinsAbove: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  joinsBelow: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  divided: {
    "::before": {
      content: '""',
      position: "absolute",
      top: 0,
      left: 0,
      right: -10,
      height: 1,
      backgroundColor: `color-mix(in oklab, ${tokens.text} 9%, transparent)`,
    },
  },
  graph: { flexShrink: 0, maxWidth: 94, overflow: "hidden" },
  // It fills the row's height so the range hairline sits on the row edge.
  commitText: {
    position: "relative",
    flex: "1",
    alignSelf: "stretch",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 3,
  },
  subjectLine: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 },
  subject: {
    flex: "1",
    minWidth: 0,
    fontSize: 12.5,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  refs: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 96,
    paddingInline: 5,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 10.5,
    lineHeight: "16px",
    fontWeight: 500,
  },
  metadata: { display: "flex", alignItems: "center", gap: 7, color: tokens.faint, fontSize: 11 },
  commitHash: {
    flexShrink: 0,
    fontFamily: tokens.code,
    color: tokens.faint,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  loadMore: { width: "calc(100% - 12px)", marginInline: 6, minHeight: 32 },
  empty: { padding: 16, fontSize: 12, color: tokens.muted },
});
