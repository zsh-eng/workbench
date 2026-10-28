import { useEffect, useRef, useState } from "react";
import { usageRoutes, type ThreadUsage } from "../../shared/model-usage";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// A thread's spend and its session's context (docs/SESSIONS.md#spend-and-context).
// The host reads only what the transcripts gained, so asking again is cheap;
// a working agent still asks at most every few seconds.

const PAUSE = 4000;
/** The last answer for each thread and session, so a revisit shows it at once. */
const kept = new Map<string, ThreadUsage>();

/**
 * The spend of a review's thread and the context of `sessionId`, asked
 * again when `version` changes, such as when the thread gains an update.
 * Null until the host answers.
 */
export function useThreadUsage(
  reviewId: string,
  sessionId: string,
  version: string,
  fetcher: typeof fetch = browserFetch,
): ThreadUsage | null {
  const key = `${reviewId}/${sessionId}`;
  const [usage, setUsage] = useState<{ key: string; value: ThreadUsage } | null>(null);
  const last = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    // Not a debounce: a stream of updates still gets an answer every pause.
    const wait = last.current?.key === key ? Math.max(0, last.current.at + PAUSE - Date.now()) : 0;
    const timer = setTimeout(() => {
      last.current = { key, at: Date.now() };
      // An answer for another session waits in `kept`, and shows on a revisit.
      createApi(fetcher, readBrowserToken())
        .call(usageRoutes.thread, { id: reviewId, session: sessionId })
        .then((value) => {
          kept.set(key, value);
          setUsage({ key, value });
        })
        .catch(() => {});
    }, wait);
    return () => clearTimeout(timer);
  }, [key, version, reviewId, sessionId, fetcher]);
  return usage?.key === key ? usage.value : (kept.get(key) ?? null);
}
