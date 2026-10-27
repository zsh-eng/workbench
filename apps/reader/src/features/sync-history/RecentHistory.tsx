import {
  Collapse,
  SECTION_HEADING,
} from "@/features/background-activity/ActivitySheet";
import { cn } from "@/lib/utils";
import type { DeviceType } from "@/types/session";
import type {
  SyncFailure,
  SyncHistory,
  SyncHistoryGroup,
  SyncHistoryItem,
} from "@zsh-eng/local-sync";
import { format, isToday, isYesterday } from "date-fns";
import {
  CircleAlert,
  Clock,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Monitor,
  MonitorSmartphone,
  Smartphone,
  Tablet,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Fragment, useState, type ReactNode } from "react";
import {
  holdRecentRows,
  recentRows,
  type RecentArrangement,
  type RecentRow,
} from "./history-rows";

/** Every row is this tall: a title and up to two lines, so words that change never move a row. */
const ROW_HEIGHT = 72;
const DAY_HEIGHT = 26;
const WARN_TEXT = "text-[oklch(0.55_0.14_55)]";
const WARN_ICON = "text-[oklch(0.62_0.16_55)]";

/** How the list names devices; the app reads them from the server's device list. */
export interface DeviceNamer {
  name(deviceId: string | null): string;
  type(deviceId: string | null): DeviceType | null;
}

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function span(from: number, to: number): string {
  return to - from >= 60_000 ? `${time(from)}–${time(to)}` : time(to);
}

function dayLabel(at: number): string {
  if (isToday(at)) return "Today";
  if (isYesterday(at)) return "Yesterday";
  return format(at, "EEE d MMM");
}

const FAILURE_WORDS: Record<SyncFailure["kind"], string> = {
  network: "Couldn't reach the server",
  unauthorized: "The session ended",
  maintenance: "Sync paused for maintenance",
  server: "The server had a problem",
  rejected: "Some changes didn't sync",
  "upgrade-required": "Needed an update to sync",
  "account-changed": "Sync stopped: the account changed",
  failed: "Sync failed",
};

const Title = ({ children }: { children: ReactNode }) => (
  <em className="not-italic text-foreground/80">{children}</em>
);

/**
 * An item without its book: "2 new highlights", "1 changed note",
 * "reading progress". `counted` gives the count alone ("52 books"), and
 * `plain` leaves out "changed", where the row already says it.
 */
function bare(
  item: SyncHistoryItem,
  form: "phrase" | "counted" | "plain" = "phrase",
): string {
  const noun = item.count === 1 ? item.one : item.other;
  const count = item.count.toLocaleString();
  if (item.mass)
    return item.verb === "removed" && form !== "counted"
      ? `${item.one} removed`
      : item.one;
  if (form === "counted" || (form === "plain" && item.verb === "changed"))
    return `${count} ${noun}`;
  if (item.kind === "book") return `${count} ${noun} ${item.verb}`;
  return `${count} ${item.verb === "added" ? "new" : item.verb} ${noun}`;
}

const upperFirst = (words: string) =>
  words.charAt(0).toUpperCase() + words.slice(1);

/** "a, b and c" */
function list(parts: readonly string[]): string {
  return parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * One item with its books: "3 new highlights in _X_", "5 changed notes in
 * 2 books". `capital` starts a line: "Reading progress in _X_".
 */
function ItemPhrase({
  item,
  plain = false,
  capital = false,
}: {
  item: SyncHistoryItem;
  plain?: boolean;
  capital?: boolean;
}) {
  const only = item.containers.length === 1 ? item.containers[0]! : null;
  if (item.kind === "book" && only && item.count === 1)
    return (
      <>
        <Title>{only.label}</Title> {item.verb}
      </>
    );
  const words = bare(item, plain ? "plain" : "phrase");
  const said = capital ? upperFirst(words) : words;
  if (item.kind === "book" || item.containers.length === 0) return <>{said}</>;
  return (
    <>
      {said} in{" "}
      {only ? (
        <Title>{only.label}</Title>
      ) : (
        `${item.containers.length} ${item.containerNoun!.other}`
      )}
    </>
  );
}

/**
 * A group's changes in one line. When they are all in one book, the book
 * is named once: "2 new highlights and 1 new note in _Alice_", or "_Alice_
 * added, with reading progress". Otherwise each item names its own books.
 * `counted` gives counts only, as a restore says them: "52 books", and
 * `capital` starts a line with a capital: "Reading progress in _X_".
 */
export function GroupItems({
  items,
  counted = false,
  capital = true,
}: {
  items: readonly SyncHistoryItem[];
  counted?: boolean;
  capital?: boolean;
}) {
  if (counted)
    return <>{items.map((item) => bare(item, "counted")).join(" · ")}</>;
  const first = items[0]?.containers[0];
  const shared =
    first &&
    items.every(
      (item) =>
        item.containers.length === 1 && item.containers[0]!.id === first.id,
    )
      ? first
      : null;
  if (!shared)
    return (
      <>
        {items.map((item, index) => (
          <Fragment key={`${item.kind}:${item.verb}`}>
            {index > 0 && " · "}
            <ItemPhrase item={item} capital={capital && index === 0} />
          </Fragment>
        ))}
      </>
    );
  const book = items.find((item) => item.kind === "book");
  const rest = list(
    items.filter((item) => item !== book).map((item) => bare(item)),
  );
  if (book)
    return (
      <>
        <Title>{shared.label}</Title> {book.verb}
        {rest && `, with ${rest}`}
      </>
    );
  return (
    <>
      {capital ? upperFirst(rest) : rest} in <Title>{shared.label}</Title>
    </>
  );
}

export function DeviceIcon({ type }: { type: DeviceType | null }) {
  const Icon =
    type === "mobile"
      ? Smartphone
      : type === "tablet"
        ? Tablet
        : type === "desktop"
          ? Monitor
          : MonitorSmartphone;
  return <Icon className="size-[18px]" strokeWidth={1.7} />;
}

interface RowWords {
  icon: ReactNode;
  title: ReactNode;
  when: string;
  detail: ReactNode;
  warn?: boolean;
}

function groupWords(group: SyncHistoryGroup, names: DeviceNamer): RowWords {
  const when = span(group.from, group.to);
  if (group.direction === "received") {
    // A change can reach this device long after it was made: say both.
    const late = group.seenTo - group.to > 60 * 60_000;
    return {
      icon: <DeviceIcon type={names.type(group.deviceId)} />,
      title: `From ${names.name(group.deviceId)}`,
      when,
      detail: (
        <>
          <GroupItems items={group.items} />
          {group.keptLocal > 0 &&
            ` · ${group.keptLocal} kept your newer ${group.keptLocal === 1 ? "edit" : "edits"} here`}
          {late &&
            ` · arrived ${dayLabel(group.seenTo).toLowerCase()} ${time(group.seenTo)}`}
        </>
      ),
    };
  }
  if (group.direction === "sent")
    return {
      icon: <CloudUpload className="size-[18px]" strokeWidth={1.7} />,
      title: "Sent from this device",
      when,
      detail: <GroupItems items={group.items} />,
    };
  if (group.direction === "restored") {
    const devices = group.devices ?? [];
    const from =
      devices.length === 1
        ? names.name(devices[0]!.deviceId)
        : `${devices.length} devices`;
    return {
      icon: <CloudDownload className="size-[18px]" strokeWidth={1.7} />,
      title: "Restored your library",
      when,
      detail: (
        <>
          {group.changes.toLocaleString()}{" "}
          {group.changes === 1 ? "change" : "changes"} from {from} ·{" "}
          <GroupItems items={group.items} counted capital={false} />
        </>
      ),
    };
  }
  const failure = group.failure!;
  return {
    icon:
      failure.kind === "network" ? (
        <CloudOff className="size-[18px]" strokeWidth={1.7} />
      ) : (
        <CircleAlert
          className={cn("size-[18px]", WARN_ICON)}
          strokeWidth={1.8}
        />
      ),
    title: FAILURE_WORDS[failure.kind],
    when,
    detail: (
      <>
        {failure.tries} {failure.tries === 1 ? "try" : "tries"}
        {failure.status !== undefined && ` · HTTP ${failure.status}`}
        {failure.recoveredAt !== undefined &&
          ` · synced again ${time(failure.recoveredAt)}`}
      </>
    ),
  };
}

function rowWords(row: RecentRow, names: DeviceNamer): RowWords {
  if (row.type === "group") return groupWords(row.group, names);
  if (row.type === "waiting")
    return {
      icon: <Clock className="size-[18px]" strokeWidth={1.7} />,
      title: row.gone ? "Sent" : "Waiting on this device",
      when: row.gone
        ? time(row.waiting.since)
        : `since ${time(row.waiting.since)}`,
      detail: <GroupItems items={row.waiting.items} />,
    };
  const { lost } = row;
  const winner = names.name(lost.winner.deviceId);
  return {
    icon: (
      <CircleAlert className={cn("size-[18px]", WARN_ICON)} strokeWidth={1.8} />
    ),
    title: "Lost to a newer edit",
    when: time(lost.at),
    warn: true,
    detail: (
      <>
        <ItemPhrase item={lost.item} plain capital /> ·{" "}
        {lost.winner.deleted
          ? `${winner} removed it at ${time(lost.winner.at)}`
          : `kept ${winner}'s edit from ${time(lost.winner.at)}`}
      </>
    ),
  };
}

function Row({ row, names }: { row: RecentRow; names: DeviceNamer }) {
  const words = rowWords(row, names);
  return (
    <div
      role="listitem"
      className="flex items-center gap-3"
      style={{ height: ROW_HEIGHT }}
      data-history-row={row.id}
      data-history-kind={row.type === "group" ? row.group.direction : row.type}
    >
      <span
        className={cn(
          "grid h-9 w-6 shrink-0 place-items-center text-muted-foreground",
          row.gone && "opacity-50",
        )}
      >
        {words.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
            {words.title}
          </span>
          <span className="shrink-0 font-numeric text-[12px] text-muted-foreground tabular-nums">
            {words.when}
          </span>
        </span>
        <span
          className={cn(
            "line-clamp-2 font-numeric text-[12.5px] text-muted-foreground tabular-nums",
            words.warn && WARN_TEXT,
          )}
        >
          {words.detail}
        </span>
      </span>
    </div>
  );
}

/** The day a row sits under, if its arrangement shows days. */
function dayOf(row: RecentRow, arrange: RecentArrangement): string | null {
  if (arrange === "devices") return null;
  if (row.type === "group") return dayLabel(row.group.to);
  if (row.type === "lost" && arrange === "timeline")
    return dayLabel(row.lost.at);
  return null;
}

/**
 * Recent: what sync did on this device, from its journal. By default lost
 * edits and what still waits come first, then what came from each device
 * and what this device sent, newest first, by day; Design ideas tries the
 * other arrangements. Rows hold their places while the list is open
 * (history-rows.ts). It mounts with the sheet, so each opening arranges
 * the rows again.
 */
export function RecentHistory({
  history,
  names,
  arrange = "sections",
}: {
  history: SyncHistory;
  names: DeviceNamer;
  arrange?: RecentArrangement;
}) {
  const next = recentRows(history, arrange);
  const [held, setHeld] = useState(() => ({ history, rows: next }));
  let rows = held.rows;
  if (held.history !== history) {
    rows = holdRecentRows(held.rows, next);
    setHeld({ history, rows });
  }
  return (
    <section aria-labelledby="recent-history-title" data-sync-history="">
      <h3 id="recent-history-title" className={SECTION_HEADING}>
        Recent
      </h3>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          Nothing has synced on this device in the last 30 days.
        </p>
      ) : (
        <div role="list">
          <AnimatePresence initial={false}>
            {rows.flatMap((row, index) => {
              const day = dayOf(row, arrange);
              const previous =
                index > 0 ? dayOf(rows[index - 1]!, arrange) : null;
              const parts = [];
              if (day && day !== previous)
                parts.push(
                  <Collapse
                    key={`day:${day}`}
                    height={DAY_HEIGHT}
                    className="ba-sheet-heading"
                  >
                    <h4 className="flex h-[26px] items-end pb-0.5 text-[12px] font-medium text-muted-foreground">
                      {day}
                    </h4>
                  </Collapse>,
                );
              parts.push(
                <Collapse
                  key={row.id}
                  height={ROW_HEIGHT}
                  className="ba-sheet-row"
                >
                  <Row row={row} names={names} />
                </Collapse>,
              );
              return parts;
            })}
          </AnimatePresence>
        </div>
      )}
      <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
        Times come from each device's clock and can be a few minutes off.
        Several edits to one item show as one change, and other devices' changes
        show once this device syncs.
      </p>
    </section>
  );
}
