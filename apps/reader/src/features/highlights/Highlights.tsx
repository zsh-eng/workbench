import {
  APP_HEADER_BUTTON,
  APP_PAGE_FRAME,
} from "@/components/app-header-styles";
import { PlaceHeader, usePlaceSearch } from "@/components/PlaceHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HighlightSections } from "@/features/highlights/HighlightSections";
import { BookCover, useCoverRequest } from "@/features/library/LibraryBooks";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { useReadingSessionsQuery } from "@/hooks/use-reading-sessions-query";
import { getAllHighlights, getAllNotes, type Book } from "@/lib/db";
import {
  HIGHLIGHT_COLORS,
  type AnnotationColor,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { MOTION } from "@/lib/motion";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import { formatReadingDuration } from "@/lib/reading-session-stats";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { cn } from "@/lib/utils";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronRight, Copy, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Highlights: everything you kept, in the Library's frame and type. Notes and
 * highlights live together as in the Reader's Notebook: a note shows its
 * passage, and a highlight with a note shows once. By book, each book's
 * passages are in reading order beside the book; Recent lists them by date
 * across books. Search narrows the page in place.
 */

type Kind = "all" | "highlights" | "notes";
type Order = "book" | "recent";

interface Entry {
  id: string;
  book: Book;
  kind: "highlight" | "note";
  passage: string | null;
  color: AnnotationColor | null;
  note: string | null;
  chapter: string;
  spineIndex: number;
  offset: number;
  createdAt: number;
  /** The highlight the Reader opens at, when there is one. */
  target: { spineItemId: string; highlightId: string } | null;
}

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "highlights", label: "Highlights" },
  { value: "notes", label: "Notes" },
];

const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: MOTION.enter },
  exit: { opacity: 0, transition: MOTION.exit },
};

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

type Annotations = {
  highlights: Awaited<ReturnType<typeof getAllHighlights>>;
  notes: Awaited<ReturnType<typeof getAllNotes>>;
};

/** The last annotations read. The page comes back from a book with them at
 * once, so that the window can return to its place. */
let lastAnnotations: Annotations | undefined;

function useEntries(books: Book[] | undefined): Entry[] | undefined {
  const annotations = useLiveQuery(
    async () => {
      const [highlights, notes] = await Promise.all([
        getAllHighlights(),
        getAllNotes(),
      ]);
      return (lastAnnotations = { highlights, notes });
    },
    [],
    lastAnnotations,
  );
  return useMemo(() => {
    if (!annotations || !books) return undefined;
    const booksById = new Map(books.map((book) => [book.id, book]));
    const highlightsById = new Map(
      annotations.highlights.map((highlight) => [highlight.id, highlight]),
    );
    const place = (book: Book, spineItemId: string) => {
      const spineIndex = book.spine.findIndex(
        ({ idref }) => idref === spineItemId,
      );
      return {
        spineIndex,
        chapter:
          spineIndex >= 0
            ? getChapterTitleFromSpine(book, spineIndex)
            : "Unknown chapter",
      };
    };
    const linked = new Set<string>();
    const entries: Entry[] = [];
    for (const note of annotations.notes) {
      if (note.kind !== "note") continue;
      const book = booksById.get(note.bookId);
      if (!book) continue;
      const highlight = note.highlightId
        ? highlightsById.get(note.highlightId)
        : undefined;
      if (note.highlightId) linked.add(note.highlightId);
      entries.push({
        id: note.id,
        book,
        kind: "note",
        passage: note.quote?.text ?? highlight?.selectedText ?? null,
        color: note.quote?.color ?? highlight?.color ?? null,
        note: note.content,
        ...place(book, note.anchor.spineItemId),
        offset: note.anchor.startOffset,
        createdAt: note.createdAt,
        target: highlight
          ? { spineItemId: highlight.spineItemId, highlightId: highlight.id }
          : null,
      });
    }
    for (const highlight of annotations.highlights) {
      if (linked.has(highlight.id)) continue;
      const book = booksById.get(highlight.bookId);
      if (!book) continue;
      entries.push({
        id: highlight.id,
        book,
        kind: "highlight",
        passage: highlight.selectedText,
        color: highlight.color,
        note: null,
        ...place(book, highlight.spineItemId),
        offset: highlight.startOffset,
        createdAt: highlight.createdAt,
        target: {
          spineItemId: highlight.spineItemId,
          highlightId: highlight.id,
        },
      });
    }
    return entries;
  }, [annotations, books]);
}

interface BookGroup {
  key: string;
  book: Book;
  entries: Entry[];
}

interface DayGroup {
  key: string;
  label: string;
  entries: Entry[];
}

function countKinds(entries: Entry[]): Record<Kind, number> {
  const notes = entries.filter((entry) => entry.kind === "note").length;
  return { all: entries.length, highlights: entries.length - notes, notes };
}

const dayId = (key: string) =>
  key.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();

/** An entry the list measures for its estimates: one line of each text. */
const PROBE = (
  <EntryRow
    passage="Probe"
    note="Probe"
    color={null}
    meta="Probe"
    terms=""
    copyText=""
    onOpen={() => undefined}
  />
);

/** Text that keeps the width of its widest form, so what follows stays put. */
function Steady({
  widest,
  className,
  children,
}: {
  widest: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-grid", className)}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {widest}
      </span>
      <span className="col-start-1 row-start-1">{children}</span>
    </span>
  );
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function shortDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function Highlights() {
  const navigate = useNavigate();
  const { data } = useBooksWithStatuses();
  const entries = useEntries(data?.books);
  const { data: sessions } = useReadingSessionsQuery();
  const placeSearch = usePlaceSearch();
  const { terms } = placeSearch;
  const [kind, setKind] = useState<Kind>("all");
  const [colors, setColors] = useState<HighlightColor[]>([]);
  const [order, setOrder] = useState<Order>("book");

  const readingTime = useMemo(() => {
    const totals = new Map<string, number>();
    for (const session of sessions?.sessions ?? [])
      if (session.activeMs > 0)
        totals.set(
          session.bookId,
          (totals.get(session.bookId) ?? 0) + session.activeMs,
        );
    return totals;
  }, [sessions]);

  // Search and colour narrow every kind, so each kind can show its count.
  const narrowed = useMemo(() => {
    const words = fold(terms).split(/\s+/).filter(Boolean);
    return (entries ?? []).filter((entry) => {
      if (colors.length && !colors.includes(entry.color as HighlightColor))
        return false;
      if (!words.length) return true;
      const haystack = fold(
        `${entry.passage ?? ""} ${entry.note ?? ""} ${entry.book.title} ${entry.book.author}`,
      );
      return words.every((word) => haystack.includes(word));
    });
  }, [entries, colors, terms]);
  const counts = useMemo(() => countKinds(narrowed), [narrowed]);
  // Counts keep the width of the totals, so the filters do not move.
  const totals = useMemo(() => countKinds(entries ?? []), [entries]);
  const shown = useMemo(
    () =>
      narrowed.filter(
        (entry) =>
          kind === "all" ||
          (kind === "highlights") === (entry.kind === "highlight"),
      ),
    [narrowed, kind],
  );

  const byBook = useMemo(() => {
    const groups = new Map<string, BookGroup>();
    for (const entry of shown) {
      const group = groups.get(entry.book.id);
      if (group) group.entries.push(entry);
      else
        groups.set(entry.book.id, {
          key: `book:${entry.book.id}`,
          book: entry.book,
          entries: [entry],
        });
    }
    const latest = (group: { entries: Entry[] }) =>
      Math.max(...group.entries.map((entry) => entry.createdAt));
    return [...groups.values()]
      .map((group) => ({
        ...group,
        entries: group.entries.sort(
          (a, b) => a.spineIndex - b.spineIndex || a.offset - b.offset,
        ),
      }))
      .sort((a, b) => latest(b) - latest(a));
  }, [shown]);
  const byDay = useMemo(() => {
    const days: DayGroup[] = [];
    for (const entry of [...shown].sort((a, b) => b.createdAt - a.createdAt)) {
      const label = dayLabel(entry.createdAt);
      const day = days.at(-1);
      if (day?.label === label) day.entries.push(entry);
      else days.push({ key: `day:${label}`, label, entries: [entry] });
    }
    return days;
  }, [shown]);

  const groupBooks = useMemo(() => byBook.map(({ book }) => book), [byBook]);
  const { coverUrls, requestCover } = useLibraryCoverUrls(groupBooks, {
    loadRemainingInBackground: true,
  });

  const open = (entry: Entry) => {
    beginReaderTrace({
      bookId: entry.book.id,
      bookTitle: entry.book.title,
      source: "highlight",
    });
    navigate(
      `/reader/${entry.book.id}`,
      entry.target ? { state: { scrollToHighlight: entry.target } } : undefined,
    );
  };
  const openBook = (book: Book) => {
    beginReaderTrace({
      bookId: book.id,
      bookTitle: book.title,
      source: "highlight",
    });
    navigate(`/reader/${book.id}`);
  };
  const first = order === "book" ? byBook[0]?.entries[0] : byDay[0]?.entries[0];
  const row = (entry: Entry, meta: string) => (
    <EntryRow
      passage={entry.passage}
      note={entry.note}
      color={entry.color}
      meta={meta}
      terms={terms}
      copyText={[
        entry.passage && `“${entry.passage}”`,
        entry.note,
        `${entry.book.title}, ${entry.book.author}`,
      ]
        .filter(Boolean)
        .join("\n\n")}
      onOpen={() => open(entry)}
    />
  );

  const orderMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Order"
        title="Order"
        className={APP_HEADER_BUTTON}
      >
        <SlidersHorizontal className="size-4" strokeWidth={1.6} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="pt-2 pb-1 text-xs font-normal text-muted-foreground">
            Order
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={order}
            onValueChange={(value) => setOrder(value as Order)}
          >
            <DropdownMenuRadioItem value="book">By book</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="recent">Recent</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const nothingYet = entries !== undefined && entries.length === 0;
  const nothingFound =
    !nothingYet && entries !== undefined && shown.length === 0;

  return (
    <div className="min-h-full bg-background">
      <h1 className="sr-only">Highlights</h1>
      <PlaceHeader
        current="highlights"
        search={placeSearch}
        label="Search highlights"
        placeholder="Words, notes, or a book"
        count={`${shown.length} of ${entries?.length ?? 0}`}
        onSubmit={() => first && open(first)}
        actions={<div className="max-md:hidden">{orderMenu}</div>}
      />

      <div className={cn(APP_PAGE_FRAME, "pb-24")}>
        {nothingYet && (
          <div className="py-24 text-center md:py-32">
            <p className="font-serif text-[26px] leading-tight md:text-[34px]">
              Nothing kept yet
            </p>
            <p className="mx-auto mt-3 max-w-sm text-[14px] text-muted-foreground">
              Select text in a book to highlight it or add a note. Everything
              you keep gathers here.
            </p>
          </div>
        )}

        {entries !== undefined && !nothingYet && (
          <div className="mt-5 flex items-center justify-between gap-3 md:mt-8">
            {/* A phone scrolls the filters sideways; the padding keeps their
                rings and focus outlines inside the scrolling box. */}
            <div className="flex min-w-0 items-center gap-5 max-md:-ml-1 max-md:overflow-x-auto max-md:pl-1 max-md:[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] max-md:[scrollbar-width:none]">
              <div
                role="group"
                aria-label="Show"
                className="flex items-center gap-3 md:gap-4"
              >
                {KINDS.map((option) => {
                  const active = option.value === kind;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setKind(option.value)}
                      className={cn(
                        "shrink-0 rounded-sm py-2 text-[13px] whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Steady
                        widest={
                          <span className="font-medium">{option.label}</span>
                        }
                      >
                        {option.label}
                      </Steady>
                      <Steady
                        widest={"0".repeat(String(totals[option.value]).length)}
                        className="ml-1.5 font-numeric text-[12px] font-normal text-muted-foreground/60 tabular-nums max-md:hidden"
                      >
                        {counts[option.value]}
                      </Steady>
                    </button>
                  );
                })}
              </div>
              <span
                aria-hidden="true"
                className="h-4 w-px shrink-0 bg-border"
              />
              <div
                role="group"
                aria-label="Filter by colour"
                className="flex shrink-0 items-center gap-3.5 max-md:pr-5"
              >
                {HIGHLIGHT_COLORS.map(({ name }) => {
                  const selected = colors.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-label={`${name[0].toUpperCase()}${name.slice(1)} highlights`}
                      aria-pressed={selected}
                      onClick={() =>
                        setColors(
                          selected
                            ? colors.filter((color) => color !== name)
                            : [...colors, name],
                        )
                      }
                      className={cn(
                        "relative size-3.5 shrink-0 rounded-full before:absolute before:-inset-x-2 before:-inset-y-[11px] before:content-[''] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-full after:border-[1.5px] after:border-foreground/70 after:opacity-0 after:transition-opacity after:duration-150",
                        selected && "after:opacity-100",
                        colors.length > 0 && !selected && "opacity-40",
                      )}
                      style={{ backgroundColor: `var(--${name}-secondary)` }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="shrink-0 md:hidden">{orderMenu}</div>
          </div>
        )}

        {nothingFound && (
          <div className="py-20 text-center">
            <p className="text-[14px] text-muted-foreground">
              {terms
                ? `Nothing matches “${terms}”.`
                : "Nothing matches these filters."}
            </p>
            <Button
              variant="ghost"
              className="mt-3"
              onClick={() => {
                setKind("all");
                setColors([]);
                if (terms) {
                  placeSearch.setSearch("");
                  placeSearch.openSearch();
                }
              }}
            >
              Show everything
            </Button>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={order} {...FADE}>
            {order === "book" ? (
              <HighlightSections
                kind="book"
                sections={byBook}
                divided
                heading={({ book }) => `book-${book.id}`}
                aside={({ book, entries: bookEntries }) => (
                  <BookAside
                    book={book}
                    entries={bookEntries}
                    readingMs={readingTime.get(book.id) ?? 0}
                    coverUrl={coverUrls.get(book.id)}
                    onCoverRequest={requestCover}
                    onOpenBook={() => openBook(book)}
                  />
                )}
                entry={(entry) =>
                  row(entry, `${entry.chapter} · ${shortDate(entry.createdAt)}`)
                }
                probe={PROBE}
              />
            ) : (
              <HighlightSections
                kind="recent"
                sections={byDay}
                heading={({ key }) => dayId(key)}
                aside={({ key, label }) => (
                  <h2
                    id={dayId(key)}
                    className="mb-1 text-[12px] text-muted-foreground md:mb-0 md:pt-3.5 md:font-serif md:text-[19px] md:leading-tight md:text-foreground"
                  >
                    {label}
                  </h2>
                )}
                entry={(entry) =>
                  row(entry, `${entry.book.title} · ${entry.chapter}`)
                }
                probe={PROBE}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** The book beside its passages. On a phone, it sits above them. */
function BookAside({
  book,
  entries,
  readingMs,
  coverUrl,
  onCoverRequest,
  onOpenBook,
}: {
  book: Book;
  entries: Entry[];
  readingMs: number;
  coverUrl: string | undefined;
  onCoverRequest: (book: Book) => void;
  onOpenBook: () => void;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useCoverRequest(element, book, coverUrl, onCoverRequest);
  const notes = entries.filter((entry) => entry.kind === "note").length;
  const highlights = entries.length - notes;
  const counts = [
    highlights &&
      `${highlights} ${highlights === 1 ? "highlight" : "highlights"}`,
    notes && `${notes} ${notes === 1 ? "note" : "notes"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <aside ref={setElement} className="mb-3 flex gap-3.5 md:mb-0 md:block">
      <button
        type="button"
        onClick={onOpenBook}
        aria-label={`Open ${book.title}`}
        className="block w-11 shrink-0 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 md:w-[72px]"
      >
        <BookCover
          book={book}
          coverUrl={coverUrl}
          compact
          className="aspect-[2/3] w-full rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.1),0_10px_22px_-14px_rgb(0_0_0/0.4)]"
        />
      </button>
      <div className="min-w-0 md:mt-4">
        <h2
          id={`book-${book.id}`}
          className="font-serif text-[17px] leading-tight text-balance md:text-[19px]"
        >
          {book.title}
        </h2>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
          {book.author}
        </p>
        <p className="mt-2 font-numeric text-[12px] text-muted-foreground/80 tabular-nums">
          {counts}
          {readingMs > 0 && (
            <span className="max-md:hidden">
              <br />
              {formatReadingDuration(readingMs)} read
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={onOpenBook}
          className="mt-3 hidden items-center gap-0.5 rounded-sm text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
        >
          Open book
          <ChevronRight className="size-3.5" strokeWidth={1.8} />
        </button>
      </div>
    </aside>
  );
}

/**
 * One thing you kept. The passage is in the book's serif and your note in
 * the app's sans, with the highlight's colour as a rule beside them.
 */
function EntryRow({
  passage,
  note,
  color,
  meta,
  terms,
  copyText,
  onOpen,
}: {
  passage: string | null;
  note: string | null;
  color: AnnotationColor | null;
  meta: string;
  terms: string;
  copyText: string;
  onOpen: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard?.writeText(copyText).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  const rule =
    color && color !== "invisible"
      ? `var(--${color}-secondary)`
      : "color-mix(in oklab, var(--foreground) 18%, transparent)";
  const summary = passage ?? note ?? "";
  return (
    <article className="group relative -mx-3 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-foreground/[0.025]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open at: ${summary.slice(0, 80)}`}
        className="absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="pointer-events-none relative flex gap-3.5">
        <span
          aria-hidden="true"
          className="mt-1 mb-6 w-[3px] shrink-0 self-stretch rounded-full"
          style={{ background: rule }}
        />
        <div className="min-w-0 flex-1 md:pr-8">
          {passage && (
            <p
              data-passage=""
              className="font-serif text-[17px] leading-[1.5] break-words whitespace-pre-wrap text-foreground/90"
            >
              <Marked text={passage} terms={terms} />
            </p>
          )}
          {note && (
            <p
              data-note=""
              className={cn(
                "text-[14px] leading-relaxed break-words whitespace-pre-wrap",
                passage ? "mt-2 text-foreground/70" : "text-foreground/85",
              )}
            >
              <Marked text={note} terms={terms} />
            </p>
          )}
          <p className="mt-1.5 truncate text-[12px] text-muted-foreground">
            {meta}
          </p>
        </div>
      </div>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy"}
        title={copied ? "Copied" : "Copy"}
        onClick={copy}
        className="absolute top-2.5 right-2 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity duration-150 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:hidden"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </article>
  );
}

/** The words of a search, marked where they appear in the text. */
function Marked({ text, terms }: { text: string; terms: string }) {
  const words = terms.split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const pattern = new RegExp(
    `(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "giu",
  );
  return text.split(pattern).map((part, index) =>
    index % 2 ? (
      <mark
        key={index}
        className="rounded-[2px] bg-foreground/[0.09] text-inherit"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
