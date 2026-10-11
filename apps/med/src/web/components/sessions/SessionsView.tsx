import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { agentName } from "../../../shared/saved-review";
import type { SessionStep, SessionSummary } from "../../../shared/session-summary";
import { tokens, ui } from "../../theme.stylex";
import { CardTab, tabbedCard } from "../CardTab";
import { SegmentedControl } from "../Controls";
import { Icon, type IconName } from "../Icon";
import { ShortcutKeys } from "../ShortcutKeys";
import { ToolButton } from "../ToolButton";

const order = { waiting: 0, working: 1, idle: 2 } as const;
const groups = [
  { state: "waiting", label: "Needs you" },
  { state: "working", label: "Working" },
  { state: "idle", label: "Earlier" },
] as const;

/** What needs the user first, then what works, then the rest; newest first in each. */
export const sortSessions = (sessions: SessionSummary[]) =>
  sessions.toSorted((a, b) => order[a.state] - order[b.state] || b.updatedAt - a.updatedAt);

const agentIcon = (summary: SessionSummary): IconName =>
  summary.agent === "acp" ? "agent" : summary.agent;
const stepIcon = (kind: string): IconName =>
  kind === "read"
    ? "file"
    : kind === "edit" || kind === "move"
      ? "edit"
      : kind === "delete"
        ? "trash"
        : kind === "search"
          ? "search"
          : kind === "execute"
            ? "terminal"
            : kind === "fetch"
              ? "globe"
              : "agent";

function age(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
function clock(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The session's state at the end of its row: Needs you, the turn's time, or its age. */
function StateMark({
  summary,
  now,
  unread,
}: {
  summary: SessionSummary;
  now: number;
  unread: boolean;
}) {
  if (summary.state === "waiting")
    return <span {...stylex.props(styles.mark, styles.needsYou)}>Needs you</span>;
  if (summary.state === "working")
    return (
      <span {...stylex.props(styles.mark)}>
        <span aria-hidden="true" {...stylex.props(styles.working)} />
        <span {...stylex.props(styles.hidden)}>Working</span>
        {summary.turnStartedAt !== undefined && (
          <>
            <span {...stylex.props(styles.hidden)}> for </span>
            {clock(now - summary.turnStartedAt)}
          </>
        )}
      </span>
    );
  return (
    <span {...stylex.props(styles.mark)}>
      {unread && (
        <>
          <span aria-hidden="true" {...stylex.props(styles.dot)} />
          <span {...stylex.props(styles.hidden)}>New reply, </span>
        </>
      )}
      {age(now - summary.updatedAt)}
    </span>
  );
}

/** What the session does or asks now, in one line. */
function Activity({ summary }: { summary: SessionSummary }) {
  const ask = summary.ask;
  if (ask?.kind === "permission")
    return <span {...stylex.props(styles.activity, styles.asks)}>{ask.permission.title}</span>;
  if (ask?.kind === "review" || summary.state === "waiting")
    return (
      <span {...stylex.props(styles.activity, styles.asks)}>
        {ask?.kind === "review" ? "Waiting for your review" : "Waiting for you"}
      </span>
    );
  const step = summary.steps.at(-1);
  if (summary.state === "working" && step)
    return (
      <span {...stylex.props(styles.activity)}>
        {step.title}
        {step.status === "failed" && <span {...stylex.props(styles.failed)}> failed</span>}
      </span>
    );
  const text = summary.reply ?? step?.title ?? summary.prompt;
  return text ? <span {...stylex.props(styles.activity, styles.faint)}>{text}</span> : null;
}

function Where({ summary }: { summary: SessionSummary }) {
  if (!summary.repository) return null;
  return (
    <span {...stylex.props(styles.where)}>
      {summary.repository}
      {summary.branch && (
        <>
          <span {...stylex.props(styles.faint)}> / </span>
          {summary.branch}
        </>
      )}
    </span>
  );
}

/** A session in the Desk's list: agent, review, where it runs, and what it does now. */
function SessionRow({
  summary,
  now,
  unread,
  selected,
  onSelect,
  onKeyDown,
}: {
  summary: SessionSummary;
  now: number;
  unread: boolean;
  selected: boolean;
  onSelect(): void;
  onKeyDown(event: KeyboardEvent): void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-session={summary.reviewId}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      {...stylex.props(styles.row, selected && styles.rowSelected)}
    >
      <span {...stylex.props(styles.rowIcon)} title={agentName(summary)}>
        <Icon name={agentIcon(summary)} size={14} />
      </span>
      <span
        {...stylex.props(
          styles.rowTitle,
          (unread || summary.state === "waiting") && styles.rowTitleStrong,
        )}
      >
        {summary.title}
      </span>
      <StateMark summary={summary} now={now} unread={unread} />
      <span {...stylex.props(styles.rowLine)}>
        <Where summary={summary} />
      </span>
      <span {...stylex.props(styles.rowLine)}>
        <Activity summary={summary} />
      </span>
    </button>
  );
}

function StepLine({ step, now }: { step: SessionStep; now: boolean }) {
  return (
    <li {...stylex.props(styles.logLine, now && styles.logNow)}>
      {now ? (
        <span aria-hidden="true" {...stylex.props(styles.working, styles.logArc)} />
      ) : (
        <span {...stylex.props(styles.logIcon)}>
          <Icon name={stepIcon(step.kind)} size={12} />
        </span>
      )}
      <span {...stylex.props(styles.logTitle)}>{step.title}</span>
      {/* A step that runs has no result yet. */}
      {now ? null : step.status === "failed" ? (
        <span {...stylex.props(styles.stat, styles.failed)}>failed</span>
      ) : (
        (step.added !== undefined || step.removed !== undefined) && (
          <span {...stylex.props(styles.stat)}>
            {!!step.added && <span {...stylex.props(styles.added)}>+{step.added}</span>}
            {!!step.removed && <span {...stylex.props(styles.removed)}>−{step.removed}</span>}
          </span>
        )
      )}
    </li>
  );
}

/** Every session at once: panes of one card, as a terminal multiplexer tiles them. */
function Board({
  sessions,
  now,
  unread,
  onSelect,
  onOpenReview,
  onAnswer,
}: {
  sessions: SessionSummary[];
  now: number;
  unread: ReadonlySet<string>;
  onSelect(reviewId: string): void;
  onOpenReview(reviewId: string): void;
  onAnswer(summary: SessionSummary, option: string): void;
}) {
  return (
    <div {...stylex.props(styles.board)}>
      {sessions.map((summary) => {
        const ask = summary.ask;
        const steps = summary.steps.slice(-5);
        return (
          <article
            key={summary.reviewId}
            aria-label={summary.title}
            {...stylex.props(styles.pane, summary.state === "waiting" && styles.paneWaiting)}
          >
            <header {...stylex.props(styles.paneHeader)}>
              <span title={agentName(summary)} {...stylex.props(styles.paneIcon)}>
                <Icon name={agentIcon(summary)} size={14} />
              </span>
              <button
                type="button"
                data-pane={summary.reviewId}
                onClick={() => onSelect(summary.reviewId)}
                {...stylex.props(
                  styles.paneTitle,
                  unread.has(summary.reviewId) && styles.rowTitleStrong,
                )}
              >
                {summary.title}
              </button>
              <StateMark summary={summary} now={now} unread={unread.has(summary.reviewId)} />
            </header>
            <div {...stylex.props(styles.paneWhere)}>
              <Where summary={summary} />
            </div>
            {steps.length > 0 ? (
              <ol {...stylex.props(styles.log)}>
                {steps.map((step, index) => (
                  <StepLine
                    key={step.id}
                    step={step}
                    now={
                      summary.state === "working" &&
                      index === steps.length - 1 &&
                      step.status === "running"
                    }
                  />
                ))}
              </ol>
            ) : (
              summary.prompt && (
                <p {...stylex.props(styles.panePrompt, styles.indent)}>{summary.prompt}</p>
              )
            )}
            {summary.state === "idle" && summary.reply && (
              <p {...stylex.props(styles.paneReply, styles.indent)}>{summary.reply}</p>
            )}
            <footer {...stylex.props(styles.paneFoot)}>
              {ask?.kind === "permission" ? (
                <div {...stylex.props(styles.paneAsk)}>
                  <span {...stylex.props(styles.paneQuestion)}>{ask.permission.title}</span>
                  {ask.permission.detail && (
                    <code {...stylex.props(styles.paneCommand)}>{ask.permission.detail}</code>
                  )}
                  <span {...stylex.props(styles.paneButtons)}>
                    {ask.permission.options.map((option, index) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onAnswer(summary, option.id)}
                        {...stylex.props(
                          ui.button,
                          ui.pressable,
                          index === 0 ? ui.primary : ui.outlined,
                          styles.small,
                        )}
                      >
                        {option.name}
                      </button>
                    ))}
                  </span>
                </div>
              ) : ask?.kind === "review" ? (
                <>
                  <span {...stylex.props(styles.asks)}>Waiting for your review</span>
                  <span {...stylex.props(ui.grow)} />
                  <button
                    type="button"
                    onClick={() => onOpenReview(summary.reviewId)}
                    {...stylex.props(
                      ui.button,
                      ui.pressable,
                      ui.outlined,
                      styles.small,
                      styles.above,
                    )}
                  >
                    Open review
                  </button>
                </>
              ) : (
                summary.state === "idle" &&
                summary.changes && (
                  <span {...stylex.props(styles.faint, styles.indent)}>
                    {summary.changes.files} {summary.changes.files === 1 ? "file" : "files"}{" "}
                    <span {...stylex.props(styles.added)}>+{summary.changes.additions}</span>{" "}
                    <span {...stylex.props(styles.removed)}>−{summary.changes.deletions}</span>
                  </span>
                )
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}

/**
 * The Sessions page without the app's wiring: every agent session that the
 * window's reviews have, on a Board of panes, or on the Desk, which lists
 * them beside the chosen session. `renderSession` draws that session.
 */
export function SessionsView({
  sessions,
  loaded,
  now,
  unread = new Set(),
  tab = false,
  selected,
  onSelect,
  onBack,
  onOpenReview,
  onAnswer,
  renderSession,
}: {
  /** In display order (sortSessions). */
  sessions: SessionSummary[];
  loaded: boolean;
  /** The clock for ages and turn times, in milliseconds. */
  now: number;
  /** Reviews with a reply that the user has not seen. */
  unread?: ReadonlySet<string>;
  /** The installed app hides its title bar: the card rises between the window controls. */
  tab?: boolean;
  /** The review whose session the Desk shows; null shows the Board. */
  selected: string | null;
  onSelect(reviewId: string | null): void;
  onBack?(): void;
  onOpenReview(reviewId: string): void;
  onAnswer(summary: SessionSummary, option: string): void;
  renderSession(summary: SessionSummary): ReactNode;
}) {
  const card = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const chosen = selected ? (sessions.find((entry) => entry.reviewId === selected) ?? null) : null;
  const waiting = sessions.filter((entry) => entry.state === "waiting").length;
  const working = sessions.filter((entry) => entry.state === "working").length;
  // Back on the Board, the session that was open keeps the focus.
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!selected && last.current)
      card.current
        ?.querySelector<HTMLElement>(`[data-pane="${CSS.escape(last.current)}"]`)
        ?.focus();
    last.current = selected;
  }, [selected]);
  // Escape leaves the Desk; ⌘↵ opens the chosen session's review. Keys in a
  // text field belong to it.
  useEffect(() => {
    const node = card.current!;
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !selected) return;
      if ((event.target as HTMLElement).closest("textarea, input, [contenteditable]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onSelect(null);
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenReview(selected);
      }
    };
    node.addEventListener("keydown", key);
    return () => node.removeEventListener("keydown", key);
  }, [selected, onSelect, onOpenReview]);
  const move = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowDown" || event.key === "j"
        ? 1
        : event.key === "ArrowUp" || event.key === "k"
          ? -1
          : 0;
    if (!step || !chosen) return;
    event.preventDefault();
    const index = sessions.indexOf(chosen);
    const next = sessions[Math.min(sessions.length - 1, Math.max(0, index + step))]!;
    onSelect(next.reviewId);
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLElement>(`[data-session="${CSS.escape(next.reviewId)}"]`)
        ?.focus(),
    );
  };
  return (
    <div {...stylex.props(styles.page, tab && styles.pageTab)}>
      <main ref={card} aria-label="Sessions" {...stylex.props(styles.card, tab && tabbedCard.card)}>
        {tab && <CardTab />}
        <header {...stylex.props(styles.header)}>
          {onBack && (
            <ToolButton
              label={chosen ? "Board" : "Back"}
              shortcut="Esc"
              icon="arrowLeft"
              onClick={chosen ? () => onSelect(null) : onBack}
            />
          )}
          <h1 {...stylex.props(styles.title)}>Sessions</h1>
          {waiting > 0 && (
            <span {...stylex.props(styles.mark, styles.needsYou)}>
              {waiting} {waiting === 1 ? "needs" : "need"} you
            </span>
          )}
          {working > 0 && (
            <span {...stylex.props(styles.mark, styles.wide)}>
              <span aria-hidden="true" {...stylex.props(styles.working)} />
              {working} working
            </span>
          )}
          <span {...stylex.props(ui.grow)} />
          {sessions.length > 0 && (
            <SegmentedControl<"board" | "desk">
              label="Layout"
              value={chosen ? "desk" : "board"}
              onChange={(value) =>
                onSelect(value === "board" ? null : (selected ?? sessions[0]!.reviewId))
              }
              options={[
                { value: "board", label: "Board", icon: "sessions", shortcut: "Esc" },
                { value: "desk", label: "Desk", icon: "panelLeft" },
              ]}
            />
          )}
        </header>
        {loaded && !sessions.length ? (
          <div {...stylex.props(styles.empty)}>
            <h2 {...stylex.props(styles.emptyTitle)}>No agent sessions</h2>
            <p {...stylex.props(styles.emptyText)}>
              When an agent hands off its work as a review, its session shows here: what it does,
              and what it needs from you.
            </p>
          </div>
        ) : chosen ? (
          <div {...stylex.props(styles.desk)}>
            <div ref={list} role="listbox" aria-label="Sessions" {...stylex.props(styles.list)}>
              {groups.map((group) => {
                const rows = sessions.filter((entry) => entry.state === group.state);
                if (!rows.length) return null;
                return (
                  <div key={group.state} role="group" aria-label={group.label}>
                    <div {...stylex.props(styles.groupTitle)}>
                      <span {...stylex.props(ui.label)}>{group.label}</span>
                      <span {...stylex.props(styles.count)}>{rows.length}</span>
                    </div>
                    {rows.map((entry) => (
                      <SessionRow
                        key={entry.reviewId}
                        summary={entry}
                        now={now}
                        unread={unread.has(entry.reviewId)}
                        selected={entry === chosen}
                        onSelect={() => onSelect(entry.reviewId)}
                        onKeyDown={move}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
            <section aria-label={chosen.title} {...stylex.props(styles.detail)}>
              {renderSession(chosen)}
            </section>
          </div>
        ) : (
          <Board
            sessions={sessions}
            now={now}
            unread={unread}
            onSelect={onSelect}
            onOpenReview={onOpenReview}
            onAnswer={onAnswer}
          />
        )}
      </main>
    </div>
  );
}

/** The Desk's control that opens the chosen session's review. */
export function OpenReviewButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.open)}
    >
      Open review
      <ShortcutKeys value="Mod+Enter" />
    </button>
  );
}

const turn = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const arrive = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(3px)" },
  to: { opacity: 1, transform: "none" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";
const narrow = "@media (max-width: 760px)";

const styles = stylex.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  faint: { color: tokens.faint },
  failed: { color: tokens.red },
  added: { color: tokens.green },
  removed: { color: tokens.red },
  // The workspace list's marks: Needs you, a turning arc, and an unread dot.
  needsYou: { color: tokens.accent, fontWeight: 500 },
  working: {
    flexShrink: 0,
    boxSizing: "border-box",
    width: 10,
    height: 10,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderTopColor: tokens.muted,
    animationName: { default: turn, [reduced]: "none" },
    animationDuration: "900ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  dot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
  },
  mark: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  asks: { color: tokens.accent },
  // Only a wide header has room.
  wide: { display: { default: "inline-flex", [narrow]: "none" } },

  // The review's frame: a 6px gutter on the panel, and one card.
  page: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    padding: 6,
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    WebkitFontSmoothing: "antialiased",
  },
  // The view starts below the title bar; the card rises into it.
  pageTab: { marginTop: "calc(-1 * var(--med-titlebar-height))" },
  card: {
    position: "relative",
    flex: "1",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: tokens.frame,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  // As the review card's first row.
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    height: 38,
    paddingInline: 6,
    boxSizing: "border-box",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  title: {
    margin: 0,
    marginInlineStart: 2,
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.005em",
    whiteSpace: "nowrap",
  },
  empty: {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingInline: 24,
    paddingBottom: 48,
    textAlign: "center",
  },
  emptyTitle: { margin: 0, fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em" },
  emptyText: {
    maxWidth: 360,
    marginBlock: 6,
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 1.5,
    textWrap: "balance",
  },

  // Rows
  row: {
    display: "grid",
    gridTemplateColumns: "14px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 10,
    rowGap: 2,
    width: "100%",
    paddingBlock: 9,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  rowSelected: { backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong } },
  rowIcon: { display: "flex", color: tokens.muted },
  rowTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 450,
  },
  rowTitleStrong: { fontWeight: 550 },
  rowLine: { gridColumnStart: 2, gridColumnEnd: -1, minWidth: 0, display: "flex" },
  where: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 12,
  },
  activity: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 12,
  },

  // Desk
  desk: {
    flex: "1",
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: { default: "340px minmax(0, 1fr)", [narrow]: "minmax(0, 1fr)" },
    gridTemplateRows: { default: "minmax(0, 1fr)", [narrow]: "minmax(0, 40%) minmax(0, 1fr)" },
  },
  // On a narrow screen the list sits above the chosen session.
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    overflowY: "auto",
    padding: 6,
    paddingTop: 10,
    borderColor: tokens.line,
    borderStyle: "solid",
    borderWidth: 0,
    borderRightWidth: { default: 1, [narrow]: 0 },
    borderBottomWidth: { default: 0, [narrow]: 1 },
  },
  groupTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    height: 22,
    paddingInline: 10,
  },
  count: { color: tokens.faint, fontSize: 11.5, fontVariantNumeric: "tabular-nums" },
  detail: { minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  open: { gap: 8 },

  // Board
  board: {
    flex: "1",
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
    // Two rows fill the card; more rows scroll.
    gridAutoRows: "minmax(290px, 50%)",
    alignContent: "start",
    overflowY: "auto",
    // The panes' rules: each draws its right and bottom edge.
    marginInlineEnd: -1,
    marginBottom: -1,
  },
  pane: {
    position: "relative",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    paddingBlock: 12,
    paddingInline: 14,
    boxShadow: `inset -1px -1px 0 ${tokens.line}`,
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${tokens.fill} 50%, transparent)`,
    },
  },
  paneWaiting: {
    backgroundColor: {
      default: `color-mix(in srgb, ${tokens.accent} 5%, transparent)`,
      ":hover": `color-mix(in srgb, ${tokens.accent} 7%, transparent)`,
    },
  },
  paneHeader: { display: "flex", alignItems: "center", gap: 8, color: tokens.muted },
  paneIcon: { display: "flex" },
  paneTitle: {
    flex: "1",
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    fontWeight: 500,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    borderRadius: 3,
    // The title's click area covers the pane.
    "::after": { content: '""', position: "absolute", inset: 0 },
  },
  paneWhere: { display: "flex", minHeight: 18, marginTop: 2, paddingInlineStart: 22 },
  log: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginBlock: 0,
    marginTop: 14,
    padding: 0,
    listStyle: "none",
  },
  logLine: {
    display: "grid",
    gridTemplateColumns: "14px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 8,
    height: 22,
    color: tokens.muted,
    fontSize: 12,
    animationName: { default: arrive, [reduced]: "none" },
    animationDuration: "220ms",
    animationTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
  },
  logNow: { color: tokens.text },
  logIcon: { display: "flex", justifyContent: "center", color: tokens.faint },
  logArc: { justifySelf: "center" },
  logTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  stat: {
    display: "flex",
    gap: 6,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  // Level with the step titles and the location.
  indent: { paddingInlineStart: 22 },
  panePrompt: {
    marginBlock: 0,
    marginTop: 12,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  paneReply: {
    marginBlock: 0,
    marginTop: 12,
    color: tokens.text,
    fontSize: 12.5,
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  paneFoot: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: "auto",
    paddingTop: 12,
    minHeight: 28,
    fontSize: 12,
  },
  paneAsk: { display: "flex", flexDirection: "column", gap: 8, width: "100%" },
  paneQuestion: { color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  paneCommand: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingBlock: 5,
    paddingInline: 8,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  // Above the title's click area, which covers the pane.
  paneButtons: { position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: 6 },
  above: { position: "relative", zIndex: 1 },
  small: { minHeight: 26, paddingInline: 10 },
});
