import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useSyncExternalStore } from "react";
import { valuesOfSearch } from "../../../shared/dashboards";
import { rangeLabel } from "../../../shared/time-range";
import { dashboardIdOf } from "../../data/dashboards";
import { noteAgentShow } from "../../data/dashboard-history";
import type { SessionItem } from "../../data/session-store";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";

// A dashboard that an agent hands over in a thread: `med dashboard link`
// prints a link with the values it chose, and the reply shows it as a card
// that opens the dashboard beside the thread, as a review opens beside it.
// The thread's rail, and the pane's own menu, list each dashboard that its
// replies linked to.

/** Shows a dashboard's address beside the thread; `shown` is the one there now. */
export const DashboardBeside = createContext<{
  thread: string;
  open(path: string): void;
  shown?: string;
} | null>(null);

export interface ThreadDashboard {
  path: string;
  /** The link's text in the reply. */
  title: string;
  at: number;
}

// The dashboards that each thread's replies link to, as its session read
// them last, for the pane beside it, which is not inside the session.
const linkedByThread = new Map<string, readonly ThreadDashboard[]>();
const listeners = new Set<() => void>();
const NONE: readonly ThreadDashboard[] = [];
export function publishThreadDashboards(thread: string, links: readonly ThreadDashboard[]) {
  const before = linkedByThread.get(thread) ?? NONE;
  if (JSON.stringify(before) === JSON.stringify(links)) return;
  linkedByThread.set(thread, links);
  for (const listener of listeners) listener();
}
export function useThreadDashboards(thread: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => linkedByThread.get(thread) ?? NONE,
  );
}

/** The address of a dashboard of this Med's that a link names: its path and
 * values, on this page's origin or on this machine at this page's port. */
export function medDashboardPath(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return undefined;
  }
  if (!dashboardIdOf(url.pathname)) return undefined;
  const local = /^(?:127\.0\.0\.1|localhost|\[::1\])$/i;
  const ours =
    url.origin === location.origin ||
    (local.test(url.hostname) && local.test(location.hostname) && url.port === location.port);
  return ours ? `${url.pathname}${url.search}` : undefined;
}

/** The values of a dashboard's address in words: "prod-sg · api · Yesterday". */
export function valuesInWords(path: string, now = Date.now()) {
  const values = valuesOfSearch(path.slice(path.indexOf("?") + 1 || path.length));
  const { from, to, view, ...inputs } = values;
  return [
    ...Object.values(inputs),
    ...(from !== undefined ? [rangeLabel({ from, to: to ?? "now" }, now)] : []),
    ...(view ? [view] : []),
  ].join(" · ");
}

/** Opens it beside the thread, or else as the Dashboards page. */
export function openDashboardPath(path: string, beside: { open(path: string): void } | null) {
  // The values are the agent's: the dashboard's History says so.
  noteAgentShow(path);
  if (beside) return beside.open(path);
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** The dashboards that a thread's replies link to, newest first, each once. */
export function dashboardLinksOf(items: readonly SessionItem[]): ThreadDashboard[] {
  const found = new Map<string, ThreadDashboard>();
  for (const item of items) {
    if (item.kind !== "agent" || !item.text.includes("/dashboards/")) continue;
    for (const [, title, href] of item.text.matchAll(LINK)) {
      const path = medDashboardPath(href!);
      if (!path) continue;
      found.delete(path);
      found.set(path, { path, title: title!, at: item.at });
    }
  }
  return [...found.values()].reverse();
}

export function DashboardLinkCard({ path, text }: { path: string; text: string }) {
  const beside = useContext(DashboardBeside);
  const values = valuesInWords(path);
  const shown = beside?.shown === path;
  return (
    <button
      type="button"
      data-dashboard-card=""
      onClick={() => openDashboardPath(path, beside)}
      aria-label={`Open the dashboard: ${text}`}
      {...stylex.props(ui.pressable, styles.card, shown && styles.cardShown)}
    >
      <span {...stylex.props(styles.icon)}>
        <Icon name="display" size={16} />
      </span>
      <span {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.title)}>{text}</span>
        <span {...stylex.props(styles.meta)}>{values || "Dashboard in Med"}</span>
      </span>
      <span {...stylex.props(styles.open)}>
        {shown ? "Beside" : beside ? "Open beside" : "Open"}
      </span>
    </button>
  );
}

const styles = stylex.create({
  card: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "calc(100% + 20px)",
    maxWidth: 480,
    boxSizing: "border-box",
    marginBlock: 6,
    marginInline: -10,
    paddingBlock: 10,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: { default: tokens.raised, ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "start",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  cardShown: { borderColor: tokens.accentLine },
  icon: { display: "flex", color: tokens.accent },
  text: { display: "flex", flexDirection: "column", gap: 2, flex: "1", minWidth: 0 },
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13.5,
    fontWeight: 500,
  },
  meta: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 12,
  },
  open: { flexShrink: 0, color: tokens.accent, fontSize: 12.5, fontWeight: 500 },
});
