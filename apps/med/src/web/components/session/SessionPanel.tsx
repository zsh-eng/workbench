import type { MentionSources } from "../../data/mentions";
import * as stylex from "@stylexjs/stylex";
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
import { flushSync } from "react-dom";
import type { AgentPreset, OwnedAction } from "../../../shared/owned-session";
import { agentName, type AgentSession } from "../../../shared/saved-review";
import type { AgentMessageInput } from "../../../shared/agent-inbox";
import {
  openIn,
  withSentMessages,
  type AgentInbox,
  type SentMessage,
} from "../../data/agent-inbox";
import { useOwnedSession } from "../../data/owned-session";
import { useThreadUsage } from "../../data/thread-usage";
import { draftKeyOf, useOutbox, type Outgoing } from "../../data/outbox";
import {
  followSession,
  keptPages,
  keptSessionStore,
  prependPage,
  readAhead,
  loadSessionPage,
  loadSessionTurns,
  sessionRunning,
  STALE_MS,
  type SessionStreamState,
  type SessionTurn,
} from "../../data/session-stream";
import { basename } from "../../data/bar-context";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { ToolButton } from "../ToolButton";
import { paneHandle } from "../PaneTree";
import { InTitleBand, useInTitleBand } from "../Workspaces";
import { ComposerMeta, SessionComposer, type ComposerAttachment } from "./SessionComposer";
import { countedSpend, UsageChip, type ShownContext } from "./ThreadUsage";
import {
  SIDE_PANEL_MIN_PANE,
  SessionSidePanel,
  type SessionEnvironment,
  type ThreadLink,
} from "./SessionSidePanel";
import { TurnMark } from "./SessionNotice";
import {
  DashboardBeside,
  dashboardLinksOf,
  openDashboardPath,
  publishThreadDashboards,
  valuesInWords,
} from "./DashboardLinkCard";
import { ReplyActionsContext, SessionThread, type ReplyActions } from "./SessionThread";
import { FileRefsContext, type FileRefs } from "../FileRefs";
import type { TurnRecapProps } from "./TurnRecap";
import { useViewSetting, viewSettings } from "../../data/view-settings";
import { column } from "./session-styles";
import { useStreamedReplies, withStreamedReplies } from "./streamed-replies";

/** Agents that Med can start in the review's repository. */
export interface SessionStarter {
  agents: AgentPreset[] | null;
  start(preset: string): Promise<void>;
}

const turnTime = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The Session pane of a review without a session: the agents that Med can
 * start in the review's repository.
 */
export function SessionStart({
  starter,
  controls,
  repo,
  detail,
}: {
  starter: SessionStarter;
  controls?: ReactNode;
  repo?: string;
  /** Where the thread works, such as its repository and branch. */
  detail?: string;
}) {
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const agents = starter.agents;
  return (
    <section aria-label="Start a session" {...stylex.props(styles.panel)}>
      <header {...paneHandle} {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.title)}>
          Session
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
                  <Icon
                    name={agent.kind === "claude" || agent.kind === "codex" ? agent.kind : "agent"}
                    size={14}
                  />
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
 * A thread's agent session, beside its review: read from its transcript and
 * followed while the agent works.
 */
export function SessionPanel({
  threadId,
  session,
  root,
  onOpenPath,
  onOpenComment,
  fileRefs,
  onSideRoom,
  fetcher,
  inbox,
  attachments = [],
  onRemoveAttachment,
  bandTools = true,
  lead,
  waiting = false,
  mentions,
  onMentionsWanted,
  footer,
  openAgent,
  recap,
  onContinue,
  onFork,
  reviews,
  pulls,
  place,
}: {
  /** The session rail's Reviews, and its Pull requests. */
  reviews?: ThreadLink[];
  pulls?: ThreadLink[];
  /** The session rail's places: the repository and branch that the thread
   * shows, with what a click on each opens, and the branch where the agent
   * works. */
  place?: Pick<
    SessionEnvironment,
    | "repository"
    | "branch"
    | "onRepository"
    | "onBranch"
    | "agentBranch"
    | "agentRepository"
    | "onAgentBranch"
  >;
  /** The recap of the thread's last turn, which ended unseen. It shows at
   * the end of the latest session; Reply goes to its message box. */
  recap?: Omit<TurnRecapProps, "onReply">;
  /** Fork in Med: forks a Claude session that a terminal runs into one
   * that Med runs, which the thread then follows. */
  onContinue?(sessionId: string): Promise<void>;
  /** Fork from here, on a Claude session's replies: a new thread whose
   * session starts from this one's history up to the reply `at`. */
  onFork?(sessionId: string, at: string): Promise<void>;
  /** In place of the message box of a session that the panel only reads,
   * such as one that Med found (FoundSession.tsx). */
  footer?: ReactNode;
  /** Shows this subagent's tab, by the tool call that started it, once for
   * each nonce, as when the sidebar opens it. */
  openAgent?: { id: string; nonce: number };
  /** The session's thread: its key names it to the host. */
  threadId: string;
  /** What @ can name in a message. */
  mentions?: MentionSources;
  onMentionsWanted?(): void;
  /** The pane is on screen, so a new workspace shows once this has its
   * thread, before its review loads (see WorkspaceViews). */
  lead?: boolean;
  /** The workspace does not know its checkout yet, which names its pages in
   * the title band: it waits for it too, so the band does not change after
   * it shows. */
  waiting?: boolean;
  /** Whether its own controls show at the title band's end: false while the
   * pane hides or another pane fills the workspace. */
  bandTools?: boolean;
  fetcher?: typeof fetch;
  /** Messages to the agent; without it the panel only reads the session. */
  inbox?: AgentInbox;
  /** Text to add to the next message, such as GitHub comments. */
  attachments?: ComposerAttachment[];
  onRemoveAttachment?(id: string): void;
  session: AgentSession;
  /** The repository's path, to open absolute links to its files. */
  root?: string;
  onOpenPath(path: string, line?: number): void;
  /** Shows one of the review's comments at its line, from the message box. */
  onOpenComment?(id: string): void;
  /** The checkout's files: paths in prompts and replies that name one link to it. */
  fileRefs?: FileRefs;
  /** Whether the pane has room for the side panel, for its ⌘K command. */
  onSideRoom?(room: boolean): void;
}) {
  // A Claude session that Med does not run: open in a terminal or another
  // app, or nowhere. When Med resumes it, the session's controls come.
  const presence =
    openIn(inbox?.state, session.id) ??
    (inbox?.state?.resumable.includes(session.id) ? ("resumable" as const) : undefined);
  const owned = useOwnedSession(threadId, fetcher, presence);
  const store = useMemo(() => keptSessionStore(threadId), [threadId]);
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
  // opened the thread, ends first. Until the stream answers, the thread can
  // lack what the agent did meanwhile: a workspace that prepares to show it
  // waits for that out of sight (see WorkspaceViews).
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await readAhead(threadId);
      if (controller.signal.aborted) return;
      await followSession(
        threadId,
        store,
        (next) => {
          setState(next);
          if (next.status !== "connecting") setAnswered(true);
        },
        controller.signal,
        fetcher,
      );
    })();
    return () => {
      controller.abort();
      setAnswered(false);
    };
  }, [threadId, session.id, store, fetcher]);

  // The elapsed time moves while the agent works, and a quiet transcript
  // turns idle after a while without a new update.
  // Earlier pages of a long transcript. They belong to one first view: a
  // stream that resumes the kept thread keeps them, as when the thread shows
  // again, and a new first view takes them away with the old thread.
  const [loaded, setLoaded] = useState<{ generation?: number; start: number } | null>(() =>
    keptPages(store),
  );
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | undefined>();
  const start =
    loaded && loaded.generation === state.generation ? loaded.start : (state.start ?? 0);
  const pageable = session.agent !== "acp" && state.status === "live";
  const generation = useRef(state.generation);
  const startRef = useRef(start);
  const pagingRef = useRef(0);
  const loadingPageRef = useRef(false);
  useLayoutEffect(() => {
    generation.current = state.generation;
    startRef.current = start;
  });
  const earlier = useMemo(
    () =>
      pageable && start > 0
        ? {
            loading: loadingEarlier,
            failed: earlierFailed,
            load: async () => {
              if (loadingPageRef.current) return;
              const requested = generation.current;
              const token = ++pagingRef.current;
              loadingPageRef.current = true;
              setLoadingEarlier(true);
              setEarlierFailed(false);
              try {
                const page = await loadSessionPage(threadId, startRef.current, fetcher);
                if (generation.current !== requested || pagingRef.current !== token) return;
                prependPage(store, page);
                startRef.current = page.start;
                setLoaded({ generation: requested, start: page.start });
              } catch {
                // Only report failure if a newer jump or reset did not supersede this load.
                if (generation.current === requested && pagingRef.current === token)
                  setEarlierFailed(true);
              } finally {
                if (pagingRef.current === token) {
                  loadingPageRef.current = false;
                  setLoadingEarlier(false);
                }
              }
            },
          }
        : undefined,
    [pageable, start, loadingEarlier, earlierFailed, threadId, fetcher, store],
  );
  // The session's prompts, which { steps to, while earlier pages have not
  // loaded: read once for each first view of a long session.
  const [index, setIndex] = useState<{ generation?: number; turns: SessionTurn[] } | null>(null);
  const indexed = index && index.generation === state.generation ? index.turns : undefined;
  const longSession = pageable && (state.start ?? 0) > 0;
  useEffect(() => {
    if (!longSession) return;
    const generation = state.generation;
    let live = true;
    loadSessionTurns(threadId, fetcher).then(
      (turns) => live && setIndex({ generation, turns }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [longSession, threadId, session.id, fetcher, state.generation]);
  // A turn from the index: fetch all pages back to it first, then prepend
  // once so the store and layout rebuild once instead of once per page.
  const showTurn = async (turn: SessionTurn) => {
    const requested = generation.current;
    const token = ++pagingRef.current;
    let from = startRef.current;
    loadingPageRef.current = true;
    setLoadingEarlier(true);
    setEarlierFailed(false);
    try {
      const pages: {
        events: Awaited<ReturnType<typeof loadSessionPage>>["events"];
        start: number;
      }[] = [];
      while (from > turn.offset) {
        const page = await loadSessionPage(threadId, from, fetcher);
        if (generation.current !== requested || pagingRef.current !== token) return;
        pages.push(page);
        if (page.start >= from) break;
        from = page.start;
      }
      if (pages.length) {
        // Pages were fetched newest-to-oldest; prepend oldest-to-newest in one pass.
        const combined = pages.reverse().flatMap((page) => page.events);
        prependPage(store, { events: combined, start: from });
        startRef.current = from;
        setLoaded({ generation: requested, start: from });
      }
    } catch {
      if (generation.current === requested && pagingRef.current === token) setEarlierFailed(true);
      return;
    } finally {
      if (pagingRef.current === token) {
        loadingPageRef.current = false;
        setLoadingEarlier(false);
      }
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
  // An agent that takes a message during its turn offers Send now on a
  // queued one: Claude Code at its next step, Codex in the turn (steer).
  const takesMidTurn = session.agent === "claude" || !!ownedState?.capabilities?.steer;
  // Med's runner tells what its session does. While it waits, a transcript
  // that changed after it holds another process's turn, such as Claude Code's
  // in a terminal or the Claude app: the transcript tells, as for a session
  // that Med does not run.
  const othersTurn =
    ownedState?.status !== "working" &&
    ownedState?.status !== "starting" &&
    (state.modifiedAt ?? 0) > (ownedState?.updatedAt ?? 0) &&
    sessionRunning(state);
  const runner = othersTurn ? undefined : ownedState;
  const running = runner ? runner.status === "working" : sessionRunning(state);
  // A turn that a reboot or a kill cut waits for the reader: Med never
  // continues it alone, because it may have stopped in the middle of a
  // migration or a push.
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
        title="Interrupted"
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
    // Owned runners report idle directly; attached transcripts only need one
    // wake-up when STALE_MS passes since their last modification.
    if (!running || runner) return;
    const remaining = Math.max(250, (state.modifiedAt ?? Date.now()) + STALE_MS - Date.now() + 50);
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [running, runner, state.modifiedAt, store, now]);

  // The agent writes paths from its own folder.
  // Stable, as each reply is a memo: a new function would render every reply again.
  const openLink = useCallback(
    (href: string) => {
      const link = sessionLink(href, root);
      if (link) onOpenPath(link.path, link.line);
    },
    [root, onOpenPath],
  );
  const sessionFileRefs = useMemo(
    () => (fileRefs ? { ...fileRefs, cwd: session.cwd || undefined } : null),
    [fileRefs, session.cwd],
  );
  const replyActions = useMemo<ReplyActions | null>(() => {
    // Claude Code forks a session at a message of its transcript.
    const fork =
      onFork && session.agent === "claude"
        ? (item: { id: string }) => onFork(session.id, item.id)
        : undefined;
    return fork ? { fork } : null;
  }, [onFork, session.id, session.agent]);
  const agent = agentName(session);
  const messages = inbox?.state?.messages;
  const streamed = useStreamedReplies(snapshot.items, ownedState?.streaming);
  // Messages on their way to the host show at once, as in a chat app. The
  // host keeps the browser's ID, so the row stays when its answer comes. The
  // outbox keeps them across a reload, until the host has them.
  const known = useMemo(() => new Set(messages?.map((message) => message.id)), [messages]);
  const outbox = useOutbox(`${threadId}/${session.id}`, inbox?.send, known);
  const { outgoing } = outbox;
  const send = (input: AgentMessageInput) => {
    const drafts = inbox?.state?.drafts ?? [];
    const message: Outgoing = {
      id: crypto.randomUUID(),
      input,
      createdAt: new Date().toISOString(),
      comments: input.noteIds.flatMap((id) =>
        drafts
          .filter((draft) => draft.id === id)
          .map(({ id: _id, replies: _replies, ...comment }) => comment),
      ),
    };
    outbox.send(message);
  };
  const sending = new Set(outgoing.flatMap((message) => message.input.noteIds));
  // A queued message comes back into the box to edit, or goes; ↑ in the
  // empty box takes back all of them, as in Claude Code.
  const [restore, setRestore] = useState<{ text: string; nonce: number }>();
  const [takeNote, setTakeNote] = useState<{ text: string; error: boolean }>();
  const queued = (messages ?? []).filter(
    (message) =>
      message.sessionId === session.id && message.queued && message.delivery === "pending",
  );
  const takeBack = (ids: string[], edit: boolean) => {
    if (!inbox?.takeBack) return;
    setTakeNote(undefined);
    // Each comes back on its own: one that went meanwhile leaves the rest.
    void Promise.allSettled(ids.map((id) => inbox.takeBack!(id))).then((results) => {
      const taken = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const text = taken
        .map((message) => message.text)
        .filter(Boolean)
        .join("\n\n");
      if (edit && text) setRestore({ text, nonce: Date.now() });
      const went = results.length - taken.length;
      const left = edit
        ? taken.reduce(
            (sum, message) => sum + message.attachmentCount + (message.imageCount ?? 0),
            0,
          )
        : 0;
      if (went)
        setTakeNote({
          text:
            went === results.length && went === 1
              ? `${agentName(session)} has this message already, so it cannot come back.`
              : `${went} of them went to ${agentName(session)} already.`,
          error: true,
        });
      else if (left)
        setTakeNote({
          text:
            left === 1
              ? "Its attachment did not come back; add it again."
              : `Its ${left} attachments did not come back; add them again.`,
          error: false,
        });
    });
  };
  const shown = useMemo(() => {
    const sent: SentMessage[] = [
      ...(messages
        ?.filter(
          (message) =>
            message.sessionId === session.id && !outgoing.some((entry) => entry.id === message.id),
        )
        .map((message): SentMessage =>
          message.queued && message.delivery === "pending"
            ? {
                ...message,
                edit: () => takeBack([message.id], true),
                remove: () => takeBack([message.id], false),
                ...(message.afterTurn && takesMidTurn && inbox?.sendNow
                  ? {
                      sendNow: () => {
                        setTakeNote(undefined);
                        inbox.sendNow!(message.id).catch((error: unknown) =>
                          setTakeNote({
                            text:
                              error instanceof Error ? error.message : "Med did not send it now.",
                            error: true,
                          }),
                        );
                      },
                    }
                  : {}),
              }
            : message,
        ) ?? []),
      ...outgoing.map((message): SentMessage => {
        const { input } = message;
        return {
          id: message.id,
          sessionId: session.id,
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
                retry: () => outbox.retry(message.id),
                discard: () => outbox.discard(message.id),
              }
            : {}),
        };
      }),
    ];
    const items = withStreamedReplies(
      sent.length ? withSentMessages(snapshot.items, sent) : snapshot.items,
      streamed,
    );
    return items === snapshot.items && snapshot.running === running
      ? snapshot
      : { ...snapshot, items, running };
    // outbox changes each render; the rows take it when the list changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snapshot,
    messages,
    outgoing,
    session.id,
    session.agent,
    streamed,
    running,
    presence,
    takesMidTurn,
  ]);
  // Asked again as the transcript grows, at a turn's end, and every 15 s
  // while the agent or its subagents work (without re-rendering SessionPanel).
  const usage = useThreadUsage(
    threadId,
    `${state.modifiedAt ?? 0}:${running}`,
    fetcher,
    running ? 15_000 : 0,
  );
  const shownContext: ShownContext | undefined =
    usage?.context?.sessionId === session.id
      ? usage.context
      : ownedState?.context
        ? { used: ownedState.context.used, window: ownedState.context.total, windowFrom: "agent" }
        : undefined;
  // What fills the context, as Claude Code tells the agent that Med runs: the
  // side panel's Context card shows its parts, from the same reading.
  const breakdown = ownedState?.context?.breakdown;
  const panelContext: ShownContext | undefined = breakdown
    ? { used: ownedState!.context!.used, window: ownedState!.context!.total, windowFrom: "agent" }
    : shownContext;
  const panel = useRef<HTMLElement>(null);
  // The side panel shows where the thread's column keeps its width beside it,
  // unless the reader closed it.
  const [roomy, setRoomy] = useState(false);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const measure = () => {
      // A hidden workspace has no width; it keeps its layout for its return.
      if (node.clientWidth) setRoomy(node.clientWidth >= SIDE_PANEL_MIN_PANE);
    };
    measure();
    // In the frame that resizes the pane, as the pane tree does.
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const sideChoice = useViewSetting(viewSettings.sessionPanel);
  const inBand = useInTitleBand();
  const [background, setBackground] = useState<HTMLDivElement | null>(null);
  const [agentsSlot, setAgentsSlot] = useState<HTMLDivElement | null>(null);
  const turnRecap = useMemo(
    () =>
      recap
        ? {
            ...recap,
            onReply: () =>
              panel.current?.querySelector<HTMLTextAreaElement>("form textarea")?.focus(),
          }
        : undefined,
    [recap],
  );
  const side = roomy && sideChoice === "auto";
  useEffect(() => {
    if (!onSideRoom) return;
    onSideRoom(roomy);
    return () => onSideRoom(false);
  }, [roomy, onSideRoom]);
  const chosenModel = ownedState?.settings.find((setting) => setting.category === "model");
  const model =
    shownContext?.model ??
    // An ACP agent's model goes by the name that the agent gives it.
    (session.agent === "acp"
      ? chosenModel?.options.find((option) => option.value === chosenModel.value)?.name
      : undefined) ??
    chosenModel?.value;
  const sessionPlace: SessionEnvironment = {
    // A folder that Med does not know as a repository goes by its own name.
    repository: basename(session.cwd),
    ...place,
    agent: agentName(session),
    agentIcon:
      session.agent === "claude" ? "claude" : session.agent === "codex" ? "codex" : "agent",
    ...(model && model !== "default" ? { model } : {}),
    runs: ownedState
      ? ownedState.status === "exited"
        ? "Stopped"
        : "Runs in Med"
      : presence === "terminal"
        ? "In a terminal"
        : presence === "claude-app"
          ? "In the Claude app"
          : presence === "other-app"
            ? "In another app"
            : "Not running",
  };
  // The first view has not come, and no earlier thread stays meanwhile.
  const loading = state.status === "connecting" && !snapshot.items.length;
  // The dashboards that the replies link to, for the rail: each opens beside.
  const beside = useContext(DashboardBeside);
  const linked = useMemo(() => dashboardLinksOf(shown.items), [shown.items]);
  useEffect(() => publishThreadDashboards(threadId, linked), [threadId, linked]);
  const dashboards = linked.map(({ path, title }) => ({
    id: path,
    icon: "display" as const,
    label: title,
    hint: valuesInWords(path),
    current: beside?.shown === path,
    onOpen: () => openDashboardPath(path, beside),
  }));
  // The session's own control at the title band's end: the session rail's
  // toggle. The band names the thread, and the thread its agent; context and
  // spend are in the rail, or under the message box while the rail hides.
  const sessionTools = roomy && (
    <ToolButton
      icon="sessionRail"
      label={side ? "Hide session rail" : "Show session rail"}
      shortcut="Mod+Alt+Shift+B"
      aria-pressed={side}
      data-session-rail-toggle=""
      onClick={() => viewSettings.sessionPanel.set(side ? "closed" : "auto")}
    />
  );
  // The rail has Spend and Context with their detail, so the chip under the
  // message box would say both a second time.
  const spend = countedSpend(usage);
  const usageChip = side ? null : <UsageChip usage={spend} context={shownContext} />;

  // The message box, or what stands in its place, at the pane's foot: over
  // the thread's foot while the thread shows (SessionThread's footer).
  const bottom = (
    <>
      {inbox && session.agent === "acp" && !ownedState ? (
        // Med ran this agent, and the host has stopped since: the thread stays, the agent does not.
        <p {...stylex.props(styles.note, styles.stopped, column.bar)}>
          {agent} stopped with the Med host. Start a new session to continue.
        </p>
      ) : (
        inbox && (
          <SessionComposer
            key={session.id}
            draftKey={draftKeyOf(threadId, session.id)}
            agent={session.agent}
            name={agent}
            presence={presence}
            onContinue={onContinue && (() => onContinue(session.id))}
            drafts={(inbox.state?.drafts ?? []).filter((draft) => !sending.has(draft.id))}
            attachments={attachments}
            onRemoveAttachment={(id) => onRemoveAttachment?.(id)}
            onSend={send}
            owned={ownedState ? { state: ownedState, act: owned.act } : undefined}
            restore={restore}
            onOpenComment={onOpenComment}
            onDeleteComments={inbox.deleteComments}
            onTakeBack={
              queued.length
                ? () =>
                    takeBack(
                      queued.map((message) => message.id),
                      true,
                    )
                : undefined
            }
            notice={
              takeNote && (
                <p {...stylex.props(styles.note, takeNote.error && styles.takeError)}>
                  {takeNote.text}
                </p>
              )
            }
            mentions={mentions}
            onMentionsWanted={onMentionsWanted}
            usage={usageChip}
          />
        )
      )}
      {!inbox && footer}
      {!inbox && usageChip && (spend || shownContext) && (
        <ComposerMeta standalone>{usageChip}</ComposerMeta>
      )}
    </>
  );
  return (
    <section
      ref={panel}
      data-session-panel=""
      aria-label={`${agent} session`}
      // A workspace shows once this has its thread (see WorkspaceViews).
      data-pending={loading || waiting || undefined}
      data-catching-up={!answered || undefined}
      data-lead={lead || undefined}
      {...stylex.props(styles.panel)}
    >
      {/* Where the title band does not show this workspace, the pane's own
          row holds them, and moves the pane. */}
      {inBand ? (
        <InTitleBand session={bandTools && sessionTools} />
      ) : (
        bandTools && (
          <header {...paneHandle} {...stylex.props(styles.header)}>
            <span {...stylex.props(styles.grow)} />
            {sessionTools}
          </header>
        )
      )}
      <div {...stylex.props(styles.split)}>
        <div {...stylex.props(styles.main)}>
          {state.status === "error" && (
            <div role="status" {...stylex.props(styles.reconnecting)}>
              <span {...stylex.props(styles.reconnectingDot)} aria-hidden="true" />
              <span>{state.message ?? "Reconnecting to the session…"}</span>
            </div>
          )}
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
                    turns={indexed}
                    onTurn={(turn) => void showTurn(turn).catch(() => {})}
                    recap={turnRecap}
                    endMark={endMark}
                    backgroundIn={side ? background : undefined}
                    agentsIn={side ? agentsSlot : undefined}
                    before={
                      state.truncated && !pageable ? (
                        <p {...stylex.props(styles.note)}>
                          The session is long; the thread starts with its latest work.
                        </p>
                      ) : undefined
                    }
                    onOpenLink={openLink}
                    footer={bottom}
                  />
                </FileRefsContext.Provider>
              </ReplyActionsContext.Provider>
            </div>
          )}
          {state.status === "missing" && !ownedState && bottom}
        </div>
        {side && (
          <SessionSidePanel
            usage={spend}
            context={panelContext}
            breakdown={breakdown}
            working={running}
            reviews={reviews}
            dashboards={dashboards}
            pulls={pulls}
            place={sessionPlace}
            backgroundRef={setBackground}
            agentsRef={setAgentsSlot}
          />
        )}
      </div>
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
    height: tokens.bar,
    flexShrink: 0,
    boxSizing: "border-box",
    paddingInlineStart: 14,
    paddingInlineEnd: 6,
    color: tokens.muted,
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
  },
  grow: { flex: "1" },
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
  thread: { flex: "1", minHeight: 0 },
  // The thread and its message box, beside the side panel when it shows.
  split: { display: "flex", flex: "1", minHeight: 0, minWidth: 0 },
  main: {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minWidth: 0,
    minHeight: 0,
  },
  menuPositioner: { zIndex: 100, outline: "none" },
  menuTrigger: { flexShrink: 0, gap: 4, height: 24, paddingInline: 8, fontSize: 12 },
  reconnecting: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    flexShrink: 0,
    paddingBlock: 5,
    paddingInline: 12,
    backgroundColor: tokens.fill,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    color: tokens.muted,
    fontSize: 11.5,
  },
  reconnectingDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.warning,
    flexShrink: 0,
  },
  note: { margin: 0, marginBottom: 8, color: tokens.faint, fontSize: 11.5, textAlign: "center" },
  stopped: { flexShrink: 0, marginInline: 12, marginBlock: 12 },
  takeError: { color: tokens.red },
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
