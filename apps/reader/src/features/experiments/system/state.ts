/**
 * Data for the System prototype: shelf books, the books that can be opened,
 * and one list of annotations where highlights and notes live together.
 */
import type { StudioBook, StudioInk, StudioLibrary } from "../data/sample-library";
import {
  BOOK_MODELS,
  chapterOfPage,
  pageOfHighlight,
  type BookLayout,
  type BookModel,
  type EdgeHighlight,
} from "../data/walden-book";

export interface Entry {
  id: string;
  bookId: string;
  kind: "highlight" | "note";
  chapter: number;
  color: StudioInk | null;
  /** The quoted passage, for highlights. */
  text: string | null;
  note: string | null;
  /** Fixed page. Highlights in the sample chapter take theirs from pagination. */
  page: number | null;
  daysAgo: number;
}

export interface ShelfBook extends StudioBook {
  model: BookModel | null;
}

const MODELS = new Map(BOOK_MODELS.map((model) => [model.id, model]));

export function modelFor(bookId: string): BookModel | null {
  return MODELS.get(bookId) ?? null;
}

export function shelfFromLibrary(library: StudioLibrary): ShelfBook[] {
  const own = library.books.filter((book) => book.origin === "library");
  const books = own.length >= 3 ? own : library.books.filter((book) => book.origin === "sample");
  return books.map((book) => {
    const model = modelFor(book.id);
    // A book that can be opened reports progress from its own page.
    if (!model) return { ...book, model: null };
    return { ...book, model, progress: book.status === "finished" ? 1 : model.readingPage / model.pages };
  });
}

const STANDALONE_NOTES: Omit<Entry, "id" | "kind" | "color" | "text">[] = [
  { bookId: "walden", chapter: 1, page: 82, note: "Reading this at six in the morning, on purpose. It works.", daysAgo: 1 },
  { bookId: "walden", chapter: 0, page: 30, note: "His house cost $28.12½. Compare with a month’s rent now.", daysAgo: 401 },
  { bookId: "moby-dick", chapter: 0, page: 2, note: "Ishmael goes to sea the way other people go for a walk.", daysAgo: 49 },
  { bookId: "essays", chapter: 1, page: 40, note: "Read alongside Walden: both are about trusting your own attention.", daysAgo: 12 },
];

export function initialEntries(): Entry[] {
  const highlights = BOOK_MODELS.flatMap((model) =>
    model.highlights.map(
      (highlight): Entry => ({
        id: highlight.id,
        bookId: model.id,
        kind: "highlight",
        chapter: highlight.chapter,
        color: highlight.color,
        text: highlight.text,
        note: highlight.note,
        page: highlight.page,
        daysAgo: highlight.daysAgo,
      }),
    ),
  );
  const notes = STANDALONE_NOTES.map(
    (note, index): Entry => ({ ...note, id: `n${index + 1}`, kind: "note", color: null, text: null }),
  );
  return [...highlights, ...notes];
}

export function highlightsFor(entries: Entry[], bookId: string): EdgeHighlight[] {
  return entries.flatMap((entry) =>
    entry.bookId === bookId && entry.kind === "highlight" && entry.text && entry.color
      ? [
          {
            id: entry.id,
            chapter: entry.chapter,
            text: entry.text,
            color: entry.color,
            note: entry.note,
            page: entry.page,
            daysAgo: entry.daysAgo,
          },
        ]
      : [],
  );
}

export function entryPage(entry: Entry, layout: BookLayout, model: BookModel): number {
  if (entry.kind === "note") return entry.page ?? model.textStart;
  return pageOfHighlight(
    { id: entry.id, chapter: entry.chapter, text: entry.text ?? "", color: entry.color ?? "yellow", note: entry.note, page: entry.page, daysAgo: entry.daysAgo },
    layout,
    model,
  );
}

export function chapterTitle(model: BookModel, page: number): string {
  return model.chapters[chapterOfPage(page, model)].title;
}

/** About a minute and a half a page at a steady pace. */
export function minutesForPages(pages: number): number {
  return Math.max(0, pages) * 1.6;
}
