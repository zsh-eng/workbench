import type {
  SyncHistory,
  SyncHistoryGroup,
  SyncLostEdit,
} from "@zsh-eng/local-sync";

/**
 * Recent's rows. As in the activity sheet (sheet-rows.ts), nothing moves
 * while you look: the rows are arranged when the sheet opens. While it
 * stays open a row changes its words in place, a row that sync no longer
 * reports stays as it was (waiting changes read "Sent"), and a new row
 * joins the top of its part: lost edits, then what waits, then the groups,
 * newest first. The next opening arranges them again.
 */
export type RecentRow =
  | { id: string; type: "lost"; lost: SyncLostEdit; gone: boolean }
  | {
      id: "waiting";
      type: "waiting";
      waiting: NonNullable<SyncHistory["waiting"]>;
      gone: boolean;
    }
  | { id: string; type: "group"; group: SyncHistoryGroup; gone: boolean };

const PART: Record<RecentRow["type"], number> = {
  lost: 0,
  waiting: 1,
  group: 2,
};

export function recentRows(history: SyncHistory): RecentRow[] {
  return [
    ...history.lost.map(
      (lost): RecentRow => ({
        id: `lost:${lost.key}:${lost.at}`,
        type: "lost",
        lost,
        gone: false,
      }),
    ),
    ...(history.waiting
      ? [
          {
            id: "waiting" as const,
            type: "waiting" as const,
            waiting: history.waiting,
            gone: false,
          },
        ]
      : []),
    ...history.groups.map(
      (group): RecentRow => ({
        id: group.id,
        type: "group",
        group,
        gone: false,
      }),
    ),
  ];
}

/** The rows while the sheet stays open, from the held rows and the history now. */
export function holdRecentRows(
  held: readonly RecentRow[],
  next: readonly RecentRow[],
): RecentRow[] {
  const current = new Map(next.map((row) => [row.id, row]));
  let changed = false;
  const rows = held.map((row) => {
    const now = current.get(row.id);
    if (now) {
      if (now === row) return row;
      changed = true;
      return now;
    }
    if (row.gone) return row;
    changed = true;
    return { ...row, gone: true };
  });
  const present = new Set(held.map((row) => row.id));
  // Newest first, so each part's first arrival goes in last.
  for (const row of [...next].reverse()) {
    if (present.has(row.id)) continue;
    changed = true;
    let at = rows.findIndex((other) => PART[other.type] >= PART[row.type]);
    if (at === -1) at = rows.length;
    rows.splice(at, 0, row);
  }
  return changed ? rows : (held as RecentRow[]);
}
