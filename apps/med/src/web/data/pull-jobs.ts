import { useEffect, useState } from "react";
import { pullJobSchema, type PullJob } from "../../shared/pull-workspace";
import { readBrowserToken } from "./auth";
import { createApi, HttpError } from "./api";
import { browserFetch } from "./live";
import { readServerEvents } from "./sse";

/** Asks the host to open a pull request: find its repository, check it out
 * in a worktree, save its review, and start `agent` there if set. */
export function startPull(url: string, agent: string | undefined, fetcher = browserFetch) {
  return createApi(fetcher, readBrowserToken()).json("/api/pulls", pullJobSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...(agent ? { agent } : {}) }),
  });
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** A job's state as it changes, or "lost" when the host no longer has it. */
export function usePullJob(jobId: string | undefined, fetcher = browserFetch) {
  const [state, setState] = useState<{ id: string; value: PullJob | "lost" } | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    const { signal } = controller;
    const api = createApi(fetcher, readBrowserToken());
    void (async () => {
      let delay = 1000;
      while (!signal.aborted) {
        let finished = false;
        // A finished job sends nothing more, so its stream closes.
        const stream = new AbortController();
        const stop = () => stream.abort();
        signal.addEventListener("abort", stop, { once: true });
        try {
          const response = await api.stream(
            `/api/pulls/${encodeURIComponent(jobId)}/events`,
            stream.signal,
          );
          if (response.status === 404) {
            setState({ id: jobId, value: "lost" });
            return;
          }
          if (!response.ok || !response.body) throw new HttpError("closed", response.status);
          delay = 1000;
          await readServerEvents(
            response.body,
            (event) => {
              const parsed = pullJobSchema.safeParse(JSON.parse(event.data));
              if (!parsed.success) return;
              setState({ id: jobId, value: parsed.data });
              finished = parsed.data.status !== "running";
              if (finished) stream.abort();
            },
            stream.signal,
          );
        } catch {
          if (signal.aborted) return;
        } finally {
          signal.removeEventListener("abort", stop);
        }
        if (finished) return;
        await pause(delay, signal);
        delay = Math.min(delay * 2, 30_000);
      }
    })();
    return () => controller.abort();
  }, [jobId, fetcher]);
  return state && state.id === jobId ? state.value : undefined;
}
