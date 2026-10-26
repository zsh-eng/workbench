import { useEffect, useState } from "react";
import { schedulesSchema, type Schedules } from "../../shared/schedules";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";

/** How often the Scheduled list reads again. */
const REFRESH_MS = 30_000;

/**
 * The Scheduled list (docs/SCHEDULES.md): the tabs' Claude Code jobs that
 * will fire. Med only reads them. It reads also while the section is closed,
 * since the section shows only when a job will fire.
 */
export function useSchedules(fetcher: typeof fetch) {
  const [state, setState] = useState<{
    data: Schedules | null;
    error: string | null;
    loading: boolean;
    /** When the list was read, for its ages. */
    at: number;
  }>({ data: null, error: null, loading: false, at: 0 });
  useEffect(() => {
    const api = createApi(fetcher, readBrowserToken());
    const abort = new AbortController();
    const read = async () => {
      setState((current) => ({ ...current, loading: true }));
      try {
        const data = await api.json("/api/schedules", schedulesSchema, { signal: abort.signal });
        setState({ data, error: null, loading: false, at: Date.now() });
      } catch (error) {
        if (abort.signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "Could not read the schedules.",
        }));
      }
    };
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    const focus = () => void read();
    window.addEventListener("focus", focus);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [fetcher]);
  return state;
}
