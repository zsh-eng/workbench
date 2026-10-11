import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { SessionEvent } from "../shared/agent-session";
import type { AgentStatus } from "../shared/agent-status";
import type { OwnedState } from "../shared/owned-session";
import type { AgentSession, SavedReview } from "../shared/saved-review";
import { summarizeTurn, type SessionSummary } from "../shared/session-summary";
import { findTranscript, readTranscriptTail } from "./agent-transcripts";

type Turn = ReturnType<typeof summarizeTurn>;

/**
 * The Sessions page's view of saved reviews: each review's lead session with
 * its current turn. A transcript is read again only when it changes, and only
 * its tail, so a page of many reviews costs little.
 */
export function createSessionSummaries(sources: {
  /** The lead session's state (agent-status.ts). */
  status(reviewId: string, sessions: AgentSession[]): Promise<AgentStatus | undefined>;
  owned(sessionId: string): { state: OwnedState; updatedAt?: number } | undefined;
  waiting(reviewId: string): string[];
  /** An ACP session's updates, which Med keeps itself. */
  acpEvents(sessionId: string): Promise<SessionEvent[]>;
}) {
  const paths = new Map<string, string>();
  const turns = new Map<string, { version: number; turn: Turn }>();

  const turnOf = async (session: AgentSession, updatedAt: number): Promise<Turn> => {
    let path: string | undefined;
    if (session.agent !== "acp") {
      path = paths.get(session.id);
      if (!path) {
        path = await findTranscript(session);
        if (path) paths.set(session.id, path);
      }
      if (!path) return { steps: [] };
    }
    const version = path ? ((await stat(path).catch(() => undefined))?.mtimeMs ?? 0) : updatedAt;
    const known = turns.get(session.id);
    if (known?.version === version) return known.turn;
    const events = path
      ? await readTranscriptTail(session, path).catch(() => [])
      : await sources.acpEvents(session.id);
    const turn = summarizeTurn(events);
    turns.set(session.id, { version, turn });
    return turn;
  };

  /** The review's lead session and its turn; undefined for a review without sessions. */
  return async function summary(review: SavedReview): Promise<SessionSummary | undefined> {
    const sessions = review.sessions ?? [];
    const status = await sources.status(review.id, sessions);
    if (!status) return undefined;
    const session = sessions.find((entry) => entry.id === status.sessionId)!;
    const permission = sources.owned(session.id)?.state.permission;
    const target = review.targets[0];
    return {
      ...status,
      title: review.title,
      ...(target && {
        repository: basename(target.repo),
        root: target.repo,
        ...(target.branch && { branch: target.branch }),
      }),
      sessions,
      ...(await turnOf(session, status.updatedAt)),
      ...(permission
        ? { ask: { kind: "permission" as const, permission } }
        : sources.waiting(review.id).includes(session.id)
          ? { ask: { kind: "review" as const } }
          : {}),
      ...(review.totals && {
        changes: {
          files: review.totals.files,
          additions: review.totals.additions,
          deletions: review.totals.deletions,
        },
      }),
    };
  };
}
