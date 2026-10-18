import { z } from "zod";
import type { SessionEvent } from "../../shared/agent-session";
import { apiErrorMessage } from "../../shared/protocol";
import { readBrowserToken } from "./auth";
import { createApi, HttpError } from "./api";
import { browserFetch } from "./live";
import { createSessionStore, type SessionStore } from "./session-store";
import { readServerEvents } from "./sse";
import { reconnectPause } from "./reconnect";

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
  /** In a reset: the parts of the first view, this one included. */
  parts?: number;
  /** In a reset: the host's follower of the transcript. */
  feed?: string;
  /** In a reset: the updates after the ones the thread has, not a first view. */
  resumed?: boolean;
}

/** The updates of a host follower that each kept thread holds, and the
 * thread's size then. A stream that opens while the thread is unchanged asks
 * only for later updates, so a click after a read ahead, or a revisit, does
 * not take and build the first view again. */
const held = new WeakMap<SessionStore, { feed: string; count: number; size: number }>();

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
  let attempt = 0;
  // The first view, while its parts come. The store takes it in one step, so
  // the thread does not render and grow after each part.
  let first: { reset: Payload; events: SessionEvent[]; left: number } | undefined;
  while (!signal.aborted) {
    first = undefined;
    const has = held.get(store);
    const resume = has?.size === store.size() ? has : undefined;
    try {
      const response = await api.stream(
        `/api/reviews/${encodeURIComponent(reviewId)}/sessions/${encodeURIComponent(sessionId)}/events${
          resume
            ? `?${new URLSearchParams({ feed: resume.feed, count: String(resume.count) })}`
            : ""
        }`,
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
      attempt = 0;
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
          if (event.event === "reset")
            first = { reset: payload, events: [...payload.events], left: (payload.parts ?? 1) - 1 };
          else if (first) {
            first.events.push(...payload.events);
            first.left--;
          } else {
            store.applyAll(payload.events);
            const mark = held.get(store);
            if (mark)
              held.set(store, {
                ...mark,
                count: mark.count + payload.events.length,
                size: store.size(),
              });
          }
          if (first && first.left <= 0) {
            const { reset, events } = first;
            first = undefined;
            const resumed = reset.resumed && resume;
            if (resumed) store.applyAll(events);
            else store.replace(events);
            if (reset.feed)
              held.set(store, {
                feed: reset.feed,
                count: (resumed ? resumed.count : 0) + events.length,
                size: store.size(),
              });
            else held.delete(store);
            set({
              status: "live",
              generation: (state.generation ?? 0) + 1,
              truncated: reset.truncated ?? false,
              ...(reset.start !== undefined ? { start: reset.start } : {}),
            });
          }
          set({ idle: payload.idle, modifiedAt: payload.modifiedAt });
        },
        signal,
        MAX_EVENT,
      );
    } catch {
      if (signal.aborted) return;
      set({ status: "error", message: "Reconnecting to the session…" });
    }
    await reconnectPause(attempt++, signal);
  }
}

/** Each recent session keeps its thread, so a workspace that mounts again,
 * or a thread read ahead of a click, shows it at once. The stream's first
 * view then replaces it in one step, or the stream sends only the updates
 * after it. One for each tab that stays loaded (16). */
const KEPT = 16;
const kept = new Map<string, SessionStore>();
const reading = new Map<string, Promise<void>>();

/** Resolves when a read ahead of the session ends. A stream that waits for
 * it then asks only for the updates after the read's first view. */
export function readAhead(reviewId: string, sessionId: string) {
  return reading.get(`${reviewId}\0${sessionId}`) ?? Promise.resolve();
}

export function keptSessionStore(reviewId: string, sessionId: string) {
  const key = `${reviewId}\0${sessionId}`;
  const store = kept.get(key) ?? createSessionStore();
  kept.delete(key);
  kept.set(key, store);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
  return store;
}

/**
 * Reads a session's first view into its kept store and stops, as while the
 * pointer rests on its thread. `onReady` gets the store, such as to render
 * the newest replies' Markdown ahead. Resolves when the read ends.
 */
export async function prefetchSession(
  reviewId: string,
  sessionId: string,
  onReady?: (store: SessionStore) => void,
  fetcher: typeof fetch = browserFetch,
) {
  const key = `${reviewId}\0${sessionId}`;
  const store = keptSessionStore(reviewId, sessionId);
  if (store.getSnapshot().items.length || reading.has(key)) return;
  const controller = new AbortController();
  const read = followSession(
    reviewId,
    sessionId,
    store,
    (state) => {
      if (state.status === "connecting" || controller.signal.aborted) return;
      controller.abort();
      if (state.status === "live") onReady?.(store);
    },
    controller.signal,
    fetcher,
  ).finally(() => reading.delete(key));
  reading.set(key, read);
  await read;
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
