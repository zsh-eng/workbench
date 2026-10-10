import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AgentPreset } from "../../../shared/owned-session";
import { agentName, type AgentSession, type PinMutation } from "../../../shared/saved-review";
import { withSentMessages, type AgentInbox } from "../../data/agent-inbox";
import { useOwnedSession } from "../../data/owned-session";
import { createSessionStore, type SessionItem } from "../../data/session-store";
import { followSession, sessionRunning, type SessionStreamState } from "../../data/session-stream";
import { tokens, ui } from "../../theme.stylex";
import { ActionMenu, ChoiceSelect } from "../Controls";
import { Icon } from "../Icon";
import { ToolButton } from "../ToolButton";
import { SessionComposer, type ComposerAttachment } from "./SessionComposer";
import { ReplyActionsContext, SessionThread, type ReplyActions } from "./SessionThread";

type PinSource = NonNullable<Extract<PinMutation, { add: unknown }>["add"]["source"]>;
/** The review's pins, for Pin to review on the agent's replies. */
export interface SessionPins {
  /** Pin IDs by `sessionId/itemId`. */
  pinned: ReadonlyMap<string, string>;
  pin(source: PinSource, text: string): Promise<void>;
  show(pinId: string): void;
}

/** Agents that Med can start in the review's repository. */
export interface SessionStarter {
  agents: AgentPreset[] | null;
  start(preset: string): Promise<void>;
}

/** The reply that streams now, until the transcript has the same text. */
function withStreaming(items: SessionItem[], streaming?: { id: string; text: string }) {
  const text = streaming?.text.trim();
  if (!text) return items;
  const head = text.slice(0, 200);
  const recent = items.slice(-6);
  if (recent.some((item) => item.kind === "agent" && item.text.trim().startsWith(head)))
    return items;
  return [
    ...items,
    { kind: "agent" as const, id: `streaming-${streaming!.id}`, at: Date.now(), text },
  ];
}

/** The menu that starts a new session with an installed agent. */
function NewSessionMenu({ starter }: { starter: SessionStarter }) {
  const available = starter.agents?.filter((agent) => agent.available) ?? [];
  if (!available.length) return null;
  return (
    <ActionMenu
      label="New session"
      sections={[
        available.map((agent) => ({
          label: `New ${agent.name} session`,
          onClick: () => void starter.start(agent.id).catch(() => {}),
        })),
      ]}
    >
      <Icon name="plus" size={15} />
    </ActionMenu>
  );
}

/**
 * The Session pane of a review without a session: the agents that Med can
 * start in the review's repository.
 */
export function SessionStart({
  starter,
  controls,
  repo,
}: {
  starter: SessionStarter;
  controls?: ReactNode;
  repo?: string;
}) {
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const agents = starter.agents;
  return (
    <section aria-label="Start a session" {...stylex.props(styles.panel)}>
      <header {...stylex.props(styles.header)}>
        <Icon name="agent" size={14} />
        <span {...stylex.props(styles.title)}>Session</span>
        {controls}
      </header>
      <div {...stylex.props(styles.start)}>
        <p {...stylex.props(styles.startLead)}>
          Start an agent in {repo ? <strong>{repo.split("/").at(-1)}</strong> : "this repository"}.
          It works beside the review, and your comments go to it with Send to agent.
        </p>
        {agents === null ? (
          <p {...stylex.props(styles.startNote)}>Looking for installed agents…</p>
        ) : (
          <ul {...stylex.props(styles.agents)}>
            {agents.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  disabled={!agent.available || starting !== null}
                  onClick={() => {
                    setStarting(agent.id);
                    setError(null);
                    starter
                      .start(agent.id)
                      .catch((reason: unknown) =>
                        setError(
                          reason instanceof Error ? reason.message : "The agent did not start.",
                        ),
                      )
                      .finally(() => setStarting(null));
                  }}
                  {...stylex.props(ui.button, ui.pressable, styles.agent)}
                >
                  <Icon name={agent.kind === "claude" ? "claude" : "agent"} size={14} />
                  <span {...stylex.props(styles.agentName)}>{agent.name}</span>
                  <span {...stylex.props(styles.agentNote)}>
                    {starting === agent.id ? "Starting…" : agent.available ? "" : "Not installed"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" {...stylex.props(styles.startNote, styles.startError)}>
            {error}
          </p>
        )}
        <p {...stylex.props(styles.startNote)}>
          Med starts the agent that you installed, with your sign-in. Add other ACP agents in{" "}
          <code>agents.json</code> in Med's state folder.
        </p>
      </div>
    </section>
  );
}

/** A file link in a reply: src/a.ts:12, src/a.ts#L12, or an absolute path in the repository. */
export function sessionLink(
  href: string,
  root?: string,
): { path: string; line?: number } | undefined {
  let value = href.replace(/^file:\/\//, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return undefined;
  const line = /(?::|#L)(\d+)(?:[:-]L?\d+)?$/.exec(value);
  let path = line ? value.slice(0, line.index) : value;
  if (path.startsWith("/")) {
    if (!root || !path.startsWith(`${root}/`)) return undefined;
    path = path.slice(root.length + 1);
  }
  path = path.replace(/^\.\//, "");
  if (!path || path.split("/").includes("..")) return undefined;
  return { path, ...(line ? { line: Number(line[1]) } : {}) };
}

/**
 * The agent sessions of a saved review, beside the review: the session's
 * thread, read from its transcript and followed while the agent works.
 */
export function SessionPanel({
  reviewId,
  sessions,
  root,
  onOpenPath,
  onClose,
  fetcher,
  inbox,
  attachments = [],
  onRemoveAttachment,
  pins,
  controls,
  starter,
}: {
  reviewId: string;
  /** Starts new sessions; without it the header has no New session menu. */
  starter?: SessionStarter;
  /** The column's pane controls, in place of the close button. */
  controls?: ReactNode;
  /** Without it, replies have no Pin to review. */
  pins?: SessionPins;
  fetcher?: typeof fetch;
  /** Messages to the agent; without it the panel only reads the session. */
  inbox?: AgentInbox;
  /** Text to add to the next message, such as GitHub comments. */
  attachments?: ComposerAttachment[];
  onRemoveAttachment?(id: string): void;
  sessions: AgentSession[];
  /** The repository's path, to open absolute links to its files. */
  root?: string;
  onOpenPath(path: string, line?: number): void;
  onClose(): void;
}) {
  const latest = sessions.at(-1)!.id;
  // A new session, such as one just started, comes to the front.
  const [pick, setPick] = useState({ latest, id: latest });
  const chosen = pick.latest === latest ? pick.id : latest;
  const setChosen = (id: string) => setPick({ latest, id });
  const session = sessions.find((entry) => entry.id === chosen) ?? sessions.at(-1)!;
  const owned = useOwnedSession(reviewId, session.id, fetcher);
  const [store] = useState(createSessionStore);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [state, setState] = useState<SessionStreamState>({
    status: "connecting",
    truncated: false,
    idle: true,
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    store.reset();
    void followSession(reviewId, session.id, store, setState, controller.signal, fetcher);
    return () => controller.abort();
  }, [reviewId, session.id, store, fetcher]);

  // The elapsed time moves while the agent works, and a quiet transcript
  // turns idle after a while without a new update.
  const ownedState = owned.state;
  const running = ownedState ? ownedState.status === "working" : sessionRunning(state, now);
  useEffect(() => {
    store.setRunning(running);
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, store]);

  const replyActions = useMemo<ReplyActions | null>(
    () =>
      pins
        ? {
            pinned: (itemId) => pins.pinned.get(`${session.id}/${itemId}`),
            pin: (item) =>
              pins.pin({ agent: session.agent, sessionId: session.id, itemId: item.id }, item.text),
            showPin: pins.show,
          }
        : null,
    [pins, session.id, session.agent],
  );
  const agent = agentName(session);
  const waiting = inbox?.state?.waiting.includes(session.id) ?? false;
  const messages = inbox?.state?.messages;
  const streaming = ownedState?.streaming;
  const shown = useMemo(() => {
    const sent = messages?.filter((message) => message.sessionId === session.id) ?? [];
    const items = withStreaming(
      sent.length ? withSentMessages(snapshot.items, sent) : snapshot.items,
      streaming,
    );
    return items === snapshot.items && snapshot.running === running
      ? snapshot
      : { ...snapshot, items, running };
  }, [snapshot, messages, session.id, streaming, running]);
  const needsYou = !!ownedState?.permission;
  const status = ownedState
    ? needsYou
      ? "Needs you"
      : ownedState.status === "starting"
        ? "Starting"
        : ownedState.status === "working"
          ? "Working"
          : ownedState.status === "exited"
            ? "Stopped"
            : "Idle"
    : state.status === "connecting"
      ? "Connecting"
      : state.status === "error"
        ? "Reconnecting"
        : state.status === "missing"
          ? "Unavailable"
          : running
            ? "Working"
            : waiting
              ? "Waiting for you"
              : "Idle";

  return (
    <section aria-label={`${agent} session`} {...stylex.props(styles.panel)}>
      <header {...stylex.props(styles.header)}>
        <Icon name={session.agent === "acp" ? "agent" : session.agent} size={14} />
        <span {...stylex.props(styles.title)} title={snapshot.title ?? `${agent} session`}>
          {snapshot.title ?? `${agent} session`}
        </span>
        <span {...stylex.props(styles.status)}>
          <span
            {...stylex.props(
              styles.dot,
              running && !needsYou && styles.dotLive,
              (needsYou || (!running && waiting)) && styles.dotWaiting,
            )}
          />
          {status}
        </span>
        {sessions.length > 1 && (
          <ChoiceSelect
            label="Session"
            value={session.id}
            choices={[...sessions].reverse().map((entry, index) => ({
              value: entry.id,
              label: `${agentName(entry)} ${index === 0 ? "· latest" : `· ${entry.id.slice(0, 8)}`}`,
            }))}
            onChange={setChosen}
          />
        )}
        {starter && <NewSessionMenu starter={starter} />}
        {controls ?? (
          <ToolButton
            icon="close"
            label="Hide session"
            aria-label="Hide session"
            onClick={onClose}
          />
        )}
      </header>
      {state.status === "missing" && !ownedState ? (
        <p {...stylex.props(styles.empty)}>{state.message}</p>
      ) : (
        <div {...stylex.props(styles.thread)}>
          <ReplyActionsContext.Provider value={replyActions}>
            <SessionThread
              snapshot={shown}
              now={running ? now : undefined}
              before={
                state.truncated ? (
                  <p {...stylex.props(styles.note)}>
                    The session is long; the thread starts with its latest work.
                  </p>
                ) : undefined
              }
              onOpenLink={(href) => {
                const link = sessionLink(href, root);
                if (link) onOpenPath(link.path, link.line);
              }}
            />
          </ReplyActionsContext.Provider>
        </div>
      )}
      {inbox && session.agent === "acp" && !ownedState ? (
        // Med ran this agent, and the host has stopped since: the thread stays, the agent does not.
        <p {...stylex.props(styles.note, styles.stopped)}>
          {agent} stopped with the Med host. Start a new session to continue.
        </p>
      ) : (
        inbox && (
          <SessionComposer
            key={session.id}
            agent={session.agent}
            name={agent}
            waiting={waiting}
            drafts={inbox.state?.drafts ?? []}
            attachments={attachments}
            onRemoveAttachment={(id) => onRemoveAttachment?.(id)}
            onSend={(message) => inbox.send({ sessionId: session.id, ...message })}
            owned={ownedState ? { state: ownedState, act: owned.act } : undefined}
          />
        )
      )}
    </section>
  );
}

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: tokens.canvas,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 40,
    flexShrink: 0,
    paddingInlineStart: 14,
    paddingInlineEnd: 6,
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
  status: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: tokens.faint },
  dot: { width: 6, height: 6, borderRadius: "50%", backgroundColor: tokens.lineStrong },
  dotLive: { backgroundColor: tokens.green },
  dotWaiting: { backgroundColor: tokens.accent },
  thread: { flex: "1", minHeight: 0 },
  note: { margin: 0, marginBottom: 8, color: tokens.faint, fontSize: 11.5, textAlign: "center" },
  stopped: { flexShrink: 0, marginInline: 12, marginBlock: 12 },
  start: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 20,
  },
  startLead: { margin: 0, color: tokens.text, fontSize: 13, lineHeight: 1.55 },
  startNote: { margin: 0, color: tokens.faint, fontSize: 11.5, lineHeight: 1.5 },
  startError: { color: tokens.red },
  agents: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  agent: {
    width: "100%",
    justifyContent: "flex-start",
    gap: 9,
    minHeight: 34,
    paddingInline: 10,
    color: tokens.text,
    fontSize: 12.5,
  },
  agentName: { fontWeight: 500 },
  agentNote: { marginInlineStart: "auto", color: tokens.faint, fontSize: 11.5 },
  empty: {
    margin: 0,
    padding: 24,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.6,
    textAlign: "center",
  },
});
