/**
 * Public-domain sample library for the Experiments page.
 *
 * The prototypes must look complete in an empty development database, so this
 * module supplies books, highlights and deterministic reading sessions. Session
 * dates are relative to the current day, which keeps the sample recent.
 */
import type { HighlightColor } from "@/lib/highlight-constants";

export type StudioInk = HighlightColor;

/** Palette slots for typographic covers and spines. All map to theme tokens. */
export type StudioTone =
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "purple"
  | "magenta"
  | "ink";

export type StudioStatus = "reading" | "want-to-read" | "finished" | "dnf";

export interface StudioBook {
  id: string;
  title: string;
  author: string;
  /** Short form for index locators, for example "W" for Walden. */
  siglum: string;
  coverUrl: string | null;
  tone: StudioTone;
  /** "sample" rows fill gaps when the reader's own library is thin. */
  origin: "sample" | "library";
  status: StudioStatus;
  addedAt: number;
  lastReadAt: number | null;
  /** Position in the whole book, from 0 to 1. */
  progress: number;
}

export interface StudioHighlight {
  id: string;
  bookId: string;
  text: string;
  before: string;
  after: string;
  color: StudioInk;
  createdAt: number;
  chapter: string;
  /** Page in the sample library; chapter number for library data. */
  locator: number;
  note: string | null;
}

export interface StudioSession {
  id: string;
  bookId: string;
  startedAt: number;
  activeMs: number;
  /** Position in the whole book, from 0 to 1. */
  startFraction: number;
  endFraction: number;
}

export interface StudioLibrary {
  books: StudioBook[];
  highlights: StudioHighlight[];
  sessions: StudioSession[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

type SampleBookSeed = Pick<StudioBook, "id" | "title" | "author" | "siglum" | "tone" | "status"> & {
  addedDaysAgo: number;
};

const SAMPLE_BOOK_SEEDS: SampleBookSeed[] = [
  { id: "walden", title: "Walden", author: "Henry David Thoreau", siglum: "W", tone: "green", status: "reading", addedDaysAgo: 30 },
  { id: "moby-dick", title: "Moby-Dick", author: "Herman Melville", siglum: "MD", tone: "blue", status: "reading", addedDaysAgo: 64 },
  { id: "middlemarch", title: "Middlemarch", author: "George Eliot", siglum: "Mm", tone: "magenta", status: "reading", addedDaysAgo: 140 },
  { id: "frankenstein", title: "Frankenstein", author: "Mary Shelley", siglum: "F", tone: "ink", status: "finished", addedDaysAgo: 175 },
  { id: "pride", title: "Pride and Prejudice", author: "Jane Austen", siglum: "PP", tone: "yellow", status: "finished", addedDaysAgo: 250 },
  { id: "leaves", title: "Leaves of Grass", author: "Walt Whitman", siglum: "LG", tone: "cyan", status: "finished", addedDaysAgo: 45 },
  { id: "alice", title: "Alice’s Adventures in Wonderland", author: "Lewis Carroll", siglum: "A", tone: "purple", status: "finished", addedDaysAgo: 300 },
  { id: "essays", title: "Essays: First Series", author: "Ralph Waldo Emerson", siglum: "E", tone: "yellow", status: "finished", addedDaysAgo: 20 },
  { id: "meditations", title: "Meditations", author: "Marcus Aurelius", siglum: "M", tone: "ink", status: "finished", addedDaysAgo: 160 },
  // Shelved but not yet started.
  { id: "odyssey", title: "The Odyssey", author: "Homer", siglum: "O", tone: "blue", status: "want-to-read", addedDaysAgo: 2 },
  { id: "jane-eyre", title: "Jane Eyre", author: "Charlotte Brontë", siglum: "JE", tone: "magenta", status: "want-to-read", addedDaysAgo: 6 },
  { id: "bleak-house", title: "Bleak House", author: "Charles Dickens", siglum: "BH", tone: "ink", status: "want-to-read", addedDaysAgo: 11 },
  { id: "dorian-gray", title: "The Picture of Dorian Gray", author: "Oscar Wilde", siglum: "DG", tone: "green", status: "want-to-read", addedDaysAgo: 15 },
  { id: "innocence", title: "The Age of Innocence", author: "Edith Wharton", siglum: "AI", tone: "yellow", status: "want-to-read", addedDaysAgo: 38 },
  { id: "darkness", title: "Heart of Darkness", author: "Joseph Conrad", siglum: "HD", tone: "purple", status: "dnf", addedDaysAgo: 90 },
];

type SampleHighlightSeed = Omit<StudioHighlight, "id" | "createdAt" | "before" | "after" | "note"> & {
  daysAgo: number;
  before?: string;
  after?: string;
  note?: string;
};

const SAMPLE_HIGHLIGHT_SEEDS: SampleHighlightSeed[] = [
  {
    bookId: "walden",
    text: "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.",
    before: "for an hour, at least, some part of us awakes which slumbers all the rest of the day and night. ",
    after: " I did not wish to live what was not life, living is so dear;",
    color: "yellow",
    chapter: "Where I Lived, and What I Lived For",
    locator: 90,
    daysAgo: 3,
    note: "Reread every spring.",
  },
  { bookId: "walden", text: "Simplicity, simplicity, simplicity!", before: "or in extreme cases he may add his ten toes, and lump the rest. ", after: " I say, let your affairs be as two or three, and not a hundred or a thousand;", color: "green", chapter: "Where I Lived, and What I Lived For", locator: 91, daysAgo: 3 },
  { bookId: "walden", text: "Time is but the stream I go a-fishing in.", after: " I drink at it; but while I drink I see the sandy bottom and detect how shallow it is.", color: "blue", chapter: "Where I Lived, and What I Lived For", locator: 98, daysAgo: 4 },
  { bookId: "walden", text: "The mass of men lead lives of quiet desperation.", after: " What is called resignation is confirmed desperation.", color: "magenta", chapter: "Economy", locator: 8, daysAgo: 21 },
  { bookId: "walden", text: "To affect the quality of the day, that is the highest of arts.", before: "but it is far more glorious to carve and paint the very atmosphere and medium through which we look, which morally we can do. ", color: "yellow", chapter: "Where I Lived, and What I Lived For", locator: 90, daysAgo: 4 },
  { bookId: "walden", text: "Our life is frittered away by detail.", before: "it is error upon error, and clout upon clout, and our best virtue has for its occasion a superfluous and evitable wretchedness. ", after: " An honest man has hardly need to count more than his ten fingers,", color: "yellow", chapter: "Where I Lived, and What I Lived For", locator: 91, daysAgo: 5 },
  { bookId: "walden", text: "I had three chairs in my house; one for solitude, two for friendship, three for society.", color: "green", chapter: "Visitors", locator: 140, daysAgo: 9 },
  { bookId: "walden", text: "I love a broad margin to my life.", color: "blue", chapter: "Sounds", locator: 111, daysAgo: 7, note: "The best argument for slow mornings." },
  { bookId: "walden", text: "I never found the companion that was so companionable as solitude.", color: "magenta", chapter: "Solitude", locator: 135, daysAgo: 6 },
  { bookId: "walden", text: "If a man does not keep pace with his companions, perhaps it is because he hears a different drummer.", color: "yellow", chapter: "Conclusion", locator: 326, daysAgo: 1 },
  { bookId: "walden", text: "Rather than love, than money, than fame, give me truth.", color: "green", chapter: "Conclusion", locator: 330, daysAgo: 1 },
  {
    bookId: "moby-dick",
    text: "Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul… then, I account it high time to get to sea as soon as I can.",
    before: "It is a way I have of driving off the spleen and regulating the circulation. ",
    after: " This is my substitute for pistol and ball.",
    color: "blue",
    chapter: "Loomings",
    locator: 1,
    daysAgo: 48,
  },
  { bookId: "moby-dick", text: "meditation and water are wedded for ever.", before: "Yes, as every one knows, ", color: "blue", chapter: "Loomings", locator: 3, daysAgo: 48 },
  { bookId: "moby-dick", text: "It is the image of the ungraspable phantom of life; and this is the key to it all.", before: "But that same image, we ourselves see in all rivers and oceans. ", color: "magenta", chapter: "Loomings", locator: 4, daysAgo: 47, note: "The whole book, in one line." },
  { bookId: "moby-dick", text: "Better sleep with a sober cannibal than a drunken Christian.", color: "yellow", chapter: "The Spouter-Inn", locator: 24, daysAgo: 44 },
  {
    bookId: "middlemarch",
    text: "If we had a keen vision and feeling of all ordinary human life, it would be like hearing the grass grow and the squirrel’s heart beat, and we should die of that roar which lies on the other side of silence.",
    after: " As it is, the quickest of us walk about well wadded with stupidity.",
    color: "magenta",
    chapter: "Chapter XX",
    locator: 194,
    daysAgo: 96,
    note: "The best sentence about attention I know.",
  },
  { bookId: "middlemarch", text: "the growing good of the world is partly dependent on unhistoric acts", before: "for ", color: "green", chapter: "Finale", locator: 838, daysAgo: 81 },
  { bookId: "middlemarch", text: "things are not so ill with you and me as they might have been, is half owing to the number who lived faithfully a hidden life, and rest in unvisited tombs.", before: "and that ", color: "green", chapter: "Finale", locator: 838, daysAgo: 81 },
  { bookId: "middlemarch", text: "What do we live for, if it is not to make life less difficult to each other?", color: "yellow", chapter: "Chapter LXXII", locator: 735, daysAgo: 83 },
  { bookId: "frankenstein", text: "Beware; for I am fearless, and therefore powerful.", color: "magenta", chapter: "Chapter 20", locator: 161, daysAgo: 140 },
  { bookId: "frankenstein", text: "Life, although it may only be an accumulation of anguish, is dear to me, and I will defend it.", color: "blue", chapter: "Chapter 10", locator: 95, daysAgo: 146 },
  { bookId: "frankenstein", text: "I am malicious because I am miserable.", color: "yellow", chapter: "Chapter 17", locator: 140, daysAgo: 143 },
  { bookId: "pride", text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", color: "yellow", chapter: "Chapter 1", locator: 1, daysAgo: 210 },
  { bookId: "pride", text: "I declare after all there is no enjoyment like reading! How much sooner one tires of any thing than of a book!", color: "green", chapter: "Chapter 11", locator: 55, daysAgo: 204, note: "Said entirely insincerely. Still true." },
  { bookId: "pride", text: "I could easily forgive his pride, if he had not mortified mine.", color: "blue", chapter: "Chapter 5", locator: 20, daysAgo: 207 },
  {
    bookId: "leaves",
    text: "Do I contradict myself? Very well then I contradict myself, (I am large, I contain multitudes.)",
    color: "magenta",
    chapter: "Song of Myself, 51",
    locator: 78,
    daysAgo: 30,
    note: "Permission to change your mind.",
  },
  { bookId: "leaves", text: "I celebrate myself, and sing myself,", color: "yellow", chapter: "Song of Myself, 1", locator: 29, daysAgo: 33 },
  { bookId: "leaves", text: "A child said What is the grass? fetching it to me with full hands;", color: "green", chapter: "Song of Myself, 6", locator: 33, daysAgo: 32 },
  { bookId: "alice", text: "Curiouser and curiouser!", before: "“", after: "” cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English);", color: "magenta", chapter: "The Pool of Tears", locator: 13, daysAgo: 260 },
  { bookId: "alice", text: "“Begin at the beginning,” the King said, very gravely, “and go on till you come to the end: then stop.”", color: "blue", chapter: "Alice’s Evidence", locator: 183, daysAgo: 255 },
  { bookId: "alice", text: "Who in the world am I? Ah, that’s the great puzzle!", color: "yellow", chapter: "The Pool of Tears", locator: 17, daysAgo: 259 },
  { bookId: "essays", text: "Trust thyself: every heart vibrates to that iron string.", after: " Accept the place the divine providence has found for you,", color: "yellow", chapter: "Self-Reliance", locator: 47, daysAgo: 12 },
  { bookId: "essays", text: "A foolish consistency is the hobgoblin of little minds,", after: " adored by little statesmen and philosophers and divines.", color: "blue", chapter: "Self-Reliance", locator: 57, daysAgo: 12 },
  { bookId: "essays", text: "To be great is to be misunderstood.", color: "green", chapter: "Self-Reliance", locator: 58, daysAgo: 11 },
  { bookId: "essays", text: "imitation is suicide", before: "that envy is ignorance; that ", after: "; that he must take himself for better, for worse, as his portion;", color: "magenta", chapter: "Self-Reliance", locator: 46, daysAgo: 13 },
  {
    bookId: "meditations",
    text: "Do not act as if thou wert going to live ten thousand years. Death hangs over thee. While thou livest, while it is in thy power, be good.",
    color: "green",
    chapter: "Book IV",
    locator: 39,
    daysAgo: 120,
    note: "Pinned above my desk.",
  },
  { bookId: "meditations", text: "No longer talk at all about the kind of man that a good man ought to be, but be such.", color: "yellow", chapter: "Book X", locator: 120, daysAgo: 118 },
  { bookId: "meditations", text: "The universe is transformation: life is opinion.", color: "blue", chapter: "Book IV", locator: 36, daysAgo: 121 },
];

/** Deterministic PRNG so sample charts keep the same shape on every visit. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface ReadingWindow {
  bookId: string;
  /** Days before today, inclusive. */
  fromDaysAgo: number;
  toDaysAgo: number;
}

// Overlapping windows give realistic "two books at once" periods.
const SAMPLE_READING_WINDOWS: ReadingWindow[] = [
  { bookId: "alice", fromDaysAgo: 290, toDaysAgo: 250 },
  { bookId: "pride", fromDaysAgo: 245, toDaysAgo: 196 },
  { bookId: "frankenstein", fromDaysAgo: 170, toDaysAgo: 136 },
  { bookId: "meditations", fromDaysAgo: 150, toDaysAgo: 100 },
  { bookId: "middlemarch", fromDaysAgo: 128, toDaysAgo: 62 },
  { bookId: "moby-dick", fromDaysAgo: 58, toDaysAgo: 20 },
  { bookId: "leaves", fromDaysAgo: 40, toDaysAgo: 26 },
  { bookId: "essays", fromDaysAgo: 18, toDaysAgo: 9 },
  { bookId: "walden", fromDaysAgo: 24, toDaysAgo: 0 },
];

function pickStartMinute(random: () => number): number {
  const slot = random();
  // Mostly evenings, with a habit of early mornings and the odd lunch break.
  if (slot < 0.62) return 20 * 60 + 30 + Math.floor(random() * 195);
  if (slot < 0.88) return 6 * 60 + 10 + Math.floor(random() * 110);
  return 12 * 60 + 15 + Math.floor(random() * 70);
}

function buildSampleSessions(now: Date): StudioSession[] {
  const random = mulberry32(1854);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const progress = new Map<string, number>();
  const sessions: StudioSession[] = [];

  for (let daysAgo = 300; daysAgo >= 0; daysAgo -= 1) {
    const active = SAMPLE_READING_WINDOWS.filter(
      (window) => daysAgo <= window.fromDaysAgo && daysAgo >= window.toDaysAgo,
    );
    // Quiet weeks happen; they make streaks and gaps visible.
    const quietWeek = Math.floor(daysAgo / 7) % 9 === 4;
    if (active.length === 0 || random() < (quietWeek ? 0.82 : 0.24)) continue;

    const dayStart = today.getTime() - daysAgo * DAY_MS;
    const sessionCount = random() < 0.7 ? 1 : random() < 0.8 ? 2 : 3;
    let previousEndMinute = 0;

    for (let index = 0; index < sessionCount; index += 1) {
      const window = active[Math.floor(random() * active.length)];
      const span = window.fromDaysAgo - window.toDaysAgo + 1;
      const startMinute = Math.max(pickStartMinute(random), previousEndMinute + 30);
      if (startMinute > 23 * 60 + 40) break;
      const minutes = Math.round(6 + Math.pow(random(), 1.6) * 74);
      const activeMs = minutes * 60 * 1000;
      const startedAt = dayStart + startMinute * 60 * 1000;
      if (startedAt > now.getTime()) break;
      previousEndMinute = startMinute + minutes;

      const startFraction = progress.get(window.bookId) ?? 0;
      const endFraction = Math.min(
        1,
        startFraction + (minutes / 60) * (1.3 / Math.max(span, 8)) * (0.6 + random()),
      );
      progress.set(window.bookId, endFraction);

      sessions.push({
        id: `sample-session-${daysAgo}-${index}`,
        bookId: window.bookId,
        startedAt,
        activeMs,
        startFraction,
        endFraction,
      });
    }
  }

  return sessions;
}

export function createSampleLibrary(now: Date = new Date()): StudioLibrary {
  const highlights = SAMPLE_HIGHLIGHT_SEEDS.map((seed, index) => {
    const { daysAgo, before, after, note, ...rest } = seed;
    return {
      ...rest,
      id: `sample-highlight-${index}`,
      before: before ?? "",
      after: after ?? "",
      note: note ?? null,
      createdAt: now.getTime() - daysAgo * DAY_MS - ((index * 7919) % 600) * 60 * 1000,
    } satisfies StudioHighlight;
  });

  const sessions = buildSampleSessions(now);
  return {
    books: SAMPLE_BOOK_SEEDS.map(({ addedDaysAgo, ...seed }) => {
      const own = sessions.filter((session) => session.bookId === seed.id);
      const latest = own.reduce<StudioSession | null>(
        (best, session) => (!best || session.startedAt > best.startedAt ? session : best),
        null,
      );
      return {
        ...seed,
        coverUrl: null,
        origin: "sample",
        addedAt: now.getTime() - addedDaysAgo * DAY_MS,
        lastReadAt: latest?.startedAt ?? null,
        progress: seed.status === "finished" ? 1 : (latest?.endFraction ?? 0),
      } satisfies StudioBook;
    }),
    highlights,
    sessions,
  };
}
