import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentMessage } from "../../../shared/agent-inbox";
import type { SessionStep, SessionSummary } from "../../../shared/session-summary";
import { withSentMessages } from "../../data/agent-inbox";
import { createSessionStore } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { PermissionCard, SessionComposer } from "../session/SessionComposer";
import { SessionThread } from "../session/SessionThread";
import { OpenReviewButton, SessionsView, sortSessions } from "../sessions/SessionsView";
import { deskSessions, threadFor, type DeskSession } from "./sessions-fixture";
import { Section, Specimen } from "./Specimen";

type LiveSession = DeskSession & { upcoming: NonNullable<DeskSession["upcoming"]> };

/**
 * The sample sessions, live: a working session takes its next step every few
 * seconds, and an answer or a reply starts a turn.
 */
function useLiveSessions() {
  const [sessions, setSessions] = useState<LiveSession[]>(() => {
    const start = Date.now();
    return deskSessions.map((session) => ({
      ...session,
      upcoming: [...(session.upcoming ?? [])],
      updatedAt: start - session.ago * 60_000,
      ...(session.elapsed !== undefined && { turnStartedAt: start - session.elapsed * 1000 }),
    }));
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
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
                updatedAt: Date.now(),
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
  const change = (id: string, update: (session: LiveSession) => Partial<LiveSession>) =>
    setSessions((list) =>
      list.map((entry) =>
        entry.id === id ? { ...entry, updatedAt: Date.now(), ...update(entry) } : entry,
      ),
    );
  return {
    sessions,
    now,
    answer(id: string, option: string) {
      change(id, (session) =>
        option === "deny"
          ? {
              state: "idle",
              ask: undefined,
              reply: "Stopped before the tests: you denied the run.",
            }
          : {
              state: "working",
              ask: undefined,
              turnStartedAt: Date.now(),
              upcoming: [
                {
                  kind: "execute",
                  title: "Run the export tests",
                  command: "bun test tests/export.test.ts",
                },
                ...session.upcoming,
              ],
            },
      );
    },
    reply(id: string) {
      change(id, () => ({ state: "working", ask: undefined, turnStartedAt: Date.now() }));
    },
    read(id: string) {
      change(id, (session) => ({ unread: false, updatedAt: session.updatedAt }));
    },
  };
}
type Live = ReturnType<typeof useLiveSessions>;

/** A sample session as the host sends it to the Sessions page. */
function summaryOf(session: LiveSession): SessionSummary {
  const steps = session.steps.map((step, index): SessionStep => ({
    id: `${session.id}-${index}`,
    kind: step.kind,
    title: step.title,
    status: step.failed
      ? "failed"
      : session.state === "working" && index === session.steps.length - 1
        ? "running"
        : "done",
    ...(step.added !== undefined && { added: step.added }),
    ...(step.removed !== undefined && { removed: step.removed }),
  }));
  return {
    reviewId: session.id,
    sessionId: `${session.id}-session`,
    agent: session.agent,
    ...(session.agent === "acp" && { name: session.name }),
    state: session.state,
    updatedAt: session.updatedAt ?? Date.now(),
    title: session.title,
    repository: session.repository,
    branch: session.branch,
    sessions: [{ agent: session.agent, id: `${session.id}-session`, cwd: "/work" }],
    prompt: session.prompt,
    steps: steps.slice(-6),
    ...(session.reply && { reply: session.reply }),
    ...(session.turnStartedAt !== undefined && { turnStartedAt: session.turnStartedAt }),
    ...(session.ask && {
      ask:
        session.ask.kind === "permission"
          ? { kind: "permission", permission: session.ask.permission }
          : { kind: "review" },
    }),
    ...(session.changes && {
      changes: {
        files: session.changes.files,
        additions: session.changes.added,
        deletions: session.changes.removed,
      },
    }),
  };
}

/** The chosen sample session, as the Session pane shows it. */
function SampleSession({ session, live }: { session: LiveSession; live: Live }) {
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
      <header {...stylex.props(styles.header)}>
        <Icon name={session.agent === "acp" ? "agent" : session.agent} size={14} />
        <span {...stylex.props(styles.title)}>{session.title}</span>
        <OpenReviewButton onClick={() => {}} />
      </header>
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
                createdAt: new Date().toISOString(),
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

/** The Sessions page on sample sessions. */
function Sample({ empty = false }: { empty?: boolean }) {
  const live = useLiveSessions();
  const [selected, setSelected] = useState<string | null>(null);
  const sessions = useMemo(
    () => (empty ? [] : sortSessions(live.sessions.map(summaryOf))),
    [empty, live.sessions],
  );
  const unread = useMemo(
    () => new Set(live.sessions.filter((entry) => entry.unread).map((entry) => entry.id)),
    [live.sessions],
  );
  return (
    <div {...stylex.props(styles.window, empty && styles.short)}>
      <SessionsView
        sessions={sessions}
        loaded
        now={live.now}
        unread={unread}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          if (id) live.read(id);
        }}
        onOpenReview={() => {}}
        onAnswer={(summary, option) => live.answer(summary.reviewId, option)}
        renderSession={(summary) => (
          <SampleSession
            key={summary.reviewId}
            session={live.sessions.find((entry) => entry.id === summary.reviewId)!}
            live={live}
          />
        )}
      />
    </div>
  );
}

/** The Sessions page, on sample sessions. */
export function SessionsSection() {
  return (
    <Section
      id="sessions"
      title="Sessions"
      lede="Every agent session of the window's reviews, sorted by what each needs from you. The workspace list's Sessions row and the palette open it. The sessions are samples: the working ones take a step every few seconds."
    >
      <Specimen
        title="Sessions"
        note="It opens on the Board: every session as a pane, and a question takes an answer in place. Click a pane to open it on the Desk, beside the other sessions; ↑ ↓ or J K move, ⌘↵ opens the review, and Esc returns to the Board."
        surface="panel"
        padded={false}
        zoomable={false}
      >
        <Sample />
      </Specimen>
      <Specimen
        title="No sessions"
        note="The window's reviews have no agent sessions yet."
        surface="panel"
        padded={false}
        zoomable={false}
        span="half"
      >
        <Sample empty />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  window: { display: "flex", flexDirection: "column", height: 680 },
  short: { height: 360 },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 40,
    flexShrink: 0,
    paddingInlineStart: 16,
    paddingInlineEnd: 8,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  title: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
  },
  thread: { flex: "1", minHeight: 0 },
  ask: { paddingInline: 12, paddingBottom: 12 },
});
