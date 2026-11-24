import { useEffect, useState } from "react";
import { usageReportRoutes, type UsageReport } from "../../shared/usage-report";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// The Usage page's numbers (usage-report.ts on the host). The host's first
// read of a month of transcripts takes seconds; after that it reads only
// what changed, so a range asked again answers at once.

export const USAGE_PATH = "/usage";

/** Opens the Usage page. */
export function openUsage() {
  if (location.pathname !== USAGE_PATH) history.pushState(null, "", USAGE_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** The last answer for each range, so a revisit shows it at once. */
const kept = new Map<string, UsageReport>();

/**
 * The spend of the days from `from` to `to`, both included. While another
 * range loads, the last answer stays, marked as stale.
 */
export function useUsageReport(from: string, to: string, fetcher: typeof fetch = browserFetch) {
  const key = `${from}/${to}`;
  const [state, setState] = useState<{
    key: string;
    report: UsageReport | null;
    error: string | null;
  }>(() => ({ key, report: kept.get(key) ?? null, error: null }));
  useEffect(() => {
    let live = true;
    createApi(fetcher, readBrowserToken())
      .call(usageReportRoutes.report, { from, to })
      .then(
        (report) => {
          kept.set(key, report);
          if (live) setState({ key, report, error: null });
        },
        (reason: unknown) => {
          if (live)
            setState((last) => ({
              ...last,
              key,
              error: reason instanceof Error ? reason.message : "Med could not read the usage.",
            }));
        },
      );
    return () => {
      live = false;
    };
  }, [key, from, to, fetcher]);
  const report = state.key === key ? state.report : (kept.get(key) ?? state.report);
  return {
    report,
    /** The report is another range's, or none yet. */
    stale: !report || report.from !== from || report.to !== to,
    error: state.key === key ? state.error : null,
  };
}
