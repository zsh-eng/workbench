import { useSyncExternalStore } from "react";
import {
  foundSettingsSchema,
  sessionAdoptedSchema,
  type FoundUpdate,
  type SessionAdopt,
} from "../../shared/found-sessions";
import type { ThreadList } from "../../shared/threads";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// Found sessions: Claude Code and Codex sessions that worked in a registered
// repository lately, which Med lists by itself (src/host/session-index.ts).
// Keep in Med keeps one in the list however old it gets.

// Whether the host lists found sessions, as its last thread list said. One
// list per window feeds it (`useThreads`); the palette reads it.
let shown = true;
const listeners = new Set<() => void>();
export function noteFoundSettings(list: ThreadList) {
  const next = list.found?.shown ?? true;
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useFoundShown = () => useSyncExternalStore(subscribe, () => shown);

/** Shows or hides all found sessions, or hides one. */
export function updateFound(update: FoundUpdate, fetcher: typeof fetch = browserFetch) {
  return createApi(fetcher, readBrowserToken()).json("/api/found", foundSettingsSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

/** The palette's command that shows or hides found sessions. */
export function useFoundCommands(fetcher: typeof fetch = browserFetch) {
  const listed = useFoundShown();
  return [
    {
      id: "found-sessions",
      label: listed ? "Hide sessions not kept in Med" : "Show sessions not kept in Med",
      run: () => void updateFound({ shown: !listed }, fetcher).catch(() => {}),
    },
  ];
}

/** Keep in Med: keeps a session in the list, as `med thread adopt` does. */
export function keepSession(
  input: { session: string; title?: string },
  fetcher: typeof fetch = browserFetch,
) {
  const body: SessionAdopt = { session: input.session, ...(input.title && { title: input.title }) };
  return createApi(fetcher, readBrowserToken()).json("/api/sessions/adopt", sessionAdoptedSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
