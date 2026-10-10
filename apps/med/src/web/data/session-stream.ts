import { z } from "zod";
import type { SessionEvent } from "../../shared/agent-session";
import { apiErrorMessage } from "../../shared/protocol";
import { readBrowserToken } from "./auth";
import { createApi, HttpError } from "./api";
import { browserFetch } from "./live";
import type { SessionStore } from "./session-store";
import { readServerEvents } from "./sse";

/** A session counts as working until its agent ends the turn, or until the
 * transcript has not changed for this long (the agent stopped or crashed). */
const STALE_MS = 5 * 60_000;
/** The host sends parts of up to 1 MiB; this leaves room for one large update. */
const MAX_EVENT = 4 * 1024 * 1024;

export interface SessionStreamState {
  status: "connecting" | "live" | "missing" | "error";
  /** The first view starts in the transcript's tail; earlier updates are left out. */
  truncated: boolean;
  /** The byte offset where the loaded updates start; earlier pages end there. */
  start?: number;
  /** Counts first views; each one replaces the thread and its earlier pages. */
  generation?: number;
  idle: boolean;
  modifiedAt?: number;
  message?: string;
}

interface Payload {
  events: SessionEvent[];
  idle: boolean;
  modifiedAt: number;
  truncated?: boolean;
  start?: number;
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });

export const sessionRunning = (state: SessionStreamState, now = Date.now()) =>
  state.status === "live" && !state.idle && now - (state.modifiedAt ?? 0) < STALE_MS;

/**
 * Follows one agent session of a saved review into a store until `signal`
 * aborts. Each connection starts with the host's first view, so a reconnect
 * replaces the thread rather than adding to it.
 */
export async function followSession(
  reviewId: string,
  sessionId: string,
  store: SessionStore,
  onState: (state: SessionStreamState) => void,
  signal: AbortSignal,
  fetcher: typeof fetch = browserFetch,
) {
  const api = createApi(fetcher, readBrowserToken());
  let state: SessionStreamState = { status: "connecting", truncated: false, idle: true };
  const set = (change: Partial<SessionStreamState>) => {
    state = { ...state, ...change };
    onState(state);
    store.setRunning(sessionRunning(state));
  };
  let delay = 1000;
  while (!signal.aborted) {
    try {
      const response = await api.stream(
        `/api/reviews/${encodeURIComponent(reviewId)}/sessions/${encodeURIComponent(sessionId)}/events`,
        signal,
      );
      if (response.status === 404) {
        const body: unknown = await response.json().catch(() => null);
        set({
          status: "missing",
          message: apiErrorMessage(body) ?? "The session's transcript is not on this computer.",
        });
        return;
      }
      if (!response.ok || !response.body)
        throw new HttpError("The session stream closed.", response.status);
      delay = 1000;
      await readServerEvents(
        response.body,
        (event) => {
          if (event.event !== "reset" && event.event !== "updates") return;
          let payload: Payload;
          try {
            payload = JSON.parse(event.data) as Payload;
          } catch {
            return;
          }
          if (event.event === "reset") {
            store.reset();
            set({
              status: "live",
              generation: (state.generation ?? 0) + 1,
              truncated: payload.truncated ?? false,
              ...(payload.start !== undefined ? { start: payload.start } : {}),
            });
          }
          store.applyAll(payload.events);
          set({ idle: payload.idle, modifiedAt: payload.modifiedAt });
        },
        signal,
        MAX_EVENT,
      );
    } catch {
      if (signal.aborted) return;
      set({ status: "error", message: "Reconnecting to the session…" });
    }
    await pause(delay, signal);
    delay = Math.min(delay * 2, 30_000);
  }
}

/** The updates before byte offset `before`, and where they start. */
export async function loadSessionPage(
  reviewId: string,
  sessionId: string,
  before: number,
  fetcher: typeof fetch = browserFetch,
) {
  return createApi(fetcher, readBrowserToken()).json(
    `/api/reviews/${encodeURIComponent(reviewId)}/sessions/${encodeURIComponent(sessionId)}/page?before=${before}`,
    z.object({ events: z.array(z.custom<SessionEvent>()), start: z.number() }),
  );
}

/** The session's prompts, with the byte offsets of their lines. */
export async function loadSessionTurns(
  reviewId: string,
  sessionId: string,
  fetcher: typeof fetch = browserFetch,
) {
  const result = await createApi(fetcher, readBrowserToken()).json(
    `/api/reviews/${encodeURIComponent(reviewId)}/sessions/${encodeURIComponent(sessionId)}/turns`,
    z.object({
      turns: z.array(z.object({ offset: z.number(), at: z.number(), text: z.string() })),
    }),
  );
  return result.turns;
}
export type SessionTurn = Awaited<ReturnType<typeof loadSessionTurns>>[number];
