import { useEffect, useRef, useState } from "react";
import { usageRoutes, type ThreadUsage } from "../../shared/model-usage";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// A thread's spend and its session's context (docs/SESSIONS.md#spend-and-context).
// The host reads only what the transcripts gained, so asking again is cheap;
// a working agent still asks at most every few seconds.

const PAUSE = 4000;
/** The last answer for each thread, so a revisit shows it at once. */
const kept = new Map<string, ThreadUsage>();

/**
 * The spend of a session's thread and its context, asked again when
 * `version` changes, such as when the thread gains an update. Null until the
 * host answers.
 */
export function useThreadUsage(
  key: string,
  version: string,
  fetcher: typeof fetch = browserFetch,
  pollMs = 0,
): ThreadUsage | null {
  const [usage, setUsage] = useState<{ key: string; value: ThreadUsage } | null>(null);
  const last = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      last.current = { key, at: Date.now() };
      // An answer for another thread waits in `kept`, and shows on a revisit.
      createApi(fetcher, readBrowserToken())
        .call(usageRoutes.thread, { id: key })
        .then((value) => {
          kept.set(key, value);
          if (live) setUsage({ key, value });
        })
        .catch(() => {});
    };
    // Not a debounce: a stream of updates still gets an answer every pause.
    const wait = last.current?.key === key ? Math.max(0, last.current.at + PAUSE - Date.now()) : 0;
    const timer = setTimeout(load, wait);
    const interval = pollMs > 0 ? setInterval(load, pollMs) : undefined;
    return () => {
      live = false;
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [key, version, fetcher, pollMs]);
  return usage?.key === key ? usage.value : (kept.get(key) ?? null);
}
