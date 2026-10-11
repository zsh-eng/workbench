import * as stylex from "@stylexjs/stylex";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type { AgentMessage } from "../../../shared/agent-inbox";
import { createSessionStore } from "../../data/session-store";
import { withSentMessages } from "../../data/agent-inbox";
import { tokens, ui } from "../../theme.stylex";
import { SegmentedControl } from "../Controls";
import { Icon, type IconName } from "../Icon";
import { ShortcutKeys } from "../ShortcutKeys";
import { PermissionCard, SessionComposer } from "../session/SessionComposer";
import { SessionThread } from "../session/SessionThread";
import { deskSessions, threadFor, type DeskSession, type Step } from "./sessions-fixture";
import { Section, Specimen } from "./Specimen";

const agentIcon = (session: DeskSession): IconName =>
  session.agent === "acp" ? "agent" : session.agent;
const stepIcon: Record<Step["kind"], IconName> = {
  read: "file",
  edit: "edit",
  search: "search",
  execute: "terminal",
};
const order = { waiting: 0, working: 1, idle: 2 } as const;
const groups = [
  { state: "waiting", label: "Needs you" },
  { state: "working", label: "Working" },
  { state: "idle", label: "Earlier" },
] as const;

function ago(minutes: number) {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The sample sessions, live: a working session takes its next step every few
 * seconds, and the user's answers change a session's state.
 */
function useLiveSessions() {
  const [sessions, setSessions] = useState(() =>
    deskSessions.map((session) => ({ ...session, upcoming: [...(session.upcoming ?? [])] })),
  );
  const [seconds, setSeconds] = useState(0);
  // A turn that starts now has run for no time: its clock starts at the page's.
  const now = useRef(0);
  useEffect(() => {
    const clock = setInterval(() => setSeconds(++now.current), 1000);
    let turn = 0;
    const steps = setInterval(() => {
      setSessions((list) => {
        const working = list.filter((entry) => entry.state === "working" && entry.upcoming.length);
        if (!working.length) return list;
        const next = working[turn++ % working.length]!;
        return list.map((entry) =>
          entry.id === next.id
            ? {
                ...entry,
                steps: [...entry.steps, entry.upcoming[0]!],
                upcoming: entry.upcoming.slice(1),
              }
            : entry,
        );
      });
    }, 2600);
    return () => {
      clearInterval(clock);
      clearInterval(steps);
    };
  }, []);
  const change = (id: string, update: (session: (typeof sessions)[number]) => object) =>
    setSessions((list) =>
      list.map((entry) => (entry.id === id ? { ...entry, ...update(entry) } : entry)),
    );
  return {
    sessions: [...sessions].sort((a, b) => order[a.state] - order[b.state]),
    seconds,
    answer(id: string, option: string) {
      change(id, (session) =>
        option === "deny"
          ? {
              state: "idle",
              ask: undefined,
              ago: 0,
              reply: "Stopped before the tests: you denied the run.",
            }
          : {
              state: "working",
              ask: undefined,
              elapsed: -now.current,
              upcoming: [
                {
                  kind: "execute",
                  title: "Run the export tests",
                  command: "bun test tests/export.test.ts",
                  result: "9 pass",
                },
                ...session.upcoming,
              ],
            },
      );
    },
    reply(id: string) {
      change(id, () => ({
        state: "working",
        ask: undefined,
        elapsed: -now.current,
        unread: false,
      }));
    },
    read(id: string) {
      change(id, () => ({ unread: false }));
    },
  };
}
type Live = ReturnType<typeof useLiveSessions>;

/** The session's state at the end of its row: Needs you, the turn's time, or its age. */
function StateMark({ session, seconds }: { session: DeskSession; seconds: number }) {
  if (session.state === "waiting")
    return <span {...stylex.props(styles.mark, styles.needsYou)}>Needs you</span>;
  if (session.state === "working")
    return (
      <span {...stylex.props(styles.mark)}>
        <span aria-hidden="true" {...stylex.props(styles.working)} />
        <span {...stylex.props(styles.hidden)}>Working for </span>
        {clock((session.elapsed ?? 0) + seconds)}
      </span>
    );
  return (
    <span {...stylex.props(styles.mark)}>
      {session.unread && (
        <>
          <span aria-hidden="true" {...stylex.props(styles.dot)} />
          <span {...stylex.props(styles.hidden)}>New reply, </span>
        </>
      )}
      {ago(session.ago)}
    </span>
  );
}

/** What the session does or asks now, in one line. */
function Activity({ session }: { session: DeskSession }) {
  const ask = session.ask;
  if (ask?.kind === "permission")
    return <span {...stylex.props(styles.activity, styles.asks)}>{ask.permission.title}</span>;
  if (ask?.kind === "review")
    return (
      <span {...stylex.props(styles.activity, styles.asks)}>
        Waiting for your review
        {ask.comments > 0 && (
          <span {...stylex.props(styles.faint)}>
            {" "}
            with {ask.comments} {ask.comments === 1 ? "comment" : "comments"} to send
          </span>
        )}
      </span>
    );
  const step = session.steps.at(-1);
  if (session.state === "working" && step)
    return (
      <span {...stylex.props(styles.activity)}>
        {step.title}
        {step.failed && step.result && <span {...stylex.props(styles.failed)}> {step.result}</span>}
      </span>
    );
  return (
    <span {...stylex.props(styles.activity, styles.faint)}>{session.reply ?? step?.title}</span>
  );
}

function Where({ session }: { session: DeskSession }) {
  return (
    <span {...stylex.props(styles.where)}>
      {session.repository}
      <span {...stylex.props(styles.faint)}> / </span>
      {session.branch}
    </span>
  );
}

/** A session in the Desk's list: agent, task, where it runs, and what it does now. */
function SessionRow({
  session,
  seconds,
  selected = false,
  onSelect,
  onKeyDown,
}: {
  session: DeskSession;
  seconds: number;
  selected?: boolean;
  onSelect?(): void;
  onKeyDown?(event: KeyboardEvent): void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-session={session.id}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      {...stylex.props(styles.row, selected && styles.rowSelected)}
    >
      <span {...stylex.props(styles.rowIcon)}>
        <Icon name={agentIcon(session)} size={14} />
      </span>
      <span
        {...stylex.props(
          styles.rowTitle,
          (session.unread || session.state === "waiting") && styles.rowTitleStrong,
        )}
      >
        {session.title}
      </span>
      <StateMark session={session} seconds={seconds} />
      <span {...stylex.props(styles.rowLine)}>
        <Where session={session} />
      </span>
      <span {...stylex.props(styles.rowLine)}>
        <Activity session={session} />
      </span>
    </button>
  );
}

/** The thread of one session, as the Session pane shows it. */
function Thread({ session, live }: { session: DeskSession; live: Live }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const store = useMemo(() => {
    const store = createSessionStore();
    const { events, running } = threadFor(session, session.steps);
    store.applyAll(events);
    store.setRunning(running);
    return store;
  }, [session]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const shown = useMemo(
    () => ({ ...snapshot, items: withSentMessages(snapshot.items, messages) }),
    [snapshot, messages],
  );
  const ask = session.ask;
  return (
    <>
      <div {...stylex.props(styles.thread)}>
        <SessionThread snapshot={shown} />
      </div>
      {ask?.kind === "permission" ? (
        <div {...stylex.props(styles.ask)}>
          <PermissionCard
            permission={ask.permission}
            onAnswer={(option) => live.answer(session.id, option)}
          />
        </div>
      ) : (
        <SessionComposer
          key={session.id}
          agent={session.agent}
          name={session.name}
          waiting={ask?.kind === "review"}
          drafts={[]}
          attachments={[]}
          onRemoveAttachment={() => {}}
          onSend={async (message) => {
            setMessages((list) => [
              ...list,
              {
                id: `m${list.length}`,
                sessionId: session.id,
                agent: session.agent,
                text: message.text,
                noteIds: [],
                attachmentCount: 0,
                createdAt: new Date(Date.UTC(2026, 9, 11, 10)).toISOString(),
                delivery: "delivered",
              },
            ]);
            live.reply(session.id);
          }}
        />
      )}
    </>
  );
}

/** The list of sessions by what they need, and the chosen one beside it. */
function Desk({
  live,
  selected,
  onSelect,
}: {
  live: Live;
  selected: string;
  onSelect(id: string): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const { sessions, seconds } = live;
  const session = sessions.find((entry) => entry.id === selected) ?? sessions[0]!;
  const move = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowDown" || event.key === "j"
        ? 1
        : event.key === "ArrowUp" || event.key === "k"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const index = sessions.findIndex((entry) => entry.id === session.id);
    const next = sessions[Math.min(sessions.length - 1, Math.max(0, index + step))]!;
    onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`[data-session="${next.id}"]`)?.focus();
  };
  return (
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
                  key={entry.id}
                  session={entry}
                  seconds={seconds}
                  selected={entry.id === session.id}
                  onSelect={() => {
                    onSelect(entry.id);
                    live.read(entry.id);
                  }}
                  onKeyDown={move}
                />
              ))}
            </div>
          );
        })}
      </div>
      <section aria-label={session.title} {...stylex.props(styles.detail)}>
        <header {...stylex.props(styles.detailHeader)}>
          <Icon name={agentIcon(session)} size={14} />
          <span {...stylex.props(styles.detailTitle)}>
            <span {...stylex.props(styles.detailName)}>{session.title}</span>
            <Where session={session} />
          </span>
          <StateMark session={session} seconds={seconds} />
          <button type="button" {...stylex.props(ui.button, ui.pressable, ui.outlined)}>
            Open review
            <ShortcutKeys value="Mod+Enter" />
          </button>
        </header>
        <Thread key={session.id} session={session} live={live} />
      </section>
    </div>
  );
}

/** Every session at once: panes of one card, as a terminal multiplexer tiles them. */
function Board({ live, onOpen }: { live: Live; onOpen(id: string): void }) {
  const { sessions, seconds } = live;
  return (
    <div {...stylex.props(styles.board)}>
      {sessions.map((session) => {
        const ask = session.ask;
        const steps = session.steps.slice(-5);
        return (
          <article
            key={session.id}
            aria-label={session.title}
            {...stylex.props(styles.pane, session.state === "waiting" && styles.paneWaiting)}
          >
            <header {...stylex.props(styles.paneHeader)}>
              <Icon name={agentIcon(session)} size={14} />
              <button
                type="button"
                data-pane={session.id}
                onClick={() => onOpen(session.id)}
                {...stylex.props(styles.paneTitle, session.unread && styles.rowTitleStrong)}
              >
                {session.title}
              </button>
              <StateMark session={session} seconds={seconds} />
            </header>
            <div {...stylex.props(styles.paneWhere)}>
              <Where session={session} />
            </div>
            <ol {...stylex.props(styles.log)}>
              {steps.map((step, index) => {
                const now = session.state === "working" && index === steps.length - 1;
                return (
                  <li
                    key={session.steps.length - steps.length + index}
                    {...stylex.props(styles.logLine, now && styles.logNow)}
                  >
                    {now ? (
                      <span aria-hidden="true" {...stylex.props(styles.working, styles.logArc)} />
                    ) : (
                      <span {...stylex.props(styles.logIcon)}>
                        <Icon name={stepIcon[step.kind]} size={12} />
                      </span>
                    )}
                    <span {...stylex.props(styles.logTitle)}>{step.title}</span>
                    {/* A step that runs has no result yet. */}
                    {now ? null : step.added !== undefined || step.removed !== undefined ? (
                      <span {...stylex.props(styles.stat)}>
                        {!!step.added && <span {...stylex.props(styles.added)}>+{step.added}</span>}
                        {!!step.removed && (
                          <span {...stylex.props(styles.removed)}>−{step.removed}</span>
                        )}
                      </span>
                    ) : (
                      step.result && (
                        <span {...stylex.props(styles.stat, step.failed && styles.failed)}>
                          {step.result}
                        </span>
                      )
                    )}
                  </li>
                );
              })}
            </ol>
            {session.state === "idle" && session.reply && (
              <p {...stylex.props(styles.paneReply, styles.indent)}>{session.reply}</p>
            )}
            <footer {...stylex.props(styles.paneFoot)}>
              {ask?.kind === "permission" ? (
                <div {...stylex.props(styles.paneAsk)}>
                  <span {...stylex.props(styles.paneQuestion)}>{ask.permission.title}</span>
                  <code {...stylex.props(styles.paneCommand)}>{ask.permission.detail}</code>
                  <span {...stylex.props(styles.paneButtons)}>
                    <button
                      type="button"
                      onClick={() => live.answer(session.id, "once")}
                      {...stylex.props(ui.button, ui.pressable, ui.primary, styles.small)}
                    >
                      Allow once
                    </button>
                    <button
                      type="button"
                      onClick={() => live.answer(session.id, "deny")}
                      {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.small)}
                    >
                      Deny
                    </button>
                  </span>
                </div>
              ) : ask?.kind === "review" ? (
                <>
                  <span {...stylex.props(styles.asks)}>Waiting for your review</span>
                  <span {...stylex.props(ui.grow)} />
                  <button
                    type="button"
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
                session.changes && (
                  <span {...stylex.props(styles.faint, styles.indent)}>
                    {session.changes.files} files{" "}
                    <span {...stylex.props(styles.added)}>+{session.changes.added}</span>{" "}
                    <span {...stylex.props(styles.removed)}>−{session.changes.removed}</span>
                  </span>
                )
              )}
            </footer>
          </article>
        );
      })}
      <button type="button" {...stylex.props(styles.pane, styles.newPane)}>
        <Icon name="plus" size={14} />
        New session
      </button>
    </div>
  );
}

/**
 * The Sessions workspace: a card in the review's frame. It opens on the
 * Board; a session opens on the Desk, and Escape returns to the Board with
 * that session's pane in focus.
 */
function Workspace() {
  const live = useLiveSessions();
  const card = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"desk" | "board">("board");
  const [selected, setSelected] = useState(live.sessions[0]!.id);
  const [returned, setReturned] = useState(false);
  useEffect(() => {
    if (layout !== "board" || !returned) return;
    card.current?.querySelector<HTMLElement>(`[data-pane="${selected}"]`)?.focus();
    // Only a return from the Desk moves focus.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  useEffect(() => {
    if (layout !== "desk") return;
    const node = card.current!;
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A draft in the reply box stays: Escape there belongs to the box.
      if ((event.target as HTMLElement).closest("textarea, input, [contenteditable]")) return;
      event.preventDefault();
      setReturned(true);
      setLayout("board");
    };
    node.addEventListener("keydown", key);
    return () => node.removeEventListener("keydown", key);
  }, [layout]);
  const waiting = live.sessions.filter((entry) => entry.state === "waiting").length;
  const working = live.sessions.filter((entry) => entry.state === "working").length;
  return (
    <div {...stylex.props(styles.frame)}>
      <div ref={card} {...stylex.props(styles.card)}>
        <header {...stylex.props(styles.cardHeader)}>
          <h3 {...stylex.props(styles.cardTitle)}>Sessions</h3>
          {waiting > 0 && (
            <span {...stylex.props(styles.mark, styles.needsYou)}>{waiting} need you</span>
          )}
          {working > 0 && (
            <span {...stylex.props(styles.mark, styles.wide)}>
              <span aria-hidden="true" {...stylex.props(styles.working)} />
              {working} working
            </span>
          )}
          <span {...stylex.props(ui.grow)} />
          <SegmentedControl<"desk" | "board">
            label="Layout"
            value={layout}
            onChange={(value) => {
              setReturned(false);
              setLayout(value);
            }}
            options={[
              { value: "board", label: "Board", icon: "sessions", shortcut: "Esc" },
              { value: "desk", label: "Desk", icon: "panelLeft" },
            ]}
          />
          <button
            type="button"
            aria-label="New session"
            {...stylex.props(ui.button, ui.pressable, styles.newSession)}
          >
            <Icon name="plus" size={13} />
            <span {...stylex.props(styles.wide)}>New session</span>
          </button>
        </header>
        {layout === "desk" ? (
          <Desk live={live} selected={selected} onSelect={setSelected} />
        ) : (
          <Board
            live={live}
            onOpen={(id) => {
              setSelected(id);
              live.read(id);
              setLayout("desk");
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The workspace list with Sessions at its head. */
function Entry() {
  const rows: {
    icon: IconName;
    repository?: string;
    label: string;
    mark?: "needs" | "arc" | "dot";
    detail?: string;
    current?: boolean;
  }[] = [
    { icon: "commit", label: "main", repository: "trail-notes", detail: "3" },
    { icon: "claude", label: "Format trail durations", repository: "trail-notes", mark: "needs" },
    {
      icon: "claude",
      label: "Cache the branch list",
      repository: "med",
      mark: "arc",
      current: true,
    },
    {
      icon: "codex",
      label: "Show hours in long durations",
      repository: "trail-notes",
      mark: "arc",
    },
    {
      icon: "claude",
      label: "Load book covers as they scroll in",
      repository: "reader",
      mark: "dot",
    },
    { icon: "vault", label: "Notes" },
  ];
  return (
    <div {...stylex.props(styles.sidebar)}>
      <button type="button" {...stylex.props(styles.navRow, styles.sessionsRow)}>
        <Icon name="sessions" size={14} />
        <span {...stylex.props(styles.navName)}>Sessions</span>
        <span {...stylex.props(styles.navDetail, styles.needsYou)}>2 need you</span>
        <span aria-hidden="true" {...stylex.props(styles.working)} />
      </button>
      <div {...stylex.props(styles.navHeading)}>
        <span {...stylex.props(ui.label)}>Workspaces</span>
      </div>
      {rows.map((row) => (
        <button
          key={row.label}
          type="button"
          {...stylex.props(styles.navRow, row.current && styles.navCurrent)}
        >
          <Icon name={row.icon} size={14} />
          <span {...stylex.props(styles.navName)}>
            {row.repository && <span {...stylex.props(styles.faint)}>{row.repository} / </span>}
            {row.label}
          </span>
          {row.mark === "needs" ? (
            <span {...stylex.props(styles.navDetail, styles.needsYou)}>Needs you</span>
          ) : row.mark === "arc" ? (
            <span aria-hidden="true" {...stylex.props(styles.working)} />
          ) : row.mark === "dot" ? (
            <span aria-hidden="true" {...stylex.props(styles.dot)} />
          ) : (
            row.detail && <span {...stylex.props(styles.navDetail)}>{row.detail}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Each state of a row, still. */
function RowStates() {
  const [first] = deskSessions;
  const pick = (id: string) => deskSessions.find((entry) => entry.id === id)!;
  return (
    <div role="listbox" aria-label="Session rows" {...stylex.props(styles.states)}>
      {[first!, pick("durations"), pick("branch-cache"), pick("covers"), pick("vite")].map(
        (session) => (
          <SessionRow key={session.id} session={session} seconds={0} />
        ),
      )}
    </div>
  );
}

/**
 * Prototypes for a Sessions workspace: every agent session that Med follows,
 * front and centre, sorted by what each needs from the user.
 */
export function SessionsSection() {
  return (
    <Section
      id="sessions"
      title="Sessions"
      lede="Prototypes for one workspace that shows every agent session Med follows, sorted by what each needs from you. Answer a session here, or open its review. The sessions are samples: the working ones take a step every few seconds."
    >
      <Specimen
        title="In the workspace list"
        note="Sessions heads the list. It counts the sessions that need you, and turns while others work."
        surface="panel"
        span="half"
      >
        <Entry />
      </Specimen>
      <Specimen
        title="Session rows"
        note="A question, a review to read, work in progress, a new reply, and an older session."
        span="half"
      >
        <RowStates />
      </Specimen>
      <Specimen
        title="Sessions workspace"
        note="It opens on the Board: every session as a pane, and a question takes an answer in place. Click a pane to open it on the Desk, beside the other sessions; ↑ ↓ or J K move, and Esc returns to the Board."
        surface="panel"
        padded={false}
        zoomable={false}
      >
        <Workspace />
      </Specimen>
    </Section>
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
  // The sidebar's marks: Needs you, a turning arc, and an unread dot.
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

  // Rows
  states: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: "min(100%, 360px)",
    marginInline: "auto",
  },
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

  // The workspace card
  frame: { display: "flex", height: 680, padding: 6, backgroundColor: tokens.panel },
  card: {
    flex: "1",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: tokens.frame,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    height: 38,
    paddingInlineStart: 14,
    paddingInlineEnd: 6,
    boxSizing: "border-box",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  cardTitle: { margin: 0, fontSize: 13, fontWeight: 500 },
  newSession: { color: tokens.text },
  // Only a wide header has room.
  wide: { display: { default: "inline-flex", [narrow]: "none" } },

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
  detailHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    height: 52,
    paddingInlineStart: 16,
    paddingInlineEnd: 10,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  detailTitle: { flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 },
  detailName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontSize: 13,
    fontWeight: 500,
  },
  thread: { flex: "1", minHeight: 0 },
  ask: { paddingInline: 12, paddingBottom: 12 },

  // Board
  board: {
    flex: "1",
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
    gridAutoRows: "minmax(290px, 1fr)",
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
  paneWhere: { display: "flex", marginTop: 2, paddingInlineStart: 22 },
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
  paneAsk: { display: "flex", flexDirection: "column", gap: 8, width: "100%", cursor: "default" },
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
  paneButtons: { position: "relative", zIndex: 1, display: "flex", gap: 6 },
  above: { position: "relative", zIndex: 1 },
  small: { minHeight: 26, paddingInline: 10 },
  newPane: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 0,
    color: { default: tokens.faint, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },

  // The workspace list
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    width: "min(100%, 300px)",
    marginInline: "auto",
    paddingInline: 6,
  },
  navHeading: {
    display: "flex",
    alignItems: "center",
    height: 30,
    marginTop: 8,
    paddingInlineStart: 8,
  },
  navRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 28,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 450,
    textAlign: "left",
    cursor: "pointer",
  },
  sessionsRow: { color: tokens.text, fontWeight: 500 },
  navCurrent: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
    fontWeight: 500,
  },
  navName: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  navDetail: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
});
