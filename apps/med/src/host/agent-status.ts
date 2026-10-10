import { stat } from "node:fs/promises";
import type { AgentStatus } from "../shared/agent-status";
import type { OwnedState } from "../shared/owned-session";
import type { AgentSession } from "../shared/saved-review";
import { findTranscript, transcriptIdle } from "./agent-transcripts";

/** A turn whose transcript has not changed for this long has stopped. */
const STALE_MS = 5 * 60_000;

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
  const reads = new Map<string, { modifiedAt: number; idle: boolean }>();
  const modifiedAt = async (path?: string) =>
    path ? ((await stat(path).catch(() => undefined))?.mtimeMs ?? 0) : 0;

  const transcript = async (session: AgentSession) => {
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
    const read = {
      modifiedAt: modified,
      idle: await transcriptIdle(session, path).catch(() => true),
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
    if (owned) {
      const { status, permission } = owned.state;
      return {
        ...base,
        state: permission
          ? "waiting"
          : status === "working" || status === "starting"
            ? "working"
            : "idle",
        updatedAt,
      };
    }
    if (waiting.has(session.id)) return { ...base, state: "waiting", updatedAt };
    const working = read && !read.idle && Date.now() - read.modifiedAt < STALE_MS;
    return { ...base, state: working ? "working" : "idle", updatedAt };
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
