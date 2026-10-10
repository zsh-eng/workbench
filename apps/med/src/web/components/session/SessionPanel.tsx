import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentSession, PinMutation } from "../../../shared/saved-review";
import { withSentMessages, type AgentInbox } from "../../data/agent-inbox";
import { createSessionStore } from "../../data/session-store";
import { followSession, sessionRunning, type SessionStreamState } from "../../data/session-stream";
import { tokens } from "../../theme.stylex";
import { ChoiceSelect } from "../Controls";
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

const AGENTS = { claude: "Claude", codex: "Codex" } as const;

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
}: {
  reviewId: string;
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
  const [chosen, setChosen] = useState(() => sessions.at(-1)!.id);
  const session = sessions.find((entry) => entry.id === chosen) ?? sessions.at(-1)!;
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
  const running = sessionRunning(state, now);
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
  const agent = AGENTS[session.agent];
  const waiting = inbox?.state?.waiting.includes(session.id) ?? false;
  const messages = inbox?.state?.messages;
  const shown = useMemo(() => {
    const sent = messages?.filter((message) => message.sessionId === session.id) ?? [];
    return sent.length ? { ...snapshot, items: withSentMessages(snapshot.items, sent) } : snapshot;
  }, [snapshot, messages, session.id]);
  const status =
    state.status === "connecting"
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
        <Icon name={session.agent} size={14} />
        <span {...stylex.props(styles.title)} title={snapshot.title ?? `${agent} session`}>
          {snapshot.title ?? `${agent} session`}
        </span>
        <span {...stylex.props(styles.status)}>
          <span
            {...stylex.props(
              styles.dot,
              running && styles.dotLive,
              !running && waiting && styles.dotWaiting,
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
              label: `${AGENTS[entry.agent]} ${index === 0 ? "· latest" : `· ${entry.id.slice(0, 8)}`}`,
            }))}
            onChange={setChosen}
          />
        )}
        <ToolButton icon="close" label="Hide session" aria-label="Hide session" onClick={onClose} />
      </header>
      {state.status === "missing" ? (
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
      {inbox && (
        <SessionComposer
          key={session.id}
          agent={session.agent}
          waiting={waiting}
          drafts={inbox.state?.drafts ?? []}
          attachments={attachments}
          onRemoveAttachment={(id) => onRemoveAttachment?.(id)}
          onSend={(message) => inbox.send({ sessionId: session.id, ...message })}
        />
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
  empty: {
    margin: 0,
    padding: 24,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.6,
    textAlign: "center",
  },
});
