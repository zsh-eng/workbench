import type {
  SyncHistory,
  SyncHistoryGroup,
  SyncLostEdit,
} from "@zsh-eng/local-sync";

/**
 * How Recent lays out the history:
 * - `sections`: lost edits, then what waits, then the groups by day.
 * - `timeline`: what waits, then lost edits among the groups, by time.
 * - `devices`: lost edits and what waits, then one row per device with
 *   what it last sent, this device's included.
 */
export type RecentArrangement = "sections" | "timeline" | "devices";

/**
 * Recent's rows. As in the activity sheet (sheet-rows.ts), nothing moves
 * while you look: the rows are arranged when the sheet opens. While it
 * stays open a row changes its words in place, a row that sync no longer
 * reports stays as it was (waiting changes read "Sent"), and a new row
 * joins its part by time, which for a new change is the top. The next
 * opening arranges them again.
 */
export type RecentRow = {
  /** Rows of a lower part come first. */
  part: number;
  gone: boolean;
} & (
  | { id: string; type: "lost"; lost: SyncLostEdit }
  | {
      id: "waiting";
      type: "waiting";
      waiting: NonNullable<SyncHistory["waiting"]>;
    }
  | { id: string; type: "group"; group: SyncHistoryGroup }
);

const lostRow = (lost: SyncLostEdit, part: number): RecentRow => ({
  id: `lost:${lost.key}:${lost.at}`,
  type: "lost",
  lost,
  part,
  gone: false,
});

const groupRow = (
  group: SyncHistoryGroup,
  part: number,
  id = group.id,
): RecentRow => ({ id, type: "group", group, part, gone: false });

export function recentRows(
  history: SyncHistory,
  arrange: RecentArrangement = "sections",
): RecentRow[] {
  const waiting: RecentRow[] = history.waiting
    ? [
        {
          id: "waiting",
          type: "waiting",
          waiting: history.waiting,
          part: arrange === "timeline" ? 0 : 1,
          gone: false,
        },
      ]
    : [];
  if (arrange === "timeline") {
    const timed = [
      ...history.lost.map((lost) => ({ at: lost.at, row: lostRow(lost, 1) })),
      ...history.groups.map((group) => ({
        at: group.to,
        row: groupRow(group, 1),
      })),
    ].sort((a, b) => b.at - a.at);
    return [...waiting, ...timed.map(({ row }) => row)];
  }
  const lost = history.lost.map((edit) => lostRow(edit, 0));
  if (arrange === "devices") {
    // A device's row keeps its place when its next group forms.
    const sent = history.groups.find((group) => group.direction === "sent");
    const latest = [...history.lastFrom.values(), ...(sent ? [sent] : [])]
      .sort((a, b) => b.to - a.to)
      .map((group) =>
        groupRow(group, 2, `device:${group.deviceId ?? "this device"}`),
      );
    return [...lost, ...waiting, ...latest];
  }
  return [
    ...lost,
    ...waiting,
    ...history.groups.map((group) => groupRow(group, 2)),
  ];
}

const timeOf = (row: RecentRow) =>
  row.type === "group"
    ? row.group.to
    : row.type === "lost"
      ? row.lost.at
      : row.waiting.since;

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
  // Newest first, so each part's first arrival goes in last. A new row
  // goes above the first row of its part that is no newer, so a group from
  // yesterday that arrives late lands among yesterday's rows.
  for (const row of [...next].reverse()) {
    if (present.has(row.id)) continue;
    changed = true;
    let at = rows.findIndex(
      (other) =>
        other.part > row.part ||
        (other.part === row.part && timeOf(other) <= timeOf(row)),
    );
    if (at === -1) at = rows.length;
    rows.splice(at, 0, row);
  }
  return changed ? rows : (held as RecentRow[]);
}
