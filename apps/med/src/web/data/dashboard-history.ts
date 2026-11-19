import {
  dashboardRoutes,
  sameValues,
  valuesOfSearch,
  type DashboardHistoryEntry,
} from "../../shared/dashboards";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { dashboardIdOf } from "./dashboards";
import { browserFetch } from "./live";

// A dashboard's History: each set of values that its page settled on, newest
// first. The host keeps them (host/dashboard-history.ts), so every window and
// `med dashboard history` read the same list.

const api = () => createApi(browserFetch, readBrowserToken());

export async function readHistory(id: string): Promise<DashboardHistoryEntry[]> {
  return (await api().call(dashboardRoutes.history, { id })).entries;
}

/** Keeps the values the page settled on; the host's list comes back. */
export async function keepInHistory(id: string, values: Record<string, string>, by?: "agent") {
  return (await api().call(dashboardRoutes.keep, { id, values, ...(by ? { by } : {}) })).entries;
}

// The dashboards that an agent showed lately, as `med dashboard open` or a
// link in its reply does, so History says that the agent chose those values.
const shows: { id: string; values: Record<string, string>; at: number }[] = [];
const AGENT_SHOW_MS = 30_000;

export function noteAgentShow(path: string) {
  const query = path.indexOf("?");
  const id = dashboardIdOf(query < 0 ? path : path.slice(0, query));
  if (!id) return;
  shows.push({ id, values: valuesOfSearch(query < 0 ? "" : path.slice(query)), at: Date.now() });
  if (shows.length > 20) shows.shift();
}

/** Whether an agent showed these values lately; each show counts once. The
 * page fills in the values that the agent left out, so those may differ. */
export function agentShowed(id: string, values: Record<string, string>) {
  const index = shows.findIndex(
    (show) =>
      show.id === id &&
      Date.now() - show.at < AGENT_SHOW_MS &&
      sameValues(
        Object.fromEntries(Object.keys(show.values).map((key) => [key, values[key] ?? ""])),
        show.values,
      ),
  );
  if (index < 0) return false;
  shows.splice(index, 1);
  return true;
}
