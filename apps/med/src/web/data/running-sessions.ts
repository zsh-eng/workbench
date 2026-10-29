import { useEffect, useState } from "react";
import {
  runningSessionsSchema,
  sessionAdoptedSchema,
  type RunningSession,
  type SessionAdopt,
} from "../../shared/found-sessions";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// Running now: the Claude Code, Codex, and agy sessions that run on this
// computer, in Med or elsewhere (`GET /api/sessions/running`). The sidebar
// reads them again every few seconds while the page shows.

const POLL_MS = 10_000;

export function useRunningSessions(fetcher: typeof fetch = browserFetch) {
  const [sessions, setSessions] = useState<RunningSession[]>([]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible")
        try {
          const result = await createApi(fetcher, readBrowserToken()).json(
            "/api/sessions/running",
            runningSessionsSchema,
          );
          if (!stopped) setSessions(result.sessions);
        } catch {
          /* The next read tries again. */
        }
      if (!stopped) timer = setTimeout(() => void read(), POLL_MS);
    };
    void read();
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetcher, nonce]);
  return { sessions, refresh: () => setNonce((value) => value + 1) };
}

/**
 * Makes a running session a thread: Keep in Med for Claude Code and Codex,
 * as `med thread adopt` does, and Continue in Med for agy, whose
 * conversation Med then runs.
 */
export function keepRunningSession(session: RunningSession, fetcher: typeof fetch = browserFetch) {
  const body: SessionAdopt = {
    session: session.id,
    title: session.title.slice(0, 200),
    ...(session.agent === "agy" && { agent: "agy", ...(session.cwd && { repo: session.cwd }) }),
  };
  return createApi(fetcher, readBrowserToken()).json("/api/sessions/adopt", sessionAdoptedSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
