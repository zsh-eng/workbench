import { MobileBackToLibrary } from "@/components/ui/mobile-back-to-library";
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useInView,
  useReducedMotion,
} from "motion/react";
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { StudioLibrary } from "./data/sample-library";
import { useStudioLibrary, type StudioSource } from "./data/use-studio-library";
import { Commonplace } from "./highlights/Commonplace";
import { Concordance } from "./highlights/Concordance";
import { HighlightDeck } from "./highlights/HighlightDeck";
import { EASE_OUT, Kbd, SOFT_SPRING } from "./primitives";
import { FolioReader } from "./reader/FolioReader";
import { InkReader } from "./reader/InkReader";
import { LumenReader } from "./reader/LumenReader";
import { Almanac } from "./sessions/Almanac";
import { ReadingClock } from "./sessions/ReadingClock";
import { Shelf } from "./sessions/Shelf";
import { Atrium } from "./library/Atrium";
import { Ledger } from "./library/Ledger";
import { Unfold } from "./library/Unfold";
import { Companion } from "./margin/Companion";
import { Inspector } from "./margin/Inspector";
import { OutlineRail } from "./margin/OutlineRail";
import "./studio.css";

type ChapterId = "page" | "commonplace" | "habit" | "library" | "margin";

interface ChapterDefinition {
  id: ChapterId;
  numeral: string;
  title: string;
  line: string;
}

interface PlateDefinition {
  id: string;
  chapter: ChapterId;
  name: string;
  subtitle: string;
  thesis: string;
  tries: ReactNode[];
  stageClassName: string;
  render: (library: StudioLibrary) => ReactNode;
}

const CHAPTERS: ChapterDefinition[] = [
  {
    id: "page",
    numeral: "I",
    title: "The Page",
    line: "Three ways to hold a text: as an object, as a lamp, and as a surface you can write on.",
  },
  {
    id: "commonplace",
    numeral: "II",
    title: "The Commonplace",
    line: "What you keep should be read again. Three forms for returning to passages: anthology, deck and concordance.",
  },
  {
    id: "habit",
    numeral: "III",
    title: "The Habit",
    line: "Reading time shown as a printed almanac, a twenty-four-hour clock and a shelf of books.",
  },
  {
    id: "library",
    numeral: "IV",
    title: "The Library",
    line: "Quieter studies from here on. One book in front, the whole collection as a list, and details that open in place.",
  },
  {
    id: "margin",
    numeral: "V",
    title: "The Margin",
    line: "Sidebars for the reading view that stay out of the way until you need them: a minimap outline, a calm inspector, and a margin that follows your page.",
  },
];

const PLATES: PlateDefinition[] = [
  {
    id: "folio",
    chapter: "page",
    name: "Folio",
    subtitle: "The book as an object",
    thesis:
      "A two-page spread with running heads, a drop cap and old-style figures. The page bends as you drag it. The fore-edges get thicker or thinner, so you see your place without a progress bar.",
    tries: [
      <>Drag a page from its edge, or tap a side</>,
      <>
        <Kbd>←</Kbd> <Kbd>→</Kbd> to turn
      </>,
      <>Tap the folio dots to riffle several pages</>,
    ],
    stageClassName: "h-[min(84svh,780px)] min-h-[580px]",
    render: () => <FolioReader />,
  },
  {
    id: "lumen",
    chapter: "page",
    name: "Lumen",
    subtitle: "A reading lamp for long scroll",
    thesis:
      "Light follows the line you are reading. Paragraphs you have read get dim, and paragraphs ahead wait in half-light. Turn on the pacer to scroll at your reading speed while you hold still.",
    tries: [
      <>Scroll, or press <Kbd>Space</Kbd> to advance a line</>,
      <>Switch between paragraph and line focus</>,
      <>Start the pacer and adjust the speed</>,
    ],
    stageClassName: "h-[min(84svh,760px)] min-h-[580px]",
    render: () => <LumenReader />,
  },
  {
    id: "ink",
    chapter: "page",
    name: "Ink",
    subtitle: "Highlighting as direct manipulation",
    thesis:
      "Choose a pen and drag across the text. No selection handles, no toolbar step. The ink snaps to whole words, a double-click marks a sentence, and each mark makes a note in the margin beside its line.",
    tries: [
      <>Pick an ink, then drag across words</>,
      <>Double-click to mark a sentence</>,
      <>Use the eraser, or tap a mark to recolour it</>,
    ],
    stageClassName: "h-[min(86svh,800px)] min-h-[600px]",
    render: () => <InkReader />,
  },
  {
    id: "commonplace",
    chapter: "commonplace",
    name: "Commonplace",
    subtitle: "Highlights typeset as an anthology",
    thesis:
      "Each book becomes a chapter and each highlight a pull quote, with its ink in the hanging quotation mark. Passages are revealed as you scroll. Open one to read it alone as a broadside.",
    tries: [
      <>Scroll the anthology; the contents follow you</>,
      <>Open a passage as a broadside</>,
      <>Open to a random page</>,
    ],
    stageClassName: "h-[min(86svh,820px)] min-h-[600px]",
    render: (library) => <Commonplace library={library} />,
  },
  {
    id: "deck",
    chapter: "commonplace",
    name: "Deck",
    subtitle: "Resurfacing, by hand",
    thesis:
      "A daily stack of index cards, each held by a strip of tape in its highlight ink. Throw a card right to keep it, or left to let it go. Flick it up to put it back under the pile. Flip a card to read the passage around it.",
    tries: [
      <>Drag a card; release with intent</>,
      <>
        <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> to sort, <Kbd>Space</Kbd> to flip
      </>,
    ],
    stageClassName: "h-[min(80svh,720px)] min-h-[580px]",
    render: (library) => <HighlightDeck library={library} />,
  },
  {
    id: "concordance",
    chapter: "commonplace",
    name: "Concordance",
    subtitle: "An index for everything you kept",
    thesis:
      "A back-of-book index made from your highlights, with a book abbreviation and a page for each entry. Choose a word to see every use of it, aligned on the word in a key-word-in-context view.",
    tries: [
      <>Type a word, or choose one from the index</>,
      <>Jump with the A–Z rail</>,
      <>Open a line to read the whole passage</>,
    ],
    stageClassName: "h-[min(86svh,800px)] min-h-[600px]",
    render: (library) => <Concordance library={library} />,
  },
  {
    id: "almanac",
    chapter: "habit",
    name: "Almanac",
    subtitle: "A year of reading, printed",
    thesis:
      "A broadsheet of your reading year: a large figure that rolls like an odometer, a calendar of ink dots and a box score of records with dotted leaders. Point at a day to see it in the masthead.",
    tries: [
      <>Point at any day in the calendar</>,
      <>Read the records column like a box score</>,
    ],
    stageClassName: "h-auto min-h-[640px]",
    render: (library) => <Almanac library={library} />,
  },
  {
    id: "clock",
    chapter: "habit",
    name: "Rhythm",
    subtitle: "When you read, on a twenty-four-hour dial",
    thesis:
      "Each ring is a day and each arc is a session, set at the time it happened. The outer petals add up every hour you have read. It shows if you read late at night or early in the morning.",
    tries: [
      <>Point at an arc to read the session</>,
      <>Point at a book to isolate it</>,
    ],
    stageClassName: "h-[min(86svh,800px)] min-h-[640px]",
    render: (library) => <ReadingClock library={library} />,
  },
  {
    id: "shelf",
    chapter: "habit",
    name: "Shelf",
    subtitle: "Time, measured in spine widths",
    thesis:
      "Every book you read stands on a shelf in the order you started it. The width of a spine shows the time you spent with it. Pull a book out to see your path through it, one session at a time.",
    tries: [
      <>Point at spines; pull one out</>,
      <>
        <Kbd>Esc</Kbd> to put it back
      </>,
    ],
    stageClassName: "h-[min(80svh,720px)] min-h-[600px]",
    render: (library) => <Shelf library={library} />,
  },
  {
    id: "atrium",
    chapter: "library",
    name: "Atrium",
    subtitle: "One book in front",
    thesis:
      "The book you are reading is the only large element. Other books in progress sit beside it as small covers, and the rest of the library waits on quiet shelves. A filter reflows the shelf in place, and ⌘K finds any book.",
    tries: [
      <>Point at the cover; choose another book in progress</>,
      <>Filter by status and watch the grid reflow</>,
      <>
        <Kbd>⌘</Kbd> <Kbd>K</Kbd> to find a book
      </>,
    ],
    stageClassName: "h-[min(86svh,800px)] min-h-[620px]",
    render: (library) => <Atrium library={library} />,
  },
  {
    id: "ledger",
    chapter: "library",
    name: "Ledger",
    subtitle: "The library as a list",
    thesis:
      "A compact, sortable list for large libraries, with progress, last read, time and notes in aligned columns. Rest on a row and its cover appears beside the pointer. Rows move into place when you sort or finish a book.",
    tries: [
      <>Sort by any column</>,
      <>Rest on a row to see its cover; mark it finished</>,
      <>
        <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move, <Kbd>/</Kbd> to filter
      </>,
    ],
    stageClassName: "h-[min(80svh,720px)] min-h-[580px]",
    render: (library) => <Ledger library={library} />,
  },
  {
    id: "unfold",
    chapter: "library",
    name: "Unfold",
    subtitle: "Details, in place",
    thesis:
      "Choosing a cover opens its details directly under its row, instead of on a new page. A notch follows the chosen cover. Status, progress and recent highlights are one glance away, and the grid never loses your place.",
    tries: [
      <>Choose a cover, then its neighbour</>,
      <>Change its status</>,
      <>
        <Kbd>←</Kbd> <Kbd>→</Kbd> to move, <Kbd>Esc</Kbd> to close
      </>,
    ],
    stageClassName: "h-[min(86svh,800px)] min-h-[620px]",
    render: (library) => <Unfold library={library} />,
  },
  {
    id: "rail",
    chapter: "margin",
    name: "Rail",
    subtitle: "The outline in a hairline",
    thesis:
      "A minimap of the book sits at the left edge: chapter ticks, highlight dots and your place. Point at it to open one outline that merges the contents with your highlights. The minimap marks which part of the book the list shows.",
    tries: [
      <>Point at the left edge</>,
      <>Choose a chapter or a highlight</>,
      <>
        <Kbd>[</Kbd> to pin the outline
      </>,
    ],
    stageClassName: "h-[min(84svh,760px)] min-h-[600px]",
    render: () => <OutlineRail />,
  },
  {
    id: "inspector",
    chapter: "margin",
    name: "Inspector",
    subtitle: "One calm panel",
    thesis:
      "Contents, notes and appearance in one panel with labelled tabs. Panels slide in the direction you move. Appearance changes apply to the page while you make them, so the page itself is the preview.",
    tries: [
      <>Type a page number in Contents</>,
      <>Filter notes by colour</>,
      <>Change theme, typeface and size</>,
    ],
    stageClassName: "h-[min(86svh,800px)] min-h-[640px]",
    render: () => <Inspector />,
  },
  {
    id: "companion",
    chapter: "margin",
    name: "Companion",
    subtitle: "A margin that follows you",
    thesis:
      "The margin shows only what belongs to the page you are on: its highlights and notes. Earlier passages, the next chapter and this sitting are summarised below. Point at a note to find it on the page.",
    tries: [
      <>
        Turn pages with <Kbd>←</Kbd> <Kbd>→</Kbd>
      </>,
      <>Point at a note or a highlight</>,
      <>Choose an earlier highlight to go back</>,
    ],
    stageClassName: "h-[min(84svh,760px)] min-h-[600px]",
    render: () => <Companion />,
  },
];

function plateNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function SourceSwitch({
  source,
  canUseLibrary,
  counts,
  onChange,
}: {
  source: StudioSource;
  canUseLibrary: boolean;
  counts: { books: number; highlights: number; sessions: number };
  onChange: (source: StudioSource) => void;
}) {
  // The masthead renders one switch per breakpoint; keep their pills apart.
  const groupId = useId();
  const options: { value: StudioSource; label: string; disabled: boolean }[] = [
    { value: "sample", label: "Sample library", disabled: false },
    { value: "library", label: "Your library", disabled: !canUseLibrary },
  ];

  return (
    <LayoutGroup id={groupId}>
    <div className="flex flex-col items-start gap-1.5 md:items-end">
      <div
        role="radiogroup"
        aria-label="Data shown in the prototypes"
        className="relative flex rounded-full border bg-background p-0.5 text-xs font-medium"
      >
        {options.map((option) => {
          const active = option.value === source;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={option.disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative isolate cursor-pointer rounded-full px-3.5 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
                active ? "text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="xp-source-pill"
                  transition={SOFT_SPRING}
                  className="absolute inset-0 -z-10 rounded-full bg-foreground"
                />
              )}
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {canUseLibrary
          ? `${counts.books.toLocaleString()} books · ${counts.highlights.toLocaleString()} highlights · ${counts.sessions.toLocaleString()} sessions on this device`
          : "Public-domain books. Your library appears once you read and highlight."}
      </p>
    </div>
    </LayoutGroup>
  );
}

function scrollToId(id: string, reducedMotion: boolean) {
  document.getElementById(id)?.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

function Masthead({
  onChapter,
  sourceSwitch,
}: {
  onChapter: (id: ChapterId) => void;
  sourceSwitch: ReactNode;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const lines: { id: ChapterId; text: ReactNode; plates: string }[] = [
    { id: "page", text: <>The Page,</>, plates: "01—03" },
    { id: "commonplace", text: <>the Commonplace,</>, plates: "04—06" },
    { id: "habit", text: <>the Habit,</>, plates: "07—09" },
    { id: "library", text: <>the Library,</>, plates: "10—12" },
    {
      id: "margin",
      text: (
        <>
          <span className="italic">&amp;</span> the Margin.
        </>
      ),
      plates: "13—15",
    },
  ];

  return (
    <header className="relative px-4 pt-6 pb-14 md:px-10 md:pt-12 md:pb-20">
      <div className="mb-10 flex items-center justify-between gap-4 md:mb-16">
        <div className="flex items-center gap-3">
          <MobileBackToLibrary />
          <p className="xp-smcp text-xs text-muted-foreground">
            Reader · Experiments · Fifteen plates
          </p>
        </div>
        <div className="max-md:hidden">{sourceSwitch}</div>
      </div>

      <h1 className="sr-only">Experiments</h1>
      <nav aria-label="Chapters" className="xp-serif">
        {lines.map((line, index) => (
          <motion.button
            key={line.id}
            type="button"
            onClick={() => onChapter(line.id)}
            initial={reducedMotion ? false : { opacity: 0, y: 28, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, delay: 0.08 + index * 0.09, ease: EASE_OUT }}
            className="group flex w-full cursor-pointer items-baseline gap-4 text-left text-[clamp(2.6rem,8.6vw,7.75rem)] leading-[0.94] font-normal tracking-[-0.035em] outline-none focus-visible:underline"
          >
            <span className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-[0.12em]">
              {line.text}
            </span>
            <span className="xp-onum translate-y-[-0.2em] text-[0.14em] tracking-normal text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100 max-md:hidden">
              plates {line.plates}
            </span>
          </motion.button>
        ))}
      </nav>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.45, ease: EASE_OUT }}
        className="mt-10 grid gap-8 md:mt-14 md:grid-cols-[minmax(0,34rem)_1fr] md:items-end"
      >
        <p className="xp-serif text-xl leading-snug text-balance text-foreground/85 md:text-2xl">
          Fifteen working prototypes for the places a reader spends time: the
          page they read, the passages they keep, the habit that brings them
          back, the shelf they choose from and the margin beside the text.
          Plates 10–15 take a quieter approach. Each plate is interactive.
        </p>
        <div className="md:hidden">{sourceSwitch}</div>
      </motion.div>
    </header>
  );
}

function PlateRail({ activeId }: { activeId: string | null }) {
  const reducedMotion = useReducedMotion() ?? false;
  const visible = activeId !== null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          aria-label="Plates"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="fixed top-3 left-1/2 z-40 -translate-x-1/2 max-sm:hidden"
        >
          <LayoutGroup id="xp-plate-rail">
            <ol className="flex items-center gap-0.5 rounded-full border bg-background/85 p-1 shadow-lg shadow-black/5 backdrop-blur-xl">
              {PLATES.map((plate, index) => {
                const active = plate.id === activeId;
                const chapterStart =
                  index > 0 && PLATES[index - 1].chapter !== plate.chapter;
                return (
                  <Fragment key={plate.id}>
                    {chapterStart && (
                      <li aria-hidden="true" className="mx-1 h-3 w-px bg-border" />
                    )}
                    <li>
                      <button
                        type="button"
                        onClick={() => scrollToId(`plate-${plate.id}`, reducedMotion)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "relative isolate flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "text-background" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {active && (
                          <motion.span
                            layoutId="xp-plate-rail-active"
                            transition={SOFT_SPRING}
                            className="absolute inset-0 -z-10 rounded-full bg-foreground"
                          />
                        )}
                        <span className="xp-lnum">{plateNumber(index)}</span>
                        <AnimatePresence initial={false}>
                          {active && (
                            <motion.span
                              initial={{ width: 0, opacity: 0 }}
                              animate={{ width: "auto", opacity: 1 }}
                              exit={{ width: 0, opacity: 0 }}
                              transition={{ duration: 0.28, ease: EASE_OUT }}
                              className="overflow-hidden whitespace-nowrap"
                            >
                              {plate.name}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </LayoutGroup>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

function ChapterOpener({ chapter }: { chapter: ChapterDefinition }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <div
      ref={ref}
      id={`chapter-${chapter.id}`}
      className="scroll-mt-6 border-t px-4 pt-10 pb-12 md:px-10 md:pt-14 md:pb-16"
    >
      <div className="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:items-baseline">
        <motion.p
          initial={reducedMotion ? false : { opacity: 0, x: -16 }}
          animate={inView ? { opacity: 1, x: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE_OUT }}
          className="xp-serif text-7xl leading-none font-normal text-muted-foreground/70 md:text-8xl"
        >
          {chapter.numeral}.
        </motion.p>
        <div>
          <motion.h2
            initial={reducedMotion ? false : { opacity: 0, y: 18 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.8, delay: 0.06, ease: EASE_OUT }}
            className="xp-serif text-5xl leading-none tracking-[-0.03em] italic md:text-7xl"
          >
            {chapter.title}
          </motion.h2>
          <motion.p
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={inView ? { opacity: 1 } : undefined}
            transition={{ duration: 0.8, delay: 0.18, ease: EASE_OUT }}
            className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base md:leading-7"
          >
            {chapter.line}
          </motion.p>
        </div>
      </div>
    </div>
  );
}

function Plate({
  plate,
  index,
  library,
  onActive,
}: {
  plate: PlateDefinition;
  index: number;
  library: StudioLibrary;
  onActive: (id: string) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Mount a stage shortly before it scrolls in; keep it mounted afterwards.
  const shouldMount = useInView(stageRef, { once: true, margin: "700px 0px" });
  const isCentered = useInView(sectionRef, { margin: "-45% 0px -45% 0px" });

  useEffect(() => {
    if (isCentered) onActive(plate.id);
  }, [isCentered, onActive, plate.id]);

  return (
    <section
      ref={sectionRef}
      id={`plate-${plate.id}`}
      aria-labelledby={`plate-${plate.id}-title`}
      className="scroll-mt-16 px-4 pb-20 md:px-10 md:pb-28"
    >
      <div className="mb-6 grid gap-x-10 gap-y-4 md:mb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
        <div className="flex items-end gap-5">
          <span className="xp-serif xp-onum text-6xl leading-[0.8] text-muted-foreground/60 md:text-7xl">
            {plateNumber(index)}
          </span>
          <div>
            <p className="xp-smcp text-xs text-muted-foreground">Plate {plateNumber(index)}</p>
            <h3
              id={`plate-${plate.id}-title`}
              className="xp-serif text-4xl leading-none tracking-[-0.02em] md:text-5xl"
            >
              {plate.name}{" "}
              <span className="text-2xl text-muted-foreground italic md:text-3xl">
                {plate.subtitle}
              </span>
            </h3>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <p className="max-w-xl text-sm leading-6 text-foreground/80">{plate.thesis}</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground sm:max-w-56">
            {plate.tries.map((item, tryIndex) => (
              <li key={tryIndex} className="flex items-baseline gap-2">
                <span aria-hidden="true" className="text-foreground/40">
                  —
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div
        ref={stageRef}
        className={cn(
          "relative isolate overflow-hidden rounded-[1.75rem] border bg-background shadow-[0_1px_0_rgba(0,0,0,0.03),0_24px_60px_-30px_rgba(0,0,0,0.25)] md:rounded-[2.25rem]",
          plate.stageClassName,
        )}
      >
        {shouldMount ? (
          plate.render(library)
        ) : (
          <div className="grid size-full min-h-[inherit] place-items-center text-xs text-muted-foreground">
            Preparing plate…
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Experiments: interactive design studies for the Reader, Highlights and
 * Sessions screens. Prototypes use sample data or the local library and never
 * write to storage.
 */
export function Experiments() {
  const studio = useStudioLibrary();
  const reducedMotion = useReducedMotion() ?? false;
  const [activePlate, setActivePlate] = useState<string | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const headerVisible = useInView(headerRef, { margin: "0px 0px -60% 0px" });

  const sourceSwitch = (
    <SourceSwitch
      source={studio.source}
      canUseLibrary={studio.canUseLibrary}
      counts={studio.libraryCounts}
      onChange={studio.setSource}
    />
  );

  return (
    <div className="min-h-svh bg-background text-foreground">
      <PlateRail activeId={headerVisible ? null : activePlate} />
      <div ref={headerRef}>
        <Masthead
          sourceSwitch={sourceSwitch}
          onChapter={(id) => scrollToId(`chapter-${id}`, reducedMotion)}
        />
      </div>

      <div className="mx-auto w-full max-w-[1480px]">
        {CHAPTERS.map((chapter) => (
          <Fragment key={chapter.id}>
            <ChapterOpener chapter={chapter} />
            {PLATES.map((plate, index) =>
              plate.chapter === chapter.id ? (
                <Plate
                  key={plate.id}
                  plate={plate}
                  index={index}
                  library={studio.library}
                  onActive={setActivePlate}
                />
              ) : null,
            )}
          </Fragment>
        ))}
      </div>

      <footer className="border-t px-4 py-12 text-center md:px-10">
        <p className="xp-serif text-2xl italic text-muted-foreground">Finis.</p>
        <p className="mt-2 text-xs text-muted-foreground">
          These prototypes do not save changes. Sample texts are in the public domain.
        </p>
      </footer>
    </div>
  );
}
