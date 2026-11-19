import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  DASHBOARD_HISTORY_LIMIT,
  dashboardHistoryEntrySchema,
  historyValues,
  sameValues,
  type DashboardHistoryEntry,
} from "../shared/dashboards";

// The values each dashboard showed, newest first, for its History menu and
// `med dashboard history`: every window keeps them here, so another window
// and an agent see what the reader looked at. One small file in the state
// folder; the dashboards kept last stay when there are too many.

const DASHBOARDS = 200;
const fileSchema = z.object({
  dashboards: z.record(z.string(), z.array(dashboardHistoryEntrySchema)),
});

export type DashboardHistory = ReturnType<typeof createDashboardHistory>;

export function createDashboardHistory(file: string, now = Date.now) {
  let kept: Map<string, DashboardHistoryEntry[]> | undefined;
  let writing: Promise<unknown> = Promise.resolve();

  const load = async () => {
    if (kept) return kept;
    let read: Record<string, DashboardHistoryEntry[]> = {};
    try {
      read = fileSchema.parse(JSON.parse(await readFile(file, "utf8"))).dashboards;
    } catch {
      /* None yet, or a file that Med cannot read: it starts again. */
    }
    // Oldest first, so the map's order is the order in which each was kept.
    kept ??= new Map(
      Object.entries(read).sort(([, a], [, b]) => (a[0]?.at ?? 0) - (b[0]?.at ?? 0)),
    );
    return kept;
  };

  return {
    async list(id: string) {
      return (await load()).get(id) ?? [];
    },
    /** Keeps the values a dashboard settled on, and returns its list. */
    keep(id: string, values: Record<string, string>, by?: "agent") {
      const next = writing
        .catch(() => {})
        .then(async () => {
          const map = await load();
          const list = map.get(id) ?? [];
          const shown = historyValues(values);
          if (list[0] && sameValues(list[0].values, shown)) return list;
          // Values an agent chose stay its choice when they show again.
          const agent = by === "agent" || list.some((e) => e.by && sameValues(e.values, shown));
          const entries = [
            { values: shown, at: now(), ...(agent ? { by: "agent" as const } : {}) },
            ...list.filter((entry) => !sameValues(entry.values, shown)),
          ].slice(0, DASHBOARD_HISTORY_LIMIT);
          map.delete(id);
          map.set(id, entries);
          for (const old of [...map.keys()].slice(0, Math.max(0, map.size - DASHBOARDS)))
            map.delete(old);
          await mkdir(dirname(file), { recursive: true });
          const temporary = join(dirname(file), `.dashboard-history-${randomUUID()}.tmp`);
          await writeFile(temporary, JSON.stringify({ dashboards: Object.fromEntries(map) }), {
            mode: 0o600,
          });
          await rename(temporary, file);
          return entries;
        });
      writing = next;
      return next;
    },
  };
}
