import { stat } from "node:fs/promises";
import type { AgentStatus, ThreadTurn } from "../shared/agent-status";
import type { OwnedState } from "../shared/owned-session";
import type { AgentSession } from "../shared/saved-review";
import { findTranscript, transcriptTurn } from "./agent-transcripts";

/** A turn whose transcript has not changed for this long has stopped. */
const STALE_MS = 5 * 60_000;

/** What one read of a transcript's tail says. */
type TranscriptRead = { modifiedAt: number; idle: boolean; turn?: ThreadTurn };

/**
 * The states of saved reviews' sessions, from what the host knows: the
 * sessions that it runs, the agents that wait in `med review wait`, and the
 * transcripts of the others. A transcript is read again only when it changes.
 */
export function createAgentStatus(sources: {
  owned(sessionId: string): { state: OwnedState; updatedAt?: number } | undefined;
  waiting(reviewId: string): string[];
  /** Where Med keeps an ACP session's updates. */
  logPath?(sessionId: string): string;
}) {
  const paths = new Map<string, string>();
  const reads = new Map<string, TranscriptRead>();
  const modifiedAt = async (path?: string) =>
    path ? ((await stat(path).catch(() => undefined))?.mtimeMs ?? 0) : 0;

  const transcript = async (session: AgentSession): Promise<TranscriptRead | undefined> => {
    if (session.agent === "acp") return undefined;
    let path = paths.get(session.id);
    if (!path) {
      path = await findTranscript(session);
      if (!path) return undefined;
      paths.set(session.id, path);
    }
    const modified = await modifiedAt(path);
    const known = reads.get(path);
    if (known?.modifiedAt === modified) return known;
    const read: TranscriptRead = {
      modifiedAt: modified,
      ...(await transcriptTurn(session, path).catch(() => ({ idle: true }))),
    };
    reads.set(path, read);
    return read;
  };

  const sessionStatus = async (
    reviewId: string,
    session: AgentSession,
    waiting: Set<string>,
  ): Promise<AgentStatus> => {
    const base = {
      reviewId,
      sessionId: session.id,
      agent: session.agent,
      ...(session.name ? { name: session.name } : {}),
    };
    const owned = sources.owned(session.id);
    const read = await transcript(session);
    const updatedAt = Math.max(
      read?.modifiedAt ?? 0,
      owned?.updatedAt ?? 0,
      session.agent === "acp" ? await modifiedAt(sources.logPath?.(session.id)) : 0,
    );
    const turn = read?.turn;
    if (owned) {
      const { status, permission } = owned.state;
      // A permission request is what the turn waits on now.
      const asked = permission && {
        ...turn,
        activity: `Asks for permission: ${permission.title}`.slice(0, 200),
      };
      const shown = asked || turn;
      return {
        ...base,
        state: permission
          ? "waiting"
          : status === "working" || status === "starting"
            ? "working"
            : "idle",
        updatedAt,
        ...(shown && { turn: shown }),
      };
    }
    // The open `med review wait` call is not work: the turn shows what the
    // agent said before it.
    if (waiting.has(session.id))
      return { ...base, state: "waiting", updatedAt, turn: { ...turn, activity: undefined } };
    const working = read && !read.idle && Date.now() - read.modifiedAt < STALE_MS;
    return { ...base, state: working ? "working" : "idle", updatedAt, ...(turn && { turn }) };
  };

  /** The lead session's state; undefined for a review without sessions. */
  return async function reviewStatus(
    reviewId: string,
    sessions: AgentSession[],
  ): Promise<AgentStatus | undefined> {
    if (!sessions.length) return undefined;
    const waiting = new Set(sources.waiting(reviewId));
    const statuses = await Promise.all(
      sessions.map((session) => sessionStatus(reviewId, session, waiting)),
    );
    return (
      statuses.findLast((status) => status.state === "waiting") ??
      statuses.findLast((status) => status.state === "working") ??
      statuses.at(-1)
    );
  };
}
