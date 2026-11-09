import { RIBBON_RED } from "@/components/appearance/Paper";
import { DeviceGlyph } from "@/components/DeviceGlyph";
import { SECTION_HEADING } from "@/features/background-activity/ActivitySheet";
import { cn } from "@/lib/utils";
import type { SyncHistory } from "@zsh-eng/local-sync";
import { format, isToday, isYesterday } from "date-fns";
import { ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { bookActivity, lineClauses, type BookActivity } from "./book-activity";
import type { DevicePill, DevicePillNamer } from "./device-pill";

/** Books shown before "Show all activity". */
const FIRST_BOOKS = 6;

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function dayLabel(at: number): string {
  if (isToday(at)) return "Today";
  if (isYesterday(at)) return "Yesterday";
  return format(at, "EEE d MMM");
}

/**
 * Where a change happened, as a small tag beside it: "your Mac". The
 * device you're holding wears Reader's bookmark ribbon: "this iPhone".
 * The tag's words share the line's face and baseline, so the tag is
 * centred on the words around it.
 */
export function DeviceTag({ pill }: { pill: DevicePill }) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-foreground/[0.05] pr-[7px] font-numeric text-[11.5px] whitespace-nowrap",
        pill.here
          ? "pl-[14px] text-foreground"
          : "pl-[5px] text-muted-foreground",
      )}
      data-device-tag={pill.here ? "here" : "other"}
    >
      {pill.here && (
        <span
          aria-hidden="true"
          className="absolute top-0 left-[5px] h-[10px] w-[5px] [clip-path:polygon(0_0,100%_0,100%_100%,50%_72%,0_100%)]"
          style={{ background: RIBBON_RED }}
        />
      )}
      <DeviceGlyph type={pill.type} />
      {/* The one item on the baseline gives the tag its baseline. */}
      <span className="self-baseline leading-[18px]">{pill.words}</span>
    </span>
  );
}

/** In place of a time, for changes still on this device: a dashed ring. */
function Waiting() {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="size-[11px] fill-none stroke-current [stroke-dasharray:2.1_1.5] [stroke-width:1.2]"
      >
        <circle cx="6" cy="6" r="4.6" />
      </svg>
      Waiting
    </span>
  );
}

export interface BookActivityProps {
  history: SyncHistory;
  names: DevicePillNamer;
  /** A book's cover, small. */
  renderCover(bookId: string): ReactNode;
  /** Where a device's place in a book is now, from 0 to 1, if it is known. */
  placeOf(deviceId: string | null, bookId: string): number | undefined;
  offline: boolean;
}

function BookRow({
  book,
  names,
  renderCover,
  placeOf,
  offline,
}: { book: BookActivity } & Omit<BookActivityProps, "history">) {
  return (
    <div
      role="listitem"
      className="flex items-center gap-3.5 py-2"
      data-activity-book={book.bookId}
    >
      <span className="block h-[60px] w-10 shrink-0 overflow-hidden rounded-[2px] bg-secondary shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_1px_2px_rgb(0_0_0/0.12),0_6px_10px_-6px_rgb(0_0_0/0.3)]">
        {renderCover(book.bookId)}
      </span>
      <span className="min-w-0 flex-1 pt-px">
        <span className="flex items-baseline gap-2.5">
          <span className="min-w-0 flex-1 truncate font-serif text-[17.5px] leading-[1.15] text-foreground">
            {book.title}
          </span>
          {book.waiting ? (
            <Waiting />
          ) : (
            <span className="shrink-0 font-numeric text-[11.5px] text-muted-foreground tabular-nums">
              {time(book.at)}
            </span>
          )}
        </span>
        {/* A line for each kind of change, the device's tag after the
            first. The words wrap rather than cut off. */}
        {book.lines.map((line, deviceIndex) => (
          <span
            key={line.deviceId ?? "here"}
            className={cn("block", deviceIndex ? "mt-2" : "mt-[3px]")}
            data-activity-device=""
          >
            {lineClauses(line.changes, placeOf(line.deviceId, book.bookId)).map(
              (clause, index) => (
                <span
                  key={clause}
                  className="block text-[12.5px] leading-[20px] text-muted-foreground"
                  data-activity-line=""
                >
                  <span className="mr-1.5 font-numeric tabular-nums">
                    {clause}
                  </span>
                  {index === 0 && (
                    <DeviceTag pill={names.pill(line.deviceId)} />
                  )}
                </span>
              ),
            )}
          </span>
        ))}
        {book.waiting && offline && (
          <span className="mt-1 block text-[12px] text-muted-foreground/80">
            Saved on {names.pill(null).words}, sent when you’re online
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Account → Activity's history, by book: each book you touched, cover
 * first, with a line for what each device did and a small tag for where.
 * A book touched on two days has a row under each. No device's state
 * shows, only what happened. While the list is open a row keeps its
 * place, and a row new to it joins at the top; the next opening arranges
 * them again.
 */
export function BookActivityList(props: BookActivityProps) {
  const { history } = props;
  const next = useMemo(() => bookActivity(history), [history]);
  const [held, setHeld] = useState(() => ({
    history,
    ids: next.map((book) => book.id),
  }));
  let ids = held.ids;
  if (held.history !== history) {
    const known = new Set(held.ids);
    const current = new Set(next.map((book) => book.id));
    ids = [
      ...next.map((book) => book.id).filter((id) => !known.has(id)),
      ...held.ids.filter((id) => current.has(id)),
    ];
    setHeld({ history, ids });
  }
  const [all, setAll] = useState(false);
  const byId = new Map(next.map((book) => [book.id, book]));
  const books = ids.flatMap((id) => byId.get(id) ?? []);
  const shown = all ? books : books.slice(0, FIRST_BOOKS);
  const dayOf = (book: BookActivity) => dayLabel(book.day);

  if (books.length === 0)
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground">
        Highlights, notes and your place in each book show here.
      </p>
    );
  return (
    <section data-book-activity="">
      <div role="list" aria-label="Activity by book">
        {shown.map((book, index) => {
          const day = dayOf(book);
          const heading = index === 0 || dayOf(shown[index - 1]!) !== day;
          return (
            <Fragment key={book.id}>
              {heading && <h3 className={SECTION_HEADING}>{day}</h3>}
              <BookRow book={book} {...props} />
            </Fragment>
          );
        })}
      </div>
      {!all && books.length > FIRST_BOOKS && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-2 flex h-10 w-full items-center justify-between border-t border-border/70 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show all activity
          <ChevronRight
            className="size-4 text-muted-foreground"
            strokeWidth={1.6}
          />
        </button>
      )}
    </section>
  );
}
