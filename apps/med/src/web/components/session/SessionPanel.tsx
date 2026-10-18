import type { MentionSources } from "../../data/mentions";
import * as stylex from "@stylexjs/stylex";
import { Menu } from "@base-ui/react/menu";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AgentPreset, OwnedAction } from "../../../shared/owned-session";
import { agentName, type AgentSession, type PinMutation } from "../../../shared/saved-review";
import type { AgentMessageInput, SentComment } from "../../../shared/agent-inbox";
import {
  openIn,
  withSentMessages,
  type AgentInbox,
  type SentMessage,
} from "../../data/agent-inbox";
import { useOwnedSession } from "../../data/owned-session";
import { useQuietChrome } from "../../data/chrome";
import type { SessionItem } from "../../data/session-store";
import {
  followSession,
  keptSessionStore,
  readAhead,
  loadSessionPage,
  loadSessionTurns,
  sessionRunning,
  type SessionStreamState,
  type SessionTurn,
} from "../../data/session-stream";
import { picked, tokens, ui } from "../../theme.stylex";
import { QuietMenuRoot } from "../Controls";
import { tooltip } from "../ToolButton";
import { Icon } from "../Icon";
import { ToolButton } from "../ToolButton";
import { paneHandle } from "../PaneTree";
import { ZenContext } from "../ZenExit";
import { SessionComposer, type ComposerAttachment } from "./SessionComposer";
import { TurnMark } from "./SessionNotice";
import { ReplyActionsContext, SessionThread, type ReplyActions } from "./SessionThread";
import { FileRefsContext, type FileRefs } from "../FileRefs";
import type { TurnRecapProps } from "./TurnRecap";

type PinSource = NonNullable<Extract<PinMutation, { add: unknown }>["add"]["source"]>;
/** The review's pins, for Pin to review on the agent's replies. */
export interface SessionPins {
  /** Pin IDs by `sessionId/itemId`. */
  pinned: ReadonlyMap<string, string>;
  pin(source: PinSource, text: string): Promise<void>;
  show(pinId: string): void;
}

/** A message that the browser sent, until the host has it. */
interface Outgoing {
  id: string;
  input: AgentMessageInput;
  createdAt: string;
  /** The comments as they read when sent, to show at once. */
  comments: SentComment[];
  error?: string;
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

const turnTime = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The session's menu, named for its agent, in place of a row of icons: the
 * review's sessions, Show work, the turns to go to, and new sessions.
 */
function SessionMenu({
  agent,
  sessions,
  current,
  onChoose,
  showWork,
  onToggleWork,
  loadTurns,
  onTurn,
  starter,
  leads = false,
}: {
  agent: string;
  sessions: AgentSession[];
  current: string;
  onChoose(id: string): void;
  showWork: boolean;
  onToggleWork(): void;
  /** The session's prompts; without it the menu has no Turns. */
  loadTurns?(): Promise<SessionTurn[]>;
  onTurn(turn: SessionTurn): void;
  starter?: SessionStarter;
  /** The menu starts the header and names the pane, as quiet chrome has it. */
  leads?: boolean;
}) {
  const [turns, setTurns] = useState<SessionTurn[] | null>(null);
  const [error, setError] = useState(false);
  const available = starter?.agents?.filter((entry) => entry.available) ?? [];
  const item = (state: { highlighted: boolean }) =>
    stylex.props(ui.menuItem, styles.menuItem, state.highlighted && [ui.menuHighlighted, picked])
      .className;
  const check = (indicator: ReactNode) => <span {...stylex.props(styles.check)}>{indicator}</span>;
  const [open, setOpen] = useState(false);
  return (
    <QuietMenuRoot open={open} onOpenChange={setOpen} look={`${agent}\n${leads}`}>
      <Menu.Trigger
        aria-label={`${agent} session menu`}
        {...tooltip("Sessions, work, and turns")}
        {...stylex.props(ui.button, ui.pressable, styles.menuTrigger, leads && styles.leadTrigger)}
      >
        {agent}
        <Icon name="chevron" size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align={leads ? "start" : "end"}
          sideOffset={6}
          {...stylex.props(styles.menuPositioner)}
        >
          <Menu.Popup {...stylex.props(ui.popup, ui.pop, styles.menu)}>
            {sessions.length > 1 && (
              <>
                <Menu.RadioGroup value={current} onValueChange={(id) => onChoose(String(id))}>
                  {[...sessions].reverse().map((entry, index) => (
                    <Menu.RadioItem key={entry.id} value={entry.id} className={item}>
                      {check(
                        <Menu.RadioItemIndicator {...stylex.props(styles.indicator)}>
                          <Icon name="check" size={14} />
                        </Menu.RadioItemIndicator>,
                      )}
                      <span {...stylex.props(styles.menuLabel)}>
                        {agentName(entry)} {index === 0 ? "· latest" : `· ${entry.id.slice(0, 8)}`}
                      </span>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
                <Menu.Separator {...stylex.props(ui.separator)} />
              </>
            )}
            <Menu.CheckboxItem checked={showWork} onCheckedChange={onToggleWork} className={item}>
              {check(
                <Menu.CheckboxItemIndicator {...stylex.props(styles.indicator)}>
                  <Icon name="check" size={14} />
                </Menu.CheckboxItemIndicator>,
              )}
              <span {...stylex.props(styles.menuLabel)}>Show work</span>
            </Menu.CheckboxItem>
            {loadTurns && (
              <Menu.SubmenuRoot
                onOpenChange={(open) => {
                  if (!open) return;
                  setError(false);
                  loadTurns().then(setTurns, () => setError(true));
                }}
              >
                <Menu.SubmenuTrigger className={item}>
                  {check(null)}
                  <span {...stylex.props(styles.menuLabel)}>Turns</span>
                  <span {...stylex.props(styles.submenuArrow)}>
                    <Icon name="chevron" size={12} />
                  </span>
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={4} {...stylex.props(styles.menuPositioner)}>
                    <Menu.Popup {...stylex.props(ui.popup, ui.pop, styles.turns)}>
                      {turns === null || error ? (
                        <p {...stylex.props(styles.turnsNote)}>
                          {error ? "The turns did not load." : "Reading the session…"}
                        </p>
                      ) : turns.length === 0 ? (
                        <p {...stylex.props(styles.turnsNote)}>No prompts yet.</p>
                      ) : (
                        [...turns].reverse().map((turn) => (
                          <Menu.Item
                            key={turn.offset}
                            onClick={() => onTurn(turn)}
                            className={(state) =>
                              stylex.props(
                                ui.menuItem,
                                styles.turn,
                                state.highlighted && [ui.menuHighlighted, picked],
                              ).className
                            }
                          >
                            <span {...stylex.props(styles.turnTime)}>{turnTime(turn.at)}</span>
                            <span {...stylex.props(styles.turnText)}>{turn.text}</span>
                          </Menu.Item>
                        ))
                      )}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>
            )}
            {available.length > 0 && (
              <>
                <Menu.Separator {...stylex.props(ui.separator)} />
                {available.map((entry) => (
                  <Menu.Item
                    key={entry.id}
                    onClick={() => void starter!.start(entry.id).catch(() => {})}
                    className={item}
                  >
                    {check(null)}
                    <span {...stylex.props(styles.menuLabel)}>New {entry.name} session</span>
                  </Menu.Item>
                ))}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </QuietMenuRoot>
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
  title,
  detail,
}: {
  starter: SessionStarter;
  controls?: ReactNode;
  repo?: string;
  /** The thread's name and place, as in the session's own header. */
  title?: string;
  detail?: string;
}) {
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Quiet chrome names the thread once, in the sidebar or the title band.
  const quiet = useQuietChrome();
  const agents = starter.agents;
  return (
    <section aria-label="Start a session" {...stylex.props(styles.panel)}>
      <header {...paneHandle} {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.title)}>
          {quiet ? "Session" : (title ?? "Session")}
          {detail && <span {...stylex.props(styles.detail)}>{detail}</span>}
        </span>
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
  fileRefs,
  onClose,
  fetcher,
  inbox,
  attachments = [],
  onRemoveAttachment,
  pins,
  controls,
  starter,
  title,
  detail,
  lead,
  mentions,
  onMentionsWanted,
  footer,
  openAgent,
  recap,
  onContinue,
}: {
  /** The recap of the thread's last turn, which ended unseen. It shows at
   * the end of the latest session; Reply goes to its message box. */
  recap?: Omit<TurnRecapProps, "onReply">;
  /** Continue in Med: forks a Claude session that a terminal runs into one
   * that Med runs, which the thread then follows. */
  onContinue?(sessionId: string): Promise<void>;
  /** In place of the message box of a session that the panel only reads,
   * such as one that Med found (FoundSession.tsx). */
  footer?: ReactNode;
  /** Shows this subagent's tab, by the tool call that started it, once for
   * each nonce, as when the sidebar opens it. */
  openAgent?: { id: string; nonce: number };
  reviewId: string;
  /** What @ can name in a message. */
  mentions?: MentionSources;
  onMentionsWanted?(): void;
  /** The pane is on screen, so a new workspace shows once this has its
   * thread, before its review loads (see WorkspaceViews). */
  lead?: boolean;
  /** The thread's name for the header, in place of the session's own. */
  title?: string;
  /** Where the thread works, such as its repository and branch. */
  detail?: string;
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
  /** The checkout's files: paths in prompts and replies that name one link to it. */
  fileRefs?: FileRefs;
  onClose(): void;
}) {
  const latest = sessions.at(-1)!.id;
  // A new session, such as one just started, comes to the front.
  const [pick, setPick] = useState({ latest, id: latest });
  const chosen = pick.latest === latest ? pick.id : latest;
  const setChosen = (id: string) => setPick({ latest, id });
  const session = sessions.find((entry) => entry.id === chosen) ?? sessions.at(-1)!;
  // A Claude session that Med does not run: open in a terminal or another
  // app, or nowhere. When Med resumes it, the session's controls come.
  const presence =
    openIn(inbox?.state, session.id) ??
    (inbox?.state?.resumable.includes(session.id) ? ("resumable" as const) : undefined);
  const owned = useOwnedSession(reviewId, session.id, fetcher, presence);
  const store = useMemo(() => keptSessionStore(reviewId, session.id), [reviewId, session.id]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [state, setState] = useState<SessionStreamState>({
    status: "connecting",
    truncated: false,
    idle: true,
  });
  const [now, setNow] = useState(() => Date.now());

  // A hidden workspace stops its stream, and showing it again connects anew.
  // Each session keeps its thread (keptSessionStore), so a revisit, or a
  // thread read ahead of the click, never shows an empty pane. The stream
  // then takes only the updates after the ones the thread holds, or a new
  // first view in one step. A read ahead that runs, as from the click that
  // opened the thread, ends first.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await readAhead(reviewId, session.id);
      if (controller.signal.aborted) return;
      await followSession(reviewId, session.id, store, setState, controller.signal, fetcher);
    })();
    return () => controller.abort();
  }, [reviewId, session.id, store, fetcher]);

  // The elapsed time moves while the agent works, and a quiet transcript
  // turns idle after a while without a new update.
  // Earlier pages of a long transcript. They belong to one first view: a
  // reconnect starts a new thread, and the pages go with the old one.
  const [loaded, setLoaded] = useState<{ generation?: number; start: number } | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | undefined>();
  // Finished turns fold their work into one row; the switch shows it in each.
  const [showWork, setShowWork] = useState(() => {
    try {
      return localStorage.getItem("med:work") === "shown";
    } catch {
      return false;
    }
  });
  const toggleWork = () => {
    setShowWork(!showWork);
    try {
      localStorage.setItem("med:work", showWork ? "folded" : "shown");
    } catch {
      /* Storage can be unavailable. */
    }
  };
  const start =
    loaded && loaded.generation === state.generation ? loaded.start : (state.start ?? 0);
  const pageable = session.agent !== "acp" && state.status === "live";
  const generation = useRef(state.generation);
  useLayoutEffect(() => {
    generation.current = state.generation;
  });
  const loadPage = useCallback(
    async (before: number) => {
      const requested = generation.current;
      const page = await loadSessionPage(reviewId, session.id, before, fetcher);
      // A first view that came meanwhile has its own start; the page is not its.
      if (generation.current !== requested) throw new Error("The thread started again.");
      store.prepend(page.events);
      setLoaded({ generation: requested, start: page.start });
      return page.start;
    },
    [reviewId, session.id, fetcher, store],
  );
  const earlier = useMemo(
    () =>
      pageable && start > 0
        ? {
            loading: loadingEarlier,
            failed: earlierFailed,
            load: async () => {
              setLoadingEarlier(true);
              setEarlierFailed(false);
              try {
                await loadPage(start);
              } catch {
                // The button stays; a click reads the page again.
                setEarlierFailed(true);
              } finally {
                setLoadingEarlier(false);
              }
            },
          }
        : undefined,
    [pageable, start, loadingEarlier, earlierFailed, loadPage],
  );
  // A turn from the index: load pages until its prompt is in the thread.
  const showTurn = async (turn: SessionTurn) => {
    let from = start;
    setLoadingEarlier(true);
    try {
      while (from > turn.offset) from = await loadPage(from);
    } finally {
      setLoadingEarlier(false);
    }
    const items = store.getSnapshot().items;
    const prompt =
      items.find((item) => item.kind === "user" && item.at === turn.at) ??
      items.find(
        (item) =>
          item.kind === "user" &&
          item.content.some(
            (block) =>
              block.type === "text" && block.text.trim().startsWith(turn.text.slice(0, 60)),
          ),
      );
    if (prompt) setReveal({ id: prompt.id, nonce: Date.now() });
  };
  const ownedState = owned.state;
  // Med's runner tells what its session does. While it waits, a transcript
  // that changed after it holds another process's turn, such as Claude Code's
  // in a terminal or the Claude app: the transcript tells, as for a session
  // that Med does not run.
  const othersTurn =
    ownedState?.status !== "working" &&
    ownedState?.status !== "starting" &&
    (state.modifiedAt ?? 0) > (ownedState?.updatedAt ?? 0) &&
    sessionRunning(state, now);
  const runner = othersTurn ? undefined : ownedState;
  const running = runner ? runner.status === "working" : sessionRunning(state, now);
  // A turn that a restart cut waits for the reader: Med never continues it
  // alone, because it may have stopped in the middle of a migration or a push.
  const halt = runner?.halt;
  const [haltError, setHaltError] = useState<string>();
  const onHalt = (action: OwnedAction) => {
    setHaltError(undefined);
    owned
      .act(action)
      .catch((reason: unknown) =>
        setHaltError(reason instanceof Error ? reason.message : "The agent did not respond."),
      );
  };
  const endMark =
    halt?.kind === "interrupted" ? (
      <TurnMark
        title="Interrupted by a restart"
        {...(halt.at ? { at: turnTime(halt.at) } : {})}
        actions={[
          { label: "Continue", primary: true, run: () => onHalt({ action: "continue" }) },
          { label: "Dismiss", run: () => onHalt({ action: "dismiss" }) },
        ]}
      >
        {haltError ??
          `The turn stopped before it ended. Continue asks ${agentName(session)} to go on from here.`}
      </TurnMark>
    ) : halt?.kind === "stopped" ? (
      // In place of "Worked for", which would read as a turn that ended; the
      // notice above the composer has the reason and Restart.
      <TurnMark
        title={`${agentName(session)} stopped`}
        {...(halt.at ? { at: turnTime(halt.at) } : {})}
      />
    ) : undefined;
  useEffect(() => {
    store.setRunning(running);
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, store]);

  // The agent writes paths from its own folder.
  const sessionFileRefs = useMemo(
    () => (fileRefs ? { ...fileRefs, cwd: session.cwd || undefined } : null),
    [fileRefs, session.cwd],
  );
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
  // Messages on their way to the host show at once, as in a chat app. The
  // host keeps the browser's ID, so the row stays when its answer comes.
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const post = (message: Outgoing) => {
    setOutgoing((list) =>
      list.map((entry) => (entry.id === message.id ? { ...entry, error: undefined } : entry)),
    );
    inbox!.send({ ...message.input, id: message.id }).then(
      () => setOutgoing((list) => list.filter((entry) => entry.id !== message.id)),
      (reason: unknown) =>
        setOutgoing((list) =>
          list.map((entry) =>
            entry.id === message.id
              ? { ...entry, error: reason instanceof Error ? reason.message : "Not sent." }
              : entry,
          ),
        ),
    );
  };
  const send = (input: Omit<AgentMessageInput, "sessionId">) => {
    const drafts = inbox?.state?.drafts ?? [];
    const message: Outgoing = {
      id: crypto.randomUUID(),
      input: { sessionId: session.id, ...input },
      createdAt: new Date().toISOString(),
      comments: input.noteIds.flatMap((id) =>
        drafts
          .filter((draft) => draft.id === id)
          .map(({ id: _id, replies: _replies, ...comment }) => comment),
      ),
    };
    setOutgoing((list) => [...list, message]);
    post(message);
  };
  const sending = new Set(outgoing.flatMap((message) => message.input.noteIds));
  const shown = useMemo(() => {
    const sent: SentMessage[] = [
      ...(messages
        ?.filter(
          (message) =>
            message.sessionId === session.id && !outgoing.some((entry) => entry.id === message.id),
        )
        .map((message) =>
          presence && presence !== "resumable" && message.delivery === "pending"
            ? { ...message, waitsFor: presence }
            : message,
        ) ?? []),
      ...outgoing
        .filter((message) => message.input.sessionId === session.id)
        .map((message): SentMessage => {
          const { input } = message;
          return {
            id: message.id,
            sessionId: input.sessionId,
            agent: session.agent,
            text: input.text,
            noteIds: input.noteIds,
            ...(message.comments.length ? { comments: message.comments } : {}),
            attachmentCount: input.attachments?.length ?? 0,
            createdAt: message.createdAt,
            delivery: message.error ? "failed" : "sending",
            ...(message.error
              ? {
                  error: message.error,
                  retry: () => post(message),
                  discard: () =>
                    setOutgoing((list) => list.filter((entry) => entry.id !== message.id)),
                }
              : {}),
          };
        }),
    ];
    const items = withStreaming(
      sent.length ? withSentMessages(snapshot.items, sent) : snapshot.items,
      streaming,
    );
    return items === snapshot.items && snapshot.running === running
      ? snapshot
      : { ...snapshot, items, running };
    // post changes each render; the rows take it when the list changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, messages, outgoing, session.id, session.agent, streaming, running, presence]);
  const needsYou = !!ownedState?.permission;
  const panel = useRef<HTMLElement>(null);
  const turnRecap = useMemo(
    () =>
      recap && session.id === latest
        ? {
            ...recap,
            onReply: () =>
              panel.current?.querySelector<HTMLTextAreaElement>("form textarea")?.focus(),
          }
        : undefined,
    [recap, session.id, latest],
  );
  const zen = useContext(ZenContext);
  const quiet = useQuietChrome();
  // The first view has not come, and no earlier thread stays meanwhile.
  const loading = state.status === "connecting" && !snapshot.items.length;
  const status = runner
    ? halt
      ? halt.kind === "interrupted"
        ? "Interrupted"
        : "Stopped"
      : needsYou
        ? "Needs you"
        : runner.status === "starting"
          ? "Starting"
          : runner.status === "working"
            ? "Working"
            : runner.status === "exited"
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
  // Zen keeps the agent and its status; a folded turn still opens.
  const menu = !zen && (
    <SessionMenu
      agent={agent}
      sessions={sessions}
      current={session.id}
      onChoose={setChosen}
      showWork={showWork}
      onToggleWork={toggleWork}
      loadTurns={pageable ? () => loadSessionTurns(reviewId, session.id, fetcher) : undefined}
      onTurn={(turn) => void showTurn(turn).catch(() => {})}
      starter={starter}
      leads={quiet}
    />
  );

  return (
    <section
      ref={panel}
      data-session-panel=""
      aria-label={`${agent} session`}
      // A workspace shows once this has its thread (see WorkspaceViews).
      data-pending={loading || undefined}
      data-lead={lead || undefined}
      {...stylex.props(styles.panel)}
    >
      <header {...paneHandle} {...stylex.props(styles.header, quiet && styles.quietHeader)}>
        {/* Quiet chrome names the thread in the sidebar or the title band; the
            agent's menu names the pane. */}
        {quiet ? (
          zen && <span {...stylex.props(styles.zenAgent)}>{agent}</span>
        ) : (
          <span
            {...stylex.props(styles.title)}
            title={title ?? snapshot.title ?? `${agent} session`}
          >
            {title ?? snapshot.title ?? `${agent} session`}
            {detail && <span {...stylex.props(styles.detail)}>{detail}</span>}
          </span>
        )}
        {quiet && menu}
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
        {quiet ? <span {...stylex.props(styles.grow)} /> : menu}
        {!zen &&
          (controls ?? (
            <ToolButton
              icon="close"
              label="Hide session"
              aria-label="Hide session"
              onClick={onClose}
            />
          ))}
      </header>
      {state.status === "missing" && !ownedState ? (
        <p {...stylex.props(styles.empty)}>{state.message}</p>
      ) : (
        <div {...stylex.props(styles.thread)}>
          <ReplyActionsContext.Provider value={replyActions}>
            <FileRefsContext.Provider value={sessionFileRefs}>
              <SessionThread
                snapshot={shown}
                loading={loading}
                earlier={earlier}
                reveal={reveal}
                openAgent={openAgent}
                showWork={showWork}
                recap={turnRecap}
                endMark={endMark}
                now={running ? now : undefined}
                before={
                  state.truncated && !pageable ? (
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
            </FileRefsContext.Provider>
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
            presence={presence}
            onContinue={onContinue && (() => onContinue(session.id))}
            drafts={(inbox.state?.drafts ?? []).filter((draft) => !sending.has(draft.id))}
            attachments={attachments}
            onRemoveAttachment={(id) => onRemoveAttachment?.(id)}
            onSend={send}
            owned={ownedState ? { state: ownedState, act: owned.act } : undefined}
            mentions={mentions}
            onMentionsWanted={onMentionsWanted}
          />
        )
      )}
      {!inbox && footer}
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
  // A pane's row: 38 pixels, as the review's tab row.
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 38,
    flexShrink: 0,
    paddingInlineStart: 14,
    paddingInlineEnd: 6,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  // The menu's label starts where the review's first tab label does.
  quietHeader: { gap: 6, paddingInlineStart: 6 },
  // The agent's name, without its menu, in zen mode.
  zenAgent: {
    paddingInlineStart: 8,
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
  },
  grow: { flex: "1" },
  leadTrigger: {
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
    fontSize: 12.5,
    fontWeight: 500,
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
  detail: { marginInlineStart: 8, color: tokens.faint, fontWeight: 400, fontSize: 12 },
  status: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: tokens.faint },
  dot: { width: 6, height: 6, borderRadius: "50%", backgroundColor: tokens.lineStrong },
  dotLive: { backgroundColor: tokens.green },
  dotWaiting: { backgroundColor: tokens.accent },
  thread: { flex: "1", minHeight: 0 },
  menuPositioner: { zIndex: 100, outline: "none" },
  menuTrigger: { flexShrink: 0, gap: 4, height: 24, paddingInline: 8, fontSize: 12 },
  menu: { minWidth: 220 },
  menuItem: { justifyContent: "flex-start", gap: 8 },
  menuLabel: { flex: "1", minWidth: 0 },
  check: { display: "inline-flex", flexShrink: 0, width: 14, color: tokens.accent },
  indicator: { display: "inline-flex", color: tokens.accent },
  submenuArrow: { display: "inline-flex", transform: "rotate(-90deg)", color: tokens.faint },
  turns: { width: 340, maxWidth: "calc(100vw - 32px)" },
  turnsNote: { margin: 0, padding: 10, color: tokens.faint, fontSize: 12 },
  turn: { justifyContent: "flex-start", gap: 10, minWidth: 0 },
  turnTime: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  turnText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
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
